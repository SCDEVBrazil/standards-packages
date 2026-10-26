import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  compare,
  readBaseline,
  stagedAdditions,
  toEntries,
  writeBaseline,
  type DebtEntry,
} from './baseline';
import { loadConfig } from './config';
import { CannotMeasure, EXIT, type ExitCode } from './exit-codes';
import { RULES, type RuleContext } from './rules';
import { parseFile, type ParsedFile } from './scan/ast';
import { freshness, unstableCacheAudit } from './rules/freshness';
import { waterfalls } from './rules/waterfall';
import { findRoutes, findSourceFiles, findSpecs } from './scan/routes';
import { BASELINE_PATH, type Advisory, type AreaConfig, type Finding } from './types';

/** The feature floor (SPEC §5): partial prefetching first shipped in Next 16.3. */
const NEXT_FLOOR = [16, 3, 0] as const;

/** The result of scanning a project, before the ratchet is applied. */
export interface Scan {
  config: AreaConfig;
  findings: Finding[];
  /** For human judgment; never changes the exit code (SPEC P3.1, P5.1 audit). */
  advisories: Advisory[];
  nextVersion: string;
  denominator: { pages: number; layouts: number; sourceFiles: number; exemptions: number };
}

function nextVersion(root: string): string {
  const p = join(root, 'node_modules', 'next', 'package.json');
  if (!existsSync(p))
    throw new CannotMeasure(
      `next is not installed in ${root} (no node_modules/next) — run npm install first`
    );
  const v = (JSON.parse(readFileSync(p, 'utf8')) as { version?: string }).version ?? '';
  const parts = v.split(/[.-]/).map(Number);
  const below = NEXT_FLOOR.findIndex((f, i) => (parts[i] ?? 0) !== f);
  if (below !== -1 && (parts[below] ?? 0) < NEXT_FLOOR[below]!) {
    throw new CannotMeasure(
      `next ${v} is below the feature floor ${NEXT_FLOOR.join('.')} — this version cannot measure it`
    );
  }
  return v;
}

/**
 * Scans a project: config, route walk (with its positive control), parse, every rule.
 * @param root project root
 * @param override optional mode override from the command line
 * @throws CannotMeasure for any input the scan cannot trust
 */
export function scan(root: string, override?: AreaConfig['mode']): Scan {
  const config = loadConfig(root);
  if (override) config.mode = override;
  const version = nextVersion(root);
  const routes = findRoutes(root, config.minRoutes);
  const parsed = new Map<string, ParsedFile>();
  for (const f of [...routes.pages, ...routes.layouts, ...routes.defaults])
    parsed.set(f, parseFile(root, f));
  const cfgFile = ['next.config.ts', 'next.config.mjs', 'next.config.js'].find((f) =>
    existsSync(join(root, f))
  );
  const ctx: RuleContext = {
    config,
    routes,
    parsed,
    nextConfig: cfgFile ? parseFile(root, cfgFile) : null,
  };
  // Source files beyond the route files: parsed once, reused (a route file is not parsed twice).
  const code = findSourceFiles(root, routes.appDir).map((f) => parsed.get(f) ?? parseFile(root, f));
  const findings = [...RULES.flatMap((r) => r(ctx)), ...freshness(ctx, code)].sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule)
  );
  const advisories: Advisory[] = [
    ...waterfalls(code),
    ...unstableCacheAudit(code).map((u) => ({
      kind: 'UNSTABLE_CACHE' as const,
      ...u,
      message:
        'unstable_cache: check what it caches and that every write to that data calls revalidateTag/revalidatePath',
    })),
    // SPEC Tests: an instant() test must have failed before its fix. The proof is a `@fails-before <commit>` line in
    // the spec, so a reviewer can check out that commit and watch it go red.
    ...findSpecs(root).flatMap((file) => {
      const text = readFileSync(join(root, file), 'utf8');
      // The all-zero commit is the reference spec's placeholder, not a proof.
      if (!/\binstant\s*\(/.test(text) || /@fails-before\s+(?!0+\b)[0-9a-f]{7,40}\b/.test(text))
        return [];
      return [
        {
          kind: 'INSTANT_SPEC_NO_PROOF' as const,
          file,
          line: 1,
          message:
            'this instant() spec has no `@fails-before <commit>` line — record the commit where it was red before its fix',
        },
      ];
    }),
  ];
  const ex = config.exemptions;
  return {
    config,
    findings,
    advisories,
    nextVersion: version,
    denominator: {
      pages: routes.pages.length,
      layouts: routes.layouts.length,
      sourceFiles: code.length,
      exemptions:
        Object.keys(ex.layoutAwaits).length +
        Object.keys(ex.instantFalse).length +
        Object.keys(ex.cachedLayouts).length +
        Object.keys(ex.freshnessApproved).length,
    },
  };
}

/** What `check` decided, with everything needed to explain it. */
export interface Verdict {
  code: ExitCode;
  scan: Scan;
  /** Findings that count against the project (all of them in full mode; only new ones in ratchet mode). */
  blocking: Finding[];
  /** Baseline entries that no longer violate (ratchet mode): they must be pruned, never left. */
  stale: DebtEntry[];
  /** Entries a staged baseline adds by hand (only with --staged-baseline). */
  handAdded: DebtEntry[];
  baselined: number;
}

/** Applies full/ratchet semantics to a scan (SPEC P6.2). */
export function judge(root: string, s: Scan, opts: { stagedBaseline?: boolean } = {}): Verdict {
  const handAdded = opts.stagedBaseline ? stagedAdditions(root) : [];
  const base: Omit<Verdict, 'code'> = {
    scan: s,
    blocking: s.findings,
    stale: [],
    handAdded,
    baselined: 0,
  };
  if (s.config.mode === 'full') {
    return { ...base, code: s.findings.length || handAdded.length ? EXIT.FAIL : EXIT.PASS };
  }
  const b = readBaseline(root);
  if (!b) {
    throw new CannotMeasure(
      `mode is "${s.config.mode}" but ${BASELINE_PATH} does not exist — write it once with: npx instant-nav baseline`
    );
  }
  const { added, stale } = compare(b, toEntries(s.findings));
  const addedKeys = new Set(added.map((e) => `${e.rule} ${e.file}`));
  const blocking = s.findings.filter((f) => addedKeys.has(`${f.rule} ${f.file}`));
  return {
    ...base,
    blocking,
    stale,
    baselined: b.count,
    code: blocking.length || stale.length || handAdded.length ? EXIT.FAIL : EXIT.PASS,
  };
}

/** Human-readable report. The denominator always prints, so a pass over nothing cannot look like a pass. */
export function render(v: Verdict): string {
  const { scan: s } = v;
  const lines: string[] = [];
  for (const f of v.blocking)
    lines.push(`${f.rule}  ${f.file}:${f.line}\n    ${f.message}\n    fix: ${f.fix}`);
  for (const e of v.stale) {
    lines.push(
      `STALE_BASELINE  ${e.file}\n    ${e.rule} no longer occurs here\n    fix: npx instant-nav baseline --prune`
    );
  }
  for (const e of v.handAdded) {
    lines.push(
      `BASELINE_GREW  ${BASELINE_PATH}\n    adds ${e.rule} ${e.file} by hand — the debt list may only shrink`
    );
  }
  if (s.advisories.length) {
    lines.push('needs human judgment (never blocking):');
    for (const a of s.advisories) lines.push(`  ${a.kind}  ${a.file}:${a.line}  ${a.message}`);
  }
  const d = s.denominator;
  lines.push(
    `instant-nav check (${s.config.mode}, next ${s.nextVersion}${s.config.switch ? ', switch on' : ''}): ` +
      `${d.pages} pages + ${d.layouts} layouts (${d.sourceFiles} source files) scanned, ${d.exemptions} exemption(s) with reasons, ` +
      (s.config.mode === 'full' ? '' : `${v.baselined} baselined, `) +
      `${v.blocking.length} blocking, ${v.stale.length} stale → ${v.code === EXIT.PASS ? 'PASS' : 'FAIL'}`
  );
  return lines.join('\n');
}

const flag = (args: string[], name: string): boolean => args.includes(name);
const value = (args: string[], name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

/** `instant-nav check [--root <dir>] [--mode full|ratchet] [--json] [--staged-baseline]` */
export async function runCheck(args: string[]): Promise<ExitCode> {
  const root = value(args, '--root') ?? process.cwd();
  const mode = value(args, '--mode') as AreaConfig['mode'] | undefined;
  if (mode && mode !== 'full' && mode !== 'ratchet') {
    process.stderr.write('instant-nav check: --mode must be full or ratchet\n');
    return EXIT.USAGE;
  }
  const v = judge(root, scan(root, mode), { stagedBaseline: flag(args, '--staged-baseline') });
  if (flag(args, '--json')) {
    const { config, ...rest } = v.scan;
    process.stdout.write(
      `${JSON.stringify({ code: v.code, mode: config.mode, ...rest, blocking: v.blocking, stale: v.stale, handAdded: v.handAdded }, null, 2)}\n`
    );
  } else {
    process.stdout.write(`${render(v)}\n`);
  }
  return v.code;
}

/**
 * `instant-nav baseline [--root <dir>] [--prune]`: writes the debt list once, then only ever prunes it. Refuses
 * to grow an existing baseline: new debt is fixed, not recorded.
 */
export async function runBaseline(args: string[]): Promise<ExitCode> {
  const root = value(args, '--root') ?? process.cwd();
  const s = scan(root);
  const current = toEntries(s.findings);
  const existing = readBaseline(root);
  if (!existing) {
    const b = writeBaseline(root, current);
    process.stdout.write(
      `wrote ${BASELINE_PATH}: ${b.count} entr${b.count === 1 ? 'y' : 'ies'} (the debt list may only shrink from now on)\n`
    );
    return EXIT.PASS;
  }
  const { added, stale } = compare(existing, current);
  if (!flag(args, '--prune')) {
    process.stderr.write(
      `${BASELINE_PATH} already exists — use --prune to remove fixed entries; it is never regenerated\n`
    );
    return EXIT.USAGE;
  }
  const keep = new Set(stale.map((e) => `${e.rule} ${e.file}`));
  const pruned = existing.entries.filter((e) => !keep.has(`${e.rule} ${e.file}`));
  writeBaseline(root, pruned);
  process.stdout.write(
    `pruned ${stale.length} fixed entr${stale.length === 1 ? 'y' : 'ies'}; ${pruned.length} remain\n`
  );
  if (added.length) {
    process.stderr.write(
      `${added.length} new violation(s) are NOT added — fix them (instant-nav check lists them)\n`
    );
    return EXIT.FAIL;
  }
  return EXIT.PASS;
}
