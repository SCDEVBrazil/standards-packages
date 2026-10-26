import { afterEach, describe, expect, it } from 'vitest';
import { CannotMeasure, judge, scan } from '../src/index';
import { GOOD_LAYOUT, GOOD_PAGE, makeProject, type ProjectSpec } from './helpers';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((f) => f()));

function run(spec: ProjectSpec) {
  const p = makeProject(spec);
  cleanups.push(p.done);
  return { root: p.root, s: scan(p.root) };
}
const rules = (spec: ProjectSpec) => run(spec).s.findings.map((f) => f.rule);
const base = (files: Record<string, string>) => ({
  'src/app/layout.tsx': GOOD_LAYOUT,
  'src/app/page.tsx': GOOD_PAGE,
  ...files,
});

describe('compliant project', () => {
  it('has no findings and passes in full mode', () => {
    const { root, s } = run({ files: base({ 'src/app/orders/page.tsx': GOOD_PAGE }) });
    expect(s.findings).toEqual([]);
    expect(judge(root, s).code).toBe(0);
    expect(s.denominator).toEqual({ pages: 2, layouts: 1, sourceFiles: 3, exemptions: 0 });
  });
});

describe('LOADING_MISSING', () => {
  const page = `export default async function Page() { const x = await getData(); return <p data-shell>{x}</p>; }`;
  it('fires when a page awaits data and its segment has no loading file', () => {
    expect(rules({ files: base({ 'src/app/a/page.tsx': page }) })).toEqual(['LOADING_MISSING']);
  });
  it('is satisfied by a loading.tsx in the same segment', () => {
    expect(
      rules({
        files: base({
          'src/app/a/page.tsx': page,
          'src/app/a/loading.tsx': 'export default () => null',
        }),
      })
    ).toEqual([]);
  });
  it('does not fire for awaiting params or searchParams only', () => {
    const p = `export default async function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <p>{id}</p>; }`;
    expect(rules({ files: base({ 'src/app/a/page.tsx': p }) })).toEqual([]);
  });
  it('ignores an await inside a nested function and inside a comment or string', () => {
    const p = `// await getData()
export default function Page() { const s = "await getData()"; const f = async () => { await getData(); }; return <p onClick={f}>{s}</p>; }`;
    expect(rules({ files: base({ 'src/app/a/page.tsx': p }) })).toEqual([]);
  });
});

describe('LAYOUT_AWAITS_DATA', () => {
  const dataLayout = `export default async function Layout({ children }) { const u = await getUser(); return <div>{u}{children}</div>; }`;
  const cookieLayout = `import { cookies } from 'next/headers';
export default async function Layout({ children }) { const c = await cookies(); return <div data-theme={c.get('t')?.value}>{children}</div>; }`;
  it('fires on a data await', () => {
    expect(rules({ files: base({ 'src/app/a/layout.tsx': dataLayout }) })).toEqual([
      'LAYOUT_AWAITS_DATA',
    ]);
  });
  it('fires on a request primitive with no written reason', () => {
    expect(rules({ files: base({ 'src/app/a/layout.tsx': cookieLayout }) })).toEqual([
      'LAYOUT_AWAITS_DATA',
    ]);
  });
  it('accepts an exemption with a reason of at least 40 characters, and rejects a short one', () => {
    const files = base({ 'src/app/a/layout.tsx': cookieLayout });
    const long = {
      exemptions: {
        layoutAwaits: {
          'src/app/a/layout.tsx': 'data-theme must be on <html> in the first byte of the response',
        },
      },
    };
    const short = { exemptions: { layoutAwaits: { 'src/app/a/layout.tsx': 'needed' } } };
    expect(rules({ files, area: long })).toEqual([]);
    expect(rules({ files, area: short })).toEqual(['LAYOUT_AWAITS_DATA']);
  });
});

describe('SHELL_LESS / SHELL_PAGE_WIDE', () => {
  it('SHELL_PAGE_WIDE: one boundary around the whole return', () => {
    const p = `import { Suspense } from 'react';
export default function Page() { return (<Suspense fallback={null}><Orders /></Suspense>); }`;
    expect(rules({ files: base({ 'src/app/a/page.tsx': p }) })).toEqual(['SHELL_PAGE_WIDE']);
  });
  it('SHELL_PAGE_WIDE also through a bare fragment', () => {
    const p = `import { Suspense } from 'react';
export default function Page() { return (<><Suspense fallback={null}><Orders /></Suspense></>); }`;
    expect(rules({ files: base({ 'src/app/a/page.tsx': p }) })).toEqual(['SHELL_PAGE_WIDE']);
  });
  it('SHELL_LESS: chrome outside the boundary but nothing marked data-shell', () => {
    const p = `import { Suspense } from 'react';
export default function Page() { return (<main><h1>Orders</h1><Suspense fallback={null}><Orders /></Suspense></main>); }`;
    expect(rules({ files: base({ 'src/app/a/page.tsx': p }) })).toEqual(['SHELL_LESS']);
  });
  it('data-shell only INSIDE the boundary does not count; inside the fallback it does', () => {
    const inside = `import { Suspense } from 'react';
export default function Page() { return (<main><Suspense fallback={null}><h1 data-shell>x</h1><Orders /></Suspense></main>); }`;
    const fallback = `import { Suspense } from 'react';
export default function Page() { return (<main><Suspense fallback={<h1 data-shell>Orders</h1>}><Orders /></Suspense></main>); }`;
    expect(rules({ files: base({ 'src/app/a/page.tsx': inside }) })).toEqual(['SHELL_LESS']);
    expect(rules({ files: base({ 'src/app/a/page.tsx': fallback }) })).toEqual([]);
  });
  it('a page with no Suspense at all is not judged by the shell rule', () => {
    expect(
      rules({
        files: base({
          'src/app/a/page.tsx': 'export default function Page() { return <p>static</p>; }',
        }),
      })
    ).toEqual([]);
  });
  it('finds the component through `export default Name` and a const arrow', () => {
    const p = `import { Suspense } from 'react';
const Page = () => (<Suspense fallback={null}><Orders /></Suspense>);
export default Page;`;
    expect(rules({ files: base({ 'src/app/a/page.tsx': p }) })).toEqual(['SHELL_PAGE_WIDE']);
  });
});

describe('INSTANT_FALSE_UNLISTED', () => {
  const p = `export const instant = false;\nexport default function Page() { return <p>x</p>; }`;
  it('fires without an exemption, not with a reasoned one', () => {
    expect(rules({ files: base({ 'src/app/a/page.tsx': p }) })).toEqual(['INSTANT_FALSE_UNLISTED']);
    const area = {
      exemptions: {
        instantFalse: {
          'src/app/a/page.tsx':
            'reads a per-user cookie at the document root, nothing to stream into',
        },
      },
    };
    expect(rules({ files: base({ 'src/app/a/page.tsx': p }), area })).toEqual([]);
  });
  it('does not fire for instant = true', () => {
    expect(rules({ files: base({ 'src/app/a/page.tsx': p.replace('false', 'true') }) })).toEqual(
      []
    );
  });
});

describe('CACHED_LAYOUT / PRIVATE_CACHE_AS_SHELL', () => {
  const cached = `'use cache';\nexport default async function Layout({ children }) { return <div>{children}</div>; }`;
  it('CACHED_LAYOUT fires for an unapproved directive and for an approval of a different directive', () => {
    expect(rules({ files: base({ 'src/app/a/layout.tsx': cached }) })).toEqual(['CACHED_LAYOUT']);
    const wrong = {
      exemptions: {
        cachedLayouts: {
          'src/app/a/layout.tsx': {
            directive: 'use cache: remote',
            reason: 'labels only, identical for every user and changed only on deploy',
          },
        },
      },
    };
    expect(rules({ files: base({ 'src/app/a/layout.tsx': cached }), area: wrong })).toEqual([
      'CACHED_LAYOUT',
    ]);
    const ok = {
      exemptions: {
        cachedLayouts: {
          'src/app/a/layout.tsx': {
            directive: 'use cache',
            reason: 'labels only, identical for every user and changed only on deploy',
          },
        },
      },
    };
    expect(rules({ files: base({ 'src/app/a/layout.tsx': cached }), area: ok })).toEqual([]);
  });
  it('"use cache: private" is PRIVATE_CACHE_AS_SHELL only (never also CACHED_LAYOUT)', () => {
    const priv = cached.replace("'use cache'", "'use cache: private'");
    expect(rules({ files: base({ 'src/app/a/layout.tsx': priv }) })).toEqual([
      'PRIVATE_CACHE_AS_SHELL',
    ]);
    const page = `export default async function Page() { 'use cache: private'; return <p>x</p>; }`;
    expect(rules({ files: base({ 'src/app/b/page.tsx': page }) })).toEqual([
      'PRIVATE_CACHE_AS_SHELL',
    ]);
  });
});

describe('SEGMENT_CONFIG_INCOMPATIBLE', () => {
  const p = `export const dynamic = 'force-dynamic';\nexport const runtime = 'edge';\nexport default function Page() { return <p>x</p>; }`;
  it('is quiet before the SWITCH and fires for each incompatible export after it', () => {
    expect(rules({ files: base({ 'src/app/a/page.tsx': p }) })).toEqual([]);
    expect(rules({ files: base({ 'src/app/a/page.tsx': p }), area: { switch: true } })).toEqual([
      'SEGMENT_CONFIG_INCOMPATIBLE',
      'SEGMENT_CONFIG_INCOMPATIBLE',
    ]);
  });
  it("runtime = 'nodejs' is not edge", () => {
    expect(
      rules({
        files: base({
          'src/app/a/page.tsx': p.replace(/export const dynamic.*\n/, '').replace('edge', 'nodejs'),
        }),
        area: { switch: true },
      })
    ).toEqual([]);
  });
});

describe('TESTING_API_EXPOSED', () => {
  it('fires when next.config sets the flag directly', () => {
    const cfg = `export default { experimental: { exposeTestingApiInProductionBuild: true } };`;
    expect(rules({ files: base({ 'next.config.ts': cfg }) })).toEqual(['TESTING_API_EXPOSED']);
  });
  it('does not fire for a config that never mentions it', () => {
    expect(
      rules({ files: base({ 'next.config.ts': 'export default { reactStrictMode: true };' }) })
    ).toEqual([]);
  });
});

describe('cannot measure (exit 3), never a pass', () => {
  const expectCannot = (spec: ProjectSpec, msg: RegExp) => {
    const p = makeProject(spec);
    cleanups.push(p.done);
    expect(() => scan(p.root)).toThrow(CannotMeasure);
    expect(() => scan(p.root)).toThrow(msg);
  };
  it('no standards.json', () =>
    expectCannot({ files: base({}), standards: false }, /no standards\.json/));
  it('no app directory', () => expectCannot({ files: {} }, /no src\/app or app directory/));
  it('fewer pages than minRoutes (the positive control)', () =>
    expectCannot(
      { files: base({}), area: { minRoutes: 5 } },
      /fewer than the declared minRoutes 5/
    ));
  it('a missing minRoutes', () =>
    expectCannot(
      { files: base({}), area: { minRoutes: undefined } },
      /minRoutes must be a positive integer/
    ));
  it('next below the feature floor', () =>
    expectCannot({ files: base({}), next: '16.2.9' }, /below the feature floor/));
  it('a file that does not parse', () =>
    expectCannot(
      { files: base({ 'src/app/a/page.tsx': 'export default function ( {' }) },
      /does not parse/
    ));
});

describe('private folders are not routes', () => {
  it('skips src/app/_components', () => {
    const { s } = run({
      files: base({
        'src/app/_components/page.tsx': `import { Suspense } from 'react';\nexport default () => (<Suspense fallback={null}><X /></Suspense>);`,
      }),
    });
    expect(s.findings).toEqual([]);
    expect(s.denominator.pages).toBe(1);
  });
});
