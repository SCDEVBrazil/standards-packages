import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export interface ProjectSpec {
  /** project-relative path → file content */
  files: Record<string, string>;
  /** areas["perf-instant-nav"] overrides */
  area?: Record<string, unknown>;
  next?: string;
  /** false ⇒ no standards.json at all */
  standards?: boolean;
}

/** A shell-compliant page: title outside, one data region in its own Suspense. */
export const GOOD_PAGE = `import { Suspense } from 'react';
async function Orders() { const rows = await getOrders(); return <ul>{rows.map((r) => <li key={r}>{r}</li>)}</ul>; }
export default function Page() {
  return (<main><h1 data-shell>Orders</h1><Suspense fallback={<p>…</p>}><Orders /></Suspense></main>);
}
`;
export const GOOD_LAYOUT = `export default function Layout({ children }: { children: React.ReactNode }) { return <section>{children}</section>; }
`;

/** Builds a throwaway project on disk; returns its root and a cleanup function. */
export function makeProject(spec: ProjectSpec): { root: string; done: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'instant-nav-'));
  const write = (rel: string, text: string) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  };
  write(
    'node_modules/next/package.json',
    JSON.stringify({ name: 'next', version: spec.next ?? '16.4.3' })
  );
  if (spec.standards !== false) {
    write(
      'standards.json',
      JSON.stringify({
        $schema: 'standards/v1',
        status: 'active',
        areas: {
          'perf-instant-nav': {
            version: '1.0',
            mode: 'full',
            since: '2026-10-24',
            minRoutes: 1,
            ...spec.area,
          },
        },
        remodel: null,
      })
    );
  }
  for (const [rel, text] of Object.entries(spec.files)) write(rel, text);
  return { root, done: () => rmSync(root, { recursive: true, force: true }) };
}
