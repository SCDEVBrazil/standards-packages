/** Blocking rule ids printed by `instant-nav check` (SPEC §4). `WATERFALL?` is an advisory, never a rule. */
export type RuleId =
  | 'LOADING_MISSING'
  | 'LAYOUT_AWAITS_DATA'
  | 'SHELL_LESS'
  | 'SHELL_PAGE_WIDE'
  | 'INSTANT_FALSE_UNLISTED'
  | 'CACHED_LAYOUT'
  | 'PRIVATE_CACHE_AS_SHELL'
  | 'SEGMENT_CONFIG_INCOMPATIBLE'
  | 'TESTING_API_EXPOSED'
  | 'FRESHNESS_TTL';

/** One violation. `file` is relative to the project root, with forward slashes. */
export interface Finding {
  rule: RuleId;
  file: string;
  line: number;
  message: string;
  fix: string;
}

/** Exemption maps (SPEC P6.3). Every reason must be at least {@link MIN_REASON} characters. */
export interface Exemptions {
  /** layout file → why it may await (a request primitive, or data). */
  layoutAwaits: Record<string, string>;
  /** page/layout file → why it may export `instant = false`. */
  instantFalse: Record<string, string>;
  /** layout file → the exact directive approved and why that data is cacheable. */
  cachedLayouts: Record<string, { directive: string; reason: string }>;
  /** file → Renan's approval of a cache timer there (SPEC P5.1): the reason and the date he approved it. */
  freshnessApproved: Record<string, { reason: string; approved: string }>;
}

/** A non-blocking finding for human judgment (SPEC P3.1). It never changes the exit code. */
export interface Advisory {
  kind: 'WATERFALL?' | 'UNSTABLE_CACHE' | 'INSTANT_SPEC_NO_PROOF';
  file: string;
  line: number;
  message: string;
}

/** The `areas["perf-instant-nav"]` record of a project's standards.json, as the check needs it. */
export interface AreaConfig {
  mode: 'full' | 'ratchet' | 'adopting';
  /** The SWITCH (cacheComponents + partialPrefetching) is on. */
  switch: boolean;
  /** Positive control: fewer routes found than this ⇒ exit 3 (SPEC P6.1). */
  minRoutes: number;
  exemptions: Exemptions;
}

export const MIN_REASON = 40;
export const AREA = 'perf-instant-nav';
export const BASELINE_PATH = 'standards/baseline/perf-instant-nav.json';
