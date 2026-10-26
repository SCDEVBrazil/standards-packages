import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CannotMeasure } from './exit-codes';
import { AREA, BASELINE_PATH, type Finding, type RuleId } from './types';

/** One debt entry: a rule broken in a file. Line numbers are left out on purpose: they move on every edit. */
export interface DebtEntry {
  rule: RuleId;
  file: string;
}

export interface Baseline {
  $schema: 'instant-nav-baseline/v1';
  area: typeof AREA;
  count: number;
  entries: DebtEntry[];
}

const key = (e: DebtEntry): string => `${e.rule} ${e.file}`;

/** Sorted, de-duplicated debt entries for a list of findings (one entry per rule per file). */
export function toEntries(findings: Pick<Finding, 'rule' | 'file'>[]): DebtEntry[] {
  const m = new Map<string, DebtEntry>();
  for (const f of findings) m.set(key(f), { rule: f.rule, file: f.file });
  return [...m.values()].sort((a, b) => key(a).localeCompare(key(b)));
}

function parseBaseline(text: string, where: string): Baseline {
  let b: Baseline;
  try {
    b = JSON.parse(text) as Baseline;
  } catch (e) {
    throw new CannotMeasure(`${where} is not valid JSON: ${(e as Error).message}`);
  }
  if (
    b.$schema !== 'instant-nav-baseline/v1' ||
    !Array.isArray(b.entries) ||
    b.count !== b.entries.length
  ) {
    throw new CannotMeasure(
      `${where} is not an instant-nav baseline (schema, entries and count must agree)`
    );
  }
  return b;
}

/** Reads the project's baseline, or null when it has none (a project in full mode has none). */
export function readBaseline(root: string): Baseline | null {
  const path = join(root, BASELINE_PATH);
  if (!existsSync(path)) return null;
  return parseBaseline(readFileSync(path, 'utf8'), BASELINE_PATH);
}

/** Writes the baseline atomically (temp file + rename), so a crash never leaves it half-written. */
export function writeBaseline(root: string, entries: DebtEntry[]): Baseline {
  const b: Baseline = {
    $schema: 'instant-nav-baseline/v1',
    area: AREA,
    count: entries.length,
    entries,
  };
  const path = join(root, BASELINE_PATH);
  mkdirSync(dirname(path), { recursive: true });
  const text = `${JSON.stringify(b, null, 2)}\n`;
  writeFileSync(`${path}.tmp`, text);
  renameSync(`${path}.tmp`, path);
  return b;
}

/** The ratchet comparison (SPEC P6.2). */
export function compare(
  baseline: Baseline,
  current: DebtEntry[]
): { added: DebtEntry[]; stale: DebtEntry[] } {
  const have = new Set(baseline.entries.map(key));
  const now = new Set(current.map(key));
  return {
    added: current.filter((e) => !have.has(key(e))),
    stale: baseline.entries.filter((e) => !now.has(key(e))),
  };
}

/**
 * Pre-commit guard: the STAGED baseline may only drop entries relative to HEAD (a pure prune). Growing the debt
 * list by hand is how a ratchet stops ratcheting.
 * @returns entries the staged copy adds; empty when it is a pure prune or the baseline is not staged
 */
export function stagedAdditions(root: string): DebtEntry[] {
  const git = (spec: string) => spawnSync('git', ['show', spec], { cwd: root, encoding: 'utf8' });
  const staged = git(`:${BASELINE_PATH}`);
  if (staged.status !== 0) return []; // not in the index: nothing staged to judge
  const head = git(`HEAD:${BASELINE_PATH}`);
  if (head.status !== 0) {
    // A first baseline is written by `instant-nav baseline`, not grown by hand; there is nothing to compare with.
    return [];
  }
  const before = new Set(parseBaseline(head.stdout, `HEAD:${BASELINE_PATH}`).entries.map(key));
  return parseBaseline(staged.stdout, `staged ${BASELINE_PATH}`).entries.filter(
    (e) => !before.has(key(e))
  );
}
