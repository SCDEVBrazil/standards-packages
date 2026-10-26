import ts from 'typescript';
import { isReason } from '../config';
import { lineOf, unwrap, type ParsedFile } from '../scan/ast';
import type { Finding } from '../types';
import type { RuleContext } from './context';

/** A cache timer found in a file, before the approval list is consulted. */
interface Timer {
  file: string;
  line: number;
  what: string;
}

const calleeName = (c: ts.CallExpression): string => {
  const e = unwrap(c.expression);
  return ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : '';
};

const propNamed = (
  o: ts.ObjectLiteralExpression,
  name: string
): ts.ObjectLiteralElementLike | undefined =>
  o.properties.find((p) => p.name?.getText().replace(/['"]/g, '') === name);

/** Timers in ordinary code: `unstable_cache(fn, keys, { revalidate })` and any `cacheLife(...)` call. */
function codeTimers(p: ParsedFile): Timer[] {
  const out: Timer[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const name = calleeName(n);
      const opts = n.arguments[2] && unwrap(n.arguments[2]);
      if (
        name === 'unstable_cache' &&
        opts &&
        ts.isObjectLiteralExpression(opts) &&
        propNamed(opts, 'revalidate')
      ) {
        out.push({
          file: p.file,
          line: lineOf(p.sf, n),
          what: 'unstable_cache(…, { revalidate })',
        });
      }
      if (name === 'cacheLife')
        out.push({
          file: p.file,
          line: lineOf(p.sf, n),
          what: `cacheLife(${n.arguments.map((a) => a.getText()).join(', ')})`,
        });
    }
    ts.forEachChild(n, visit);
  };
  visit(p.sf);
  return out;
}

/** `experimental.staleTimes` in next.config (a client-side timer on every navigation). */
function configTimers(p: ParsedFile): Timer[] {
  const out: Timer[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isPropertyAssignment(n) && n.name.getText().replace(/['"]/g, '') === 'staleTimes') {
      out.push({ file: p.file, line: lineOf(p.sf, n), what: 'experimental.staleTimes' });
    }
    ts.forEachChild(n, visit);
  };
  visit(p.sf);
  return out;
}

/**
 * FRESHNESS_TTL (SPEC P5.1): no data on a timer unless Renan approved that surface. The check cannot tell
 * business data from chrome, so every timer needs an entry in `exemptions.freshnessApproved`; for chrome the
 * reason says so. A numeric `export const revalidate` counts too — before the SWITCH; after it,
 * SEGMENT_CONFIG_INCOMPATIBLE owns that export, so one line never yields two findings.
 * @param code every parsed source file under the app's source root (not only route files)
 */
export function freshness(ctx: RuleContext, code: ParsedFile[]): Finding[] {
  const timers: Timer[] = code.flatMap(codeTimers);
  if (ctx.nextConfig) timers.push(...configTimers(ctx.nextConfig));
  if (!ctx.config.switch) {
    for (const file of [...ctx.routes.pages, ...ctx.routes.layouts]) {
      const r = ctx.parsed.get(file)?.segmentExports.get('revalidate');
      if (r && ts.isNumericLiteral(r.node) && Number(r.node.text) > 0) {
        timers.push({ file, line: r.line, what: `export const revalidate = ${r.node.text}` });
      }
    }
  }
  const approved = ctx.config.exemptions.freshnessApproved;
  return timers
    .filter((t) => !isReason(approved[t.file]?.reason))
    .map((t) => ({
      rule: 'FRESHNESS_TTL' as const,
      file: t.file,
      line: t.line,
      message: `${t.what} serves data on a timer, and this surface is not on the approved list${approved[t.file] ? ' (its reason is under 40 characters)' : ''}`,
      fix: 'drop the timer and invalidate on write (revalidateTag / revalidatePath), or ask Renan to approve this surface: exemptions.freshnessApproved[file] = { reason, approved }',
    }));
}

/** Every `unstable_cache` call, timer or not, for the audit list (SPEC P5.1: audit it). */
export function unstableCacheAudit(code: ParsedFile[]): { file: string; line: number }[] {
  const out: { file: string; line: number }[] = [];
  for (const p of code) {
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && calleeName(n) === 'unstable_cache')
        out.push({ file: p.file, line: lineOf(p.sf, n) });
      ts.forEachChild(n, visit);
    };
    visit(p.sf);
  }
  return out;
}
