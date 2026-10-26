import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';
import { CannotMeasure, EXIT, type ExitCode } from './exit-codes';
import { parseFile } from './scan/ast';

const value = (args: string[], name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

/** The text of the first element marked data-shell in the page's component, or null. */
export function shellTitle(root: string, pageFile: string): string | null {
  const p = parseFile(root, pageFile);
  let title: string | null = null;
  const visit = (n: ts.Node): void => {
    if (title !== null) return;
    if (ts.isJsxElement(n)) {
      const marked = n.openingElement.attributes.properties.some(
        (a) => ts.isJsxAttribute(a) && a.name.getText() === 'data-shell'
      );
      const text = n.children
        .filter(ts.isJsxText)
        .map((c) => c.text.trim())
        .join(' ')
        .trim();
      if (marked && text) title = text;
    }
    ts.forEachChild(n, visit);
  };
  visit(p.sf);
  return title;
}

/**
 * `instant-nav scaffold-loading <route dir> [--root <dir>] [--title <text>]` (SPEC P2.2): writes `<dir>/loading.tsx`
 * from the reference block, using the page's own data-shell title. Never overwrites. The output must be reviewed:
 * the skeleton shape (list, form, detail) is a judgment the tool cannot make, so it defaults to a list and says so.
 */
export async function runScaffoldLoading(args: string[]): Promise<ExitCode> {
  const root = value(args, '--root') ?? process.cwd();
  const dir = args.find(
    (a, i) => !a.startsWith('--') && args[i - 1] !== '--root' && args[i - 1] !== '--title'
  );
  if (!dir) {
    process.stderr.write(
      'usage: instant-nav scaffold-loading <route dir, e.g. src/app/orders> [--title <text>]\n'
    );
    return EXIT.USAGE;
  }
  const page = ['page.tsx', 'page.jsx', 'page.ts', 'page.js']
    .map((f) => join(dir, f))
    .find((f) => existsSync(join(root, f)));
  if (!page) throw new CannotMeasure(`no page file in ${dir}`);
  const out = join(root, dir, 'loading.tsx');
  if (existsSync(out)) {
    process.stderr.write(`${join(dir, 'loading.tsx')} already exists — not overwritten\n`);
    return EXIT.USAGE;
  }
  const title = value(args, '--title') ?? shellTitle(root, page.split(sep).join('/'));
  if (!title) {
    throw new CannotMeasure(
      `${page} has no element marked data-shell with text — give the page its title first (SPEC P2.1), or pass --title`
    );
  }
  const body = [
    `// loading.tsx for ${dir.split(sep).join('/')} — scaffolded by instant-nav (SPEC P2.2). REVIEW IT: the shape below is a`,
    '// list; a form or a detail page needs FormSkeleton or its own shape, so the frame does not jump (SPEC P2.6).',
    "import { ListPageSkeleton } from '@/components/ui/PageSkeletons';",
    '',
    'export default function Loading() {',
    `  return <ListPageSkeleton title={${JSON.stringify(title)}} actions={1} rows={8} />;`,
    '}',
    '',
  ].join('\n');
  writeFileSync(out, body, { flag: 'wx' });
  process.stdout.write(
    `wrote ${join(dir, 'loading.tsx')} (title "${title}") — review the skeleton shape\n`
  );
  return EXIT.PASS;
}

// ── stamp-verify: the same algorithm as the workspace's scripts/standards-json.mjs, so a project can check its
//    vendored blocks without the workspace (block = lines strictly between the stamp and @end-standard, CRLF→LF,
//    trailing whitespace trimmed per line). ──
const STAMP_RE = /@standard ([a-z0-9-]+)@(\d+\.\d+) sha256:([0-9a-f]{64}|pending)/;
const END_RE = /@end-standard\b/;
const SKIP = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'coverage',
  '.vercel',
  'generated',
]);

export interface StampResult {
  file: string;
  line: number;
  area: string;
  version: string;
  state: 'ok' | 'drift' | 'unstamped';
}

/** Every stamped block under `root`, with whether its content still matches its stamp. */
export function verifyStamps(root: string): StampResult[] {
  const out: StampResult[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d)) {
      const full = join(d, e);
      if (statSync(full).isDirectory()) {
        if (!SKIP.has(e)) walk(full);
        continue;
      }
      let text: string;
      try {
        text = readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      if (!text.includes('@standard ')) continue;
      const lines = text.replace(/\r\n/g, '\n').split('\n');
      for (let i = 0; i < lines.length; i++) {
        const m = STAMP_RE.exec(lines[i]!);
        if (!m) continue;
        let j = i + 1;
        while (j < lines.length && !END_RE.test(lines[j]!) && !STAMP_RE.test(lines[j]!)) j++;
        const hash = createHash('sha256')
          .update(
            lines
              .slice(i + 1, j)
              .map((l) => l.replace(/\s+$/, ''))
              .join('\n'),
            'utf8'
          )
          .digest('hex');
        out.push({
          file: relative(root, full).split(sep).join('/'),
          line: i + 1,
          area: m[1]!,
          version: m[2]!,
          state: m[3] === 'pending' ? 'unstamped' : m[3] === hash ? 'ok' : 'drift',
        });
      }
    }
  };
  walk(root);
  return out;
}

/** `instant-nav stamp-verify [--root <dir>]`: exit 0 all blocks match · 1 drift or unstamped · 3 none found. */
export async function runStampVerify(args: string[]): Promise<ExitCode> {
  const root = value(args, '--root') ?? process.cwd();
  const r = verifyStamps(root).filter((x) => x.area === 'perf-instant-nav');
  if (!r.length) throw new CannotMeasure(`no perf-instant-nav stamped blocks under ${root}`);
  for (const x of r)
    process.stdout.write(`${x.state.padEnd(10)}${x.file}:${x.line}  ${x.area}@${x.version}\n`);
  const bad = r.filter((x) => x.state !== 'ok');
  process.stdout.write(
    `${r.length} stamped block(s): ${r.length - bad.length} ok, ${bad.length} not ok\n`
  );
  return bad.length ? EXIT.FAIL : EXIT.PASS;
}
