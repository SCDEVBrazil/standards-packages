import type { ParsedFile } from '../scan/ast';
import type { RouteFiles } from '../scan/routes';
import type { AreaConfig, Finding } from '../types';

/** Everything a rule may read. Rules are pure: they never touch the filesystem themselves. */
export interface RuleContext {
  config: AreaConfig;
  routes: RouteFiles;
  /** Parsed pages and layouts, keyed by project-relative path. */
  parsed: Map<string, ParsedFile>;
  /** The parsed next.config, when one exists. */
  nextConfig: ParsedFile | null;
}

export type Rule = (ctx: RuleContext) => Finding[];

/** Awaits that read the URL (no round trip, SPEC P2.2). */
export const PARAM_AWAITS = new Set([
  'params',
  'searchParams',
  'props.params',
  'props.searchParams',
]);
/** Awaits that read the request (no round trip, SPEC P2.3). */
export const REQUEST_AWAITS = new Set([...PARAM_AWAITS, 'cookies', 'headers', 'draftMode']);

/** The directory of a project-relative file path. */
export const dirOf = (file: string): string => file.slice(0, file.lastIndexOf('/'));
