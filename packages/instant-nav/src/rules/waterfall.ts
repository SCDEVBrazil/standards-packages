import ts from 'typescript';
import { calleeRoot, lineOf, type ParsedFile } from '../scan/ast';
import type { Advisory } from '../types';
import { REQUEST_AWAITS } from './context';

const isAsyncFn = (n: ts.Node): n is ts.FunctionLikeDeclaration =>
  (ts.isFunctionDeclaration(n) ||
    ts.isFunctionExpression(n) ||
    ts.isArrowFunction(n) ||
    ts.isMethodDeclaration(n)) &&
  (ts.getModifiers(n) ?? []).some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);

/** The awaited expression of `const x = await f()` / `await f();` at statement level, or null. */
function awaitedOf(st: ts.Statement): ts.AwaitExpression | null {
  if (ts.isExpressionStatement(st) && ts.isAwaitExpression(st.expression)) return st.expression;
  if (ts.isVariableStatement(st) && st.declarationList.declarations.length === 1) {
    const init = st.declarationList.declarations[0]!.initializer;
    if (init && ts.isAwaitExpression(init)) return init;
  }
  return null;
}

/** Names a statement declares (`const a = …`, `const { b, c } = …`, `const [d] = …`). */
function declared(st: ts.Statement): string[] {
  if (!ts.isVariableStatement(st)) return [];
  const out: string[] = [];
  const walk = (b: ts.BindingName): void => {
    if (ts.isIdentifier(b)) out.push(b.text);
    else for (const el of b.elements) if (!ts.isOmittedExpression(el)) walk(el.name);
  };
  for (const d of st.declarationList.declarations) walk(d.name);
  return out;
}

function mentions(n: ts.Node, names: Set<string>): boolean {
  let hit = false;
  const visit = (x: ts.Node): void => {
    if (hit) return;
    if (ts.isIdentifier(x) && names.has(x.text)) hit = true;
    else ts.forEachChild(x, visit);
  };
  visit(n);
  return hit;
}

/**
 * WATERFALL? (SPEC P3.1): two awaits in a row where the second does not use anything the first produced — they
 * probably could run in parallel. ADVISORY ONLY: the WMS detector was wrong 6 times out of 7, so a human decides
 * (Promise.all, or separate Suspense regions). One advisory per function, at the first independent pair.
 */
export function waterfalls(files: ParsedFile[]): Advisory[] {
  const out: Advisory[] = [];
  for (const p of files) {
    const visit = (n: ts.Node): void => {
      if (isAsyncFn(n) && n.body && ts.isBlock(n.body)) {
        const stmts = n.body.statements;
        const seen = new Set<string>();
        let prev: { root: string; line: number } | null = null;
        for (const st of stmts) {
          const aw = awaitedOf(st);
          if (aw) {
            const root = calleeRoot(aw.expression);
            const request = REQUEST_AWAITS.has(root);
            if (prev && !request && !mentions(aw.expression, seen)) {
              out.push({
                kind: 'WATERFALL?',
                file: p.file,
                line: lineOf(p.sf, st),
                message: `await ${root} does not use the result of await ${prev.root} (line ${prev.line}) — they may be able to run in parallel`,
              });
              break;
            }
            if (!request) prev = { root, line: lineOf(p.sf, st) };
          }
          for (const name of declared(st)) seen.add(name);
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(p.sf);
  }
  return out;
}
