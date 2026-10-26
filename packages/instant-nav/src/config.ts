import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CannotMeasure } from './exit-codes';
import { AREA, type AreaConfig, type Exemptions, MIN_REASON } from './types';

const MODES = ['full', 'ratchet', 'adopting'] as const;

function readJson(path: string, what: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new CannotMeasure(`${what} is unreadable (${path}): ${(e as Error).message}`);
  }
}

function stringMap(v: unknown, at: string): Record<string, string> {
  if (v === undefined) return {};
  if (!v || typeof v !== 'object' || Array.isArray(v))
    throw new CannotMeasure(`${at} must be an object`);
  const out: Record<string, string> = {};
  for (const [k, r] of Object.entries(v)) {
    if (typeof r !== 'string') throw new CannotMeasure(`${at}["${k}"] must be a string reason`);
    out[k] = r;
  }
  return out;
}

/**
 * Reads the project's `standards.json` → `areas["perf-instant-nav"]`. Anything the check cannot trust (no file,
 * area not adopted, no positive control, a malformed exemption) is CANNOT MEASURE: checking with a guessed
 * configuration would certify the wrong thing.
 * @param root the project root (where standards.json lives)
 * @returns the validated area config; reasons shorter than 40 characters are kept and reported by the rules
 */
export function loadConfig(root: string): AreaConfig {
  const path = join(root, 'standards.json');
  if (!existsSync(path)) {
    throw new CannotMeasure(
      `no standards.json in ${root} — adopt the area first (SPEC §7 step 1: scripts/standards-json.mjs init)`
    );
  }
  const rec = readJson(path, 'standards.json') as { areas?: Record<string, unknown> };
  const a = rec.areas?.[AREA] as Record<string, unknown> | undefined;
  if (!a)
    throw new CannotMeasure(
      `standards.json has no areas["${AREA}"] — the area is not adopted here`
    );
  const mode = a.mode as AreaConfig['mode'];
  if (!MODES.includes(mode)) {
    throw new CannotMeasure(
      `areas["${AREA}"].mode must be one of ${MODES.join('|')} (got ${JSON.stringify(a.mode)})`
    );
  }
  if (!Number.isInteger(a.minRoutes) || (a.minRoutes as number) < 1) {
    throw new CannotMeasure(
      `areas["${AREA}"].minRoutes must be a positive integer — it is the positive control (SPEC P6.1)`
    );
  }
  const ex = (a.exemptions ?? {}) as Record<string, unknown>;
  const cached: Exemptions['cachedLayouts'] = {};
  for (const [k, row] of Object.entries((ex.cachedLayouts ?? {}) as Record<string, unknown>)) {
    const r = row as { directive?: unknown; reason?: unknown };
    if (typeof r?.directive !== 'string' || typeof r.reason !== 'string') {
      throw new CannotMeasure(`exemptions.cachedLayouts["${k}"] needs { directive, reason }`);
    }
    cached[k] = { directive: r.directive, reason: r.reason };
  }
  const fresh: Exemptions['freshnessApproved'] = {};
  for (const [k, row] of Object.entries((ex.freshnessApproved ?? {}) as Record<string, unknown>)) {
    const r = row as { reason?: unknown; approved?: unknown };
    if (
      typeof r?.reason !== 'string' ||
      typeof r.approved !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(r.approved)
    ) {
      throw new CannotMeasure(
        `exemptions.freshnessApproved["${k}"] needs { reason, approved: YYYY-MM-DD }`
      );
    }
    fresh[k] = { reason: r.reason, approved: r.approved };
  }
  return {
    mode,
    switch: a.switch === true,
    minRoutes: a.minRoutes as number,
    exemptions: {
      layoutAwaits: stringMap(ex.layoutAwaits, 'exemptions.layoutAwaits'),
      instantFalse: stringMap(ex.instantFalse, 'exemptions.instantFalse'),
      cachedLayouts: cached,
      freshnessApproved: fresh,
    },
  };
}

/** True when an exemption reason is long enough to be a decision rather than a placeholder (SPEC P6.3). */
export const isReason = (r: string | undefined): r is string =>
  typeof r === 'string' && r.trim().length >= MIN_REASON;
