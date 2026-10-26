import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { runCommand } from '../src/commands';
import { scan } from '../src/index';
import { verifyStamps } from '../src/scaffold';
import { GOOD_LAYOUT, makeProject } from './helpers';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((f) => f()));
const quiet = () => {};

const PAGE = `export default async function Page() {\n  const rows = await getRows();\n  return <main><h1 data-shell>Carriers</h1><p>{rows.length}</p></main>;\n}\n`;

describe('scaffold-loading', () => {
  it("writes loading.tsx with the page's own data-shell title, which clears LOADING_MISSING", async () => {
    const p = makeProject({
      files: { 'src/app/layout.tsx': GOOD_LAYOUT, 'src/app/carriers/page.tsx': PAGE },
    });
    cleanups.push(p.done);
    expect(scan(p.root).findings.map((f) => f.rule)).toEqual(['LOADING_MISSING']);
    expect(
      await runCommand('scaffold-loading', ['src/app/carriers', '--root', p.root], quiet)
    ).toBe(0);
    const out = readFileSync(`${p.root}/src/app/carriers/loading.tsx`, 'utf8');
    expect(out).toMatch(/<ListPageSkeleton title=\{"Carriers"\}/);
    expect(out).toMatch(/REVIEW IT/);
    expect(scan(p.root).findings).toEqual([]);
  });

  it('never overwrites, and refuses a page with no titled data-shell (CANNOT MEASURE)', async () => {
    const p = makeProject({
      files: {
        'src/app/layout.tsx': GOOD_LAYOUT,
        'src/app/a/page.tsx': PAGE,
        'src/app/a/loading.tsx': 'keep me',
        'src/app/b/page.tsx': PAGE.replace(' data-shell', ''),
      },
    });
    cleanups.push(p.done);
    expect(await runCommand('scaffold-loading', ['src/app/a', '--root', p.root], quiet)).toBe(2);
    expect(readFileSync(`${p.root}/src/app/a/loading.tsx`, 'utf8')).toBe('keep me');
    await expect(
      runCommand('scaffold-loading', ['src/app/b', '--root', p.root], quiet)
    ).rejects.toThrow(/no element marked data-shell/);
    expect(existsSync(`${p.root}/src/app/b/loading.tsx`)).toBe(false);
  });
});

describe('stamp-verify', () => {
  const ws = fileURLToPath(new URL('../../../../../', import.meta.url));
  const ref = `${ws}standards/areas/perf-instant-nav/reference`;
  it.runIf(existsSync(ref))(
    'agrees with the workspace tool on the real reference blocks (all ok)',
    () => {
      const r = verifyStamps(ref);
      expect(r.length).toBe(9);
      expect(r.filter((x) => x.state !== 'ok')).toEqual([]);
      const ws2 = spawnSync(
        process.execPath,
        [`${ws}scripts/standards-json.mjs`, 'stamp-verify', ref],
        { encoding: 'utf8' }
      );
      expect(ws2.status).toBe(0);
    }
  );

  it('reports drift after a one-character edit, and exit 3 when there are no stamps', async () => {
    const block = `// @standard perf-instant-nav@1.0 sha256:${'0'.repeat(64)}\nconst a = 1;\n// @end-standard\n`;
    const p = makeProject({ files: { 'x.ts': block } });
    cleanups.push(p.done);
    expect(verifyStamps(p.root).map((x) => x.state)).toEqual(['drift']);
    expect(await runCommand('stamp-verify', ['--root', p.root], quiet)).toBe(1);
    const empty = makeProject({ files: {} });
    cleanups.push(empty.done);
    await expect(runCommand('stamp-verify', ['--root', empty.root], quiet)).rejects.toThrow(
      /no perf-instant-nav stamped blocks/
    );
  });
});
