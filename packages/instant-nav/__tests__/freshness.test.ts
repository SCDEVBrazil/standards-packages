import { afterEach, describe, expect, it } from 'vitest';
import { judge, scan } from '../src/index';
import { GOOD_LAYOUT, GOOD_PAGE, makeProject, type ProjectSpec } from './helpers';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((f) => f()));

function run(spec: ProjectSpec) {
  const p = makeProject(spec);
  cleanups.push(p.done);
  return { root: p.root, s: scan(p.root) };
}
const base = (files: Record<string, string>) => ({
  'src/app/layout.tsx': GOOD_LAYOUT,
  'src/app/page.tsx': GOOD_PAGE,
  ...files,
});
const rules = (spec: ProjectSpec) => run(spec).s.findings.map((f) => f.rule);
const APPROVAL = {
  reason: 'warehouse labels only, identical for every user, changed only on deploy',
  approved: '2026-10-24',
};

describe('FRESHNESS_TTL', () => {
  const lib = `import { unstable_cache } from 'next/cache';
export const getLabels = unstable_cache(async () => fetchLabels(), ['labels'], { revalidate: 60 });`;
  it('fires on unstable_cache with revalidate in ANY source file, not only route files', () => {
    expect(rules({ files: base({ 'src/lib/labels.ts': lib }) })).toEqual(['FRESHNESS_TTL']);
  });
  it('unstable_cache WITHOUT revalidate is not a timer (it appears in the audit instead)', () => {
    const { s } = run({
      files: base({ 'src/lib/labels.ts': lib.replace(', { revalidate: 60 }', '') }),
    });
    expect(s.findings).toEqual([]);
    expect(s.advisories.map((a) => a.kind)).toEqual(['UNSTABLE_CACHE']);
  });
  it('fires on cacheLife(...) and on experimental.staleTimes', () => {
    const cl = `export async function getOrders() { 'use cache'; cacheLife('hours'); return db(); }`;
    const cfg = `export default { experimental: { staleTimes: { dynamic: 30 } } };`;
    expect(rules({ files: base({ 'src/lib/orders.ts': cl }) })).toEqual(['FRESHNESS_TTL']);
    expect(rules({ files: base({ 'next.config.ts': cfg }) })).toEqual(['FRESHNESS_TTL']);
  });
  it('fires on a numeric revalidate export before the SWITCH; after it, only SEGMENT_CONFIG_INCOMPATIBLE fires', () => {
    const p = `export const revalidate = 300;\nexport default function Page() { return <p>x</p>; }`;
    expect(rules({ files: base({ 'src/app/a/page.tsx': p }) })).toEqual(['FRESHNESS_TTL']);
    expect(rules({ files: base({ 'src/app/a/page.tsx': p }), area: { switch: true } })).toEqual([
      'SEGMENT_CONFIG_INCOMPATIBLE',
    ]);
    expect(rules({ files: base({ 'src/app/a/page.tsx': p.replace('300', '0') }) })).toEqual([]);
  });
  it('an approved surface (reason >= 40 chars + date) passes; a short reason does not', () => {
    const files = base({ 'src/lib/labels.ts': lib });
    expect(
      rules({
        files,
        area: { exemptions: { freshnessApproved: { 'src/lib/labels.ts': APPROVAL } } },
      })
    ).toEqual([]);
    expect(
      rules({
        files,
        area: {
          exemptions: {
            freshnessApproved: { 'src/lib/labels.ts': { reason: 'ok', approved: '2026-10-24' } },
          },
        },
      })
    ).toEqual(['FRESHNESS_TTL']);
  });
  it('an approval without a valid date is CANNOT MEASURE', () => {
    const p = makeProject({
      files: base({}),
      area: { exemptions: { freshnessApproved: { 'x.ts': { reason: APPROVAL.reason } } } },
    });
    cleanups.push(p.done);
    expect(() => scan(p.root)).toThrow(/approved: YYYY-MM-DD/);
  });
  it('test files are not source files', () => {
    expect(rules({ files: base({ 'src/lib/labels.test.ts': lib }) })).toEqual([]);
  });
});

describe('WATERFALL? (advisory, never blocking)', () => {
  const seq = `export default async function Page() {
  const a = await getOrders();
  const b = await getCarriers();
  return <p data-shell>{a.length + b.length}</p>;
}`;
  it('flags two independent awaits in a row, and the exit code stays 0', () => {
    const { root, s } = run({
      files: base({
        'src/app/a/page.tsx': seq,
        'src/app/a/loading.tsx': 'export default () => null',
      }),
    });
    expect(s.findings).toEqual([]);
    expect(s.advisories).toHaveLength(1);
    expect(s.advisories[0]!.kind).toBe('WATERFALL?');
    expect(s.advisories[0]!.message).toMatch(
      /getCarriers does not use the result of await getOrders/
    );
    expect(judge(root, s).code).toBe(0);
  });
  it('does not flag a dependent await', () => {
    const dep = seq.replace('await getCarriers()', 'await getCarriers(a[0])');
    const { s } = run({
      files: base({
        'src/app/a/page.tsx': dep,
        'src/app/a/loading.tsx': 'export default () => null',
      }),
    });
    expect(s.advisories).toEqual([]);
  });
  it('does not flag awaiting params/cookies first', () => {
    const p = `export default async function Page({ params }) { const { id } = await params; const o = await getOrder(id); return <p>{o}</p>; }`;
    const { s } = run({
      files: base({
        'src/app/a/page.tsx': p,
        'src/app/a/loading.tsx': 'export default () => null',
      }),
    });
    expect(s.advisories).toEqual([]);
  });
  it('finds waterfalls in data helpers too', () => {
    const lib = `export async function load() { const x = await one(); const y = await two(); return [x, y]; }`;
    const { s } = run({ files: base({ 'src/lib/load.ts': lib }) });
    expect(s.advisories.map((a) => a.file)).toEqual(['src/lib/load.ts']);
  });
});

describe('INSTANT_SPEC_NO_PROOF (advisory)', () => {
  const spec = `import { instant } from '@next/playwright';\ntest('x', async ({ page }) => { await instant(page, async () => {}); });`;
  it('flags an instant() spec without a @fails-before line, and accepts one with it', () => {
    const { root, s } = run({ files: base({ 'e2e/nav.spec.ts': spec }) });
    expect(s.advisories.map((a) => a.kind)).toEqual(['INSTANT_SPEC_NO_PROOF']);
    expect(judge(root, s).code).toBe(0);
    const { s: s2 } = run({
      files: base({ 'e2e/nav.spec.ts': `// @fails-before 3ce6248\n${spec}` }),
    });
    expect(s2.advisories).toEqual([]);
    const { s: s3 } = run({
      files: base({ 'e2e/nav.spec.ts': `// @fails-before 0000000\n${spec}` }),
    });
    expect(s3.advisories.map((a) => a.kind)).toEqual(['INSTANT_SPEC_NO_PROOF']);
  });
});
