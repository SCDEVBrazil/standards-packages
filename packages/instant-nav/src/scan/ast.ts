import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { CannotMeasure } from '../exit-codes';

/** A parsed route file and the facts every rule asks about it. */
export interface ParsedFile {
  file: string;
  sf: ts.SourceFile;
  /** The default-exported component, or null when the file has none the parser can name. */
  component: ts.FunctionLikeDeclaration | null;
  /** Every `await` inside the component itself (not inside nested functions), with its callee root. */
  awaits: { root: string; line: number }[];
  /** `"use cache…"` directives at file level or at the top of the component. */
  directives: { value: string; line: number }[];
  /** Top-level `export const <name> = <initializer>` segment exports. */
  segmentExports: Map<string, { node: ts.Expression; line: number }>;
}

const FN_KINDS = new Set([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.MethodDeclaration,
]);

export const lineOf = (sf: ts.SourceFile, node: ts.Node): number =>
  sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

/**
 * Parses a file with the TypeScript compiler (never a regex: strings and comments cannot fool it).
 * @throws CannotMeasure on a syntax error, naming the file and line — a file the parser cannot read is not a pass
 */
export function parseFile(root: string, file: string): ParsedFile {
  let text: string;
  try {
    text = readFileSync(join(root, file), 'utf8');
  } catch (e) {
    throw new CannotMeasure(`cannot read ${file}: ${(e as Error).message}`);
  }
  const kind = /\.(tsx|jsx)$/.test(file)
    ? ts.ScriptKind.TSX
    : /\.js$/.test(file)
      ? ts.ScriptKind.JS
      : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const diag =
    (sf as unknown as { parseDiagnostics?: ts.DiagnosticWithLocation[] }).parseDiagnostics ?? [];
  if (diag.length) {
    const d = diag[0]!;
    const line = sf.getLineAndCharacterOfPosition(d.start).line + 1;
    throw new CannotMeasure(
      `${file}:${line} does not parse: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`
    );
  }
  const component = defaultComponent(sf);
  return {
    file,
    sf,
    component,
    awaits: component ? awaitsIn(sf, component) : [],
    directives: directivesOf(sf, component),
    segmentExports: segmentExports(sf),
  };
}

const hasModifier = (n: ts.Node, k: ts.SyntaxKind): boolean =>
  ts.canHaveModifiers(n) ? (ts.getModifiers(n) ?? []).some((m) => m.kind === k) : false;

/** `export default function X`, `export default async () => …`, or `export default X` naming a local function. */
function defaultComponent(sf: ts.SourceFile): ts.FunctionLikeDeclaration | null {
  const locals = new Map<string, ts.FunctionLikeDeclaration>();
  let named: string | null = null;
  let direct: ts.FunctionLikeDeclaration | null = null;
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st)) {
      if (
        hasModifier(st, ts.SyntaxKind.ExportKeyword) &&
        hasModifier(st, ts.SyntaxKind.DefaultKeyword)
      )
        direct = st;
      else if (st.name) locals.set(st.name.text, st);
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        const init = d.initializer && unwrap(d.initializer);
        if (
          ts.isIdentifier(d.name) &&
          init &&
          (ts.isArrowFunction(init) || ts.isFunctionExpression(init))
        ) {
          locals.set(d.name.text, init);
        }
      }
    } else if (ts.isExportAssignment(st) && !st.isExportEquals) {
      const e = unwrap(st.expression);
      if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) direct = e;
      else if (ts.isIdentifier(e)) named = e.text;
    }
  }
  return direct ?? (named ? (locals.get(named) ?? null) : null);
}

/** Strips parentheses, `as`, `satisfies` and non-null assertions around an expression. */
export function unwrap(e: ts.Expression): ts.Expression {
  let x = e;
  while (
    ts.isParenthesizedExpression(x) ||
    ts.isAsExpression(x) ||
    ts.isSatisfiesExpression(x) ||
    ts.isNonNullExpression(x)
  ) {
    x = x.expression;
  }
  return x;
}

/**
 * The name an awaited expression resolves from: `await params` → `params`, `await props.searchParams` →
 * `props.searchParams`, `await getOrders(x)` → `getOrders`, `await db.order.findMany()` → `db.order.findMany`,
 * `await cookies()` → `cookies`. Anything else (a literal, an IIFE) → `<expr>`, which counts as data.
 */
export function calleeRoot(e: ts.Expression): string {
  let x = unwrap(e);
  if (ts.isCallExpression(x)) x = unwrap(x.expression);
  const parts: string[] = [];
  while (ts.isPropertyAccessExpression(x)) {
    parts.unshift(x.name.text);
    x = unwrap(x.expression);
  }
  if (ts.isIdentifier(x)) return [x.text, ...parts].join('.');
  if (x.kind === ts.SyntaxKind.ThisKeyword) return ['this', ...parts].join('.');
  return '<expr>';
}

/** Awaits that run when the component renders: nested functions (callbacks, inner components) are not entered. */
function awaitsIn(sf: ts.SourceFile, fn: ts.FunctionLikeDeclaration): ParsedFile['awaits'] {
  const out: ParsedFile['awaits'] = [];
  const visit = (n: ts.Node): void => {
    if (n !== fn && FN_KINDS.has(n.kind)) return;
    if (ts.isAwaitExpression(n)) out.push({ root: calleeRoot(n.expression), line: lineOf(sf, n) });
    if (ts.isForOfStatement(n) && n.awaitModifier)
      out.push({ root: calleeRoot(n.expression), line: lineOf(sf, n) });
    ts.forEachChild(n, visit);
  };
  if (fn.body) visit(fn.body);
  for (const p of fn.parameters) if (p.initializer) visit(p.initializer);
  return out;
}

const directiveOf = (st: ts.Statement): string | null =>
  ts.isExpressionStatement(st) && ts.isStringLiteral(st.expression) ? st.expression.text : null;

/** `"use cache"`, `"use cache: private"`, `"use cache: remote"` in the file prologue or the component prologue. */
function directivesOf(
  sf: ts.SourceFile,
  fn: ts.FunctionLikeDeclaration | null
): ParsedFile['directives'] {
  const out: ParsedFile['directives'] = [];
  const scan = (stmts: readonly ts.Statement[]): void => {
    for (const st of stmts) {
      const d = directiveOf(st);
      if (d === null) break;
      if (/^use cache\b/.test(d))
        out.push({ value: d.replace(/\s+/g, ' ').trim(), line: lineOf(sf, st) });
    }
  };
  scan(sf.statements);
  if (fn?.body && ts.isBlock(fn.body)) scan(fn.body.statements);
  return out;
}

function segmentExports(sf: ts.SourceFile): ParsedFile['segmentExports'] {
  const out: ParsedFile['segmentExports'] = new Map();
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st) || !hasModifier(st, ts.SyntaxKind.ExportKeyword)) continue;
    for (const d of st.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.initializer) {
        out.set(d.name.text, { node: unwrap(d.initializer), line: lineOf(sf, d) });
      }
    }
  }
  return out;
}

// ── JSX: Suspense boundaries and the data-shell marker (SPEC P2.1) ──

const tagName = (n: ts.JsxOpeningLikeElement): string => n.tagName.getText();
const isSuspenseTag = (n: ts.JsxOpeningLikeElement): boolean =>
  /^(React\.)?Suspense$/.test(tagName(n));
const opening = (n: ts.Node): ts.JsxOpeningLikeElement | null =>
  ts.isJsxElement(n) ? n.openingElement : ts.isJsxSelfClosingElement(n) ? n : null;
const hasShellAttr = (o: ts.JsxOpeningLikeElement): boolean =>
  o.attributes.properties.some((p) => ts.isJsxAttribute(p) && p.name.getText() === 'data-shell');

/** What the component's JSX says about its shell. */
export interface ShellFacts {
  /** The component renders at least one `<Suspense>`. */
  suspense: boolean;
  /** Some element carrying `data-shell` sits outside every Suspense boundary (fallbacks count as shell). */
  shellOutside: boolean;
  /** A returned JSX tree whose root is a single `<Suspense>` (optionally inside a bare fragment). */
  pageWide: boolean;
  /** Line of the first Suspense, for the finding. */
  line: number;
}

/**
 * Walks the component's own JSX. A `data-shell` element inside a Suspense `fallback` counts as shell (a
 * fallback IS what paints first); one inside the boundary's children does not.
 */
export function shellFacts(p: ParsedFile): ShellFacts {
  const facts: ShellFacts = { suspense: false, shellOutside: false, pageWide: false, line: 1 };
  const fn = p.component;
  if (!fn?.body) return facts;
  const visit = (n: ts.Node, insideBoundary: boolean): void => {
    if (n !== fn && FN_KINDS.has(n.kind)) return;
    const o = opening(n);
    if (o) {
      if (hasShellAttr(o) && !insideBoundary) facts.shellOutside = true;
      if (isSuspenseTag(o)) {
        if (!facts.suspense) facts.line = lineOf(p.sf, o);
        facts.suspense = true;
        for (const attr of o.attributes.properties) {
          if (ts.isJsxAttribute(attr) && attr.name.getText() === 'fallback' && attr.initializer) {
            visit(attr.initializer, insideBoundary);
          }
        }
        if (ts.isJsxElement(n)) for (const c of n.children) visit(c, true);
        return;
      }
    }
    ts.forEachChild(n, (c) => visit(c, insideBoundary));
  };
  visit(fn.body, false);
  facts.pageWide = returnedRoots(fn).some((r) => {
    let x: ts.Node = r;
    while (ts.isJsxFragment(x)) {
      const kids = x.children.filter((c) => !(ts.isJsxText(c) && c.containsOnlyTriviaWhiteSpaces));
      if (kids.length !== 1) return false;
      x = kids[0]!;
    }
    const o = opening(x);
    return !!o && isSuspenseTag(o);
  });
  return facts;
}

/** The JSX expressions the component returns (an arrow's expression body, or each `return`). */
function returnedRoots(fn: ts.FunctionLikeDeclaration): ts.Expression[] {
  if (!fn.body) return [];
  if (!ts.isBlock(fn.body)) return [unwrap(fn.body)];
  const out: ts.Expression[] = [];
  const visit = (n: ts.Node): void => {
    if (FN_KINDS.has(n.kind)) return;
    if (ts.isReturnStatement(n) && n.expression) out.push(unwrap(n.expression));
    ts.forEachChild(n, visit);
  };
  for (const st of fn.body.statements) visit(st);
  return out;
}
