import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCommand } from '../src/commands';
import { CannotMeasure, judge, scan } from '../src/index';
import { GOOD_LAYOUT, GOOD_PAGE, makeProject } from './helpers';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((f) => f()));

const WIDE = `import { Suspense } from 'react';\nexport default function Page() { return (<Suspense fallback={null}><X /></Suspense>); }`;
const BASELINE = 'standards/baseline/perf-instant-nav.json';

function project(extra: Record<string, string>) {
  const p = makeProject({
    files: { 'src/app/layout.tsx': GOOD_LAYOUT, 'src/app/page.tsx': GOOD_PAGE, ...extra },
    area: { mode: 'ratchet' },
  });
  cleanups.push(p.done);
  return p.root;
}
const quiet = () => {};
const baseline = (root: string, ...flags: string[]) =>
  runCommand('baseline', ['--root', root, ...flags], quiet);

describe('ratchet mode', () => {
  it('without a baseline file is CANNOT MEASURE', () => {
    const root = project({ 'src/app/a/page.tsx': WIDE });
    expect(() => judge(root, scan(root))).toThrow(CannotMeasure);
  });

  it('baselined debt passes; NEW debt fails; FIXED debt must be pruned', async () => {
    const root = project({ 'src/app/a/page.tsx': WIDE });
    expect(await baseline(root)).toBe(0);
    expect(JSON.parse(readFileSync(join(root, BASELINE), 'utf8')).entries).toEqual([
      { rule: 'SHELL_PAGE_WIDE', file: 'src/app/a/page.tsx' },
    ]);
    expect(judge(root, scan(root)).code).toBe(0);

    const b = join(root, 'src/app/b');
    mkdirSync(b);
    writeFileSync(join(b, 'page.tsx'), WIDE);
    const grown = judge(root, scan(root));
    expect(grown.code).toBe(1);
    expect(grown.blocking.map((f) => f.file)).toEqual(['src/app/b/page.tsx']);

    writeFileSync(join(b, 'page.tsx'), GOOD_PAGE);
    writeFileSync(join(root, 'src/app/a/page.tsx'), GOOD_PAGE);
    const fixed = judge(root, scan(root));
    expect(fixed.code).toBe(1);
    expect(fixed.stale).toEqual([{ rule: 'SHELL_PAGE_WIDE', file: 'src/app/a/page.tsx' }]);

    expect(await baseline(root, '--prune')).toBe(0);
    expect(judge(root, scan(root)).code).toBe(0);
  });

  it('`baseline` refuses to regenerate an existing baseline, and --prune never adds new debt', async () => {
    const root = project({ 'src/app/a/page.tsx': WIDE });
    expect(await baseline(root)).toBe(0);
    expect(await baseline(root)).toBe(2);
    mkdirSync(join(root, 'src/app/c'));
    writeFileSync(join(root, 'src/app/c/page.tsx'), WIDE);
    expect(await baseline(root, '--prune')).toBe(1);
    expect(JSON.parse(readFileSync(join(root, BASELINE), 'utf8')).count).toBe(1);
  });

  it('--staged-baseline rejects a hand-grown baseline', async () => {
    const root = project({ 'src/app/a/page.tsx': WIDE });
    await baseline(root);
    const git = (...a: string[]) => spawnSync('git', a, { cwd: root, encoding: 'utf8' });
    git('init', '-q');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '.');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base');
    const b = JSON.parse(readFileSync(join(root, BASELINE), 'utf8'));
    b.entries.push({ rule: 'SHELL_LESS', file: 'src/app/zzz/page.tsx' });
    b.count = b.entries.length;
    writeFileSync(join(root, BASELINE), JSON.stringify(b));
    git('add', BASELINE);
    const v = judge(root, scan(root), { stagedBaseline: true });
    expect(v.handAdded).toEqual([{ rule: 'SHELL_LESS', file: 'src/app/zzz/page.tsx' }]);
    expect(v.code).toBe(1);
  });
});
