import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { CannotMeasure } from '../exit-codes';

/** The route files the standard looks at, found by walking the app directory (never a hand-kept list). */
export interface RouteFiles {
  /** The app directory, relative to the project root (`src/app` or `app`). */
  appDir: string;
  pages: string[];
  layouts: string[];
  defaults: string[];
  /** Directories that contain a loading file, relative to the project root. */
  loadingDirs: Set<string>;
}

const EXT = /\.(tsx|ts|jsx|js)$/;
const ROLE = /^(page|layout|default|loading)\.(tsx|ts|jsx|js)$/;

/** `a\\b` → `a/b`, relative to root: the form findings and the baseline use on every OS. */
export const rel = (root: string, p: string): string => relative(root, p).split(sep).join('/');

/**
 * Walks `src/app` (or `app`) for page/layout/default/loading files. Private folders (`_name`) are not routes in
 * the App Router, so they are skipped; route groups, dynamic segments and parallel slots are walked.
 * @throws CannotMeasure when there is no app directory, or fewer pages than the declared positive control
 */
export function findRoutes(root: string, minRoutes: number): RouteFiles {
  const appDir = ['src/app', 'app'].find(
    (d) => existsSync(join(root, d)) && statSync(join(root, d)).isDirectory()
  );
  if (!appDir)
    throw new CannotMeasure(`no src/app or app directory in ${root} — not an App Router project`);
  const out: RouteFiles = { appDir, pages: [], layouts: [], defaults: [], loadingDirs: new Set() };
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (!entry.startsWith('_') && entry !== 'node_modules') walk(full);
        continue;
      }
      if (!ROLE.test(entry)) continue;
      const kind = entry.replace(EXT, '');
      const r = rel(root, full);
      if (kind === 'page') out.pages.push(r);
      else if (kind === 'layout') out.layouts.push(r);
      else if (kind === 'default') out.defaults.push(r);
      else out.loadingDirs.add(rel(root, dir));
    }
  };
  walk(join(root, appDir));
  for (const list of [out.pages, out.layouts, out.defaults]) list.sort();
  if (out.pages.length < minRoutes) {
    throw new CannotMeasure(
      `found ${out.pages.length} pages under ${appDir}, fewer than the declared minRoutes ${minRoutes} — the walk is ` +
        'not seeing the app (moved directory?), or minRoutes is wrong; nothing was checked'
    );
  }
  return out;
}

const CODE = /\.(tsx|ts|jsx|js|mjs)$/;
const NOT_CODE = /\.(test|spec)\.[cm]?[jt]sx?$|\.d\.ts$/;
const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  'dist',
  'build',
  'coverage',
  'e2e',
  '__tests__',
  'test',
]);

/**
 * Every source file the freshness rule and the waterfall advisory read: cache timers usually live in data
 * helpers, not in route files. `src/` when the app is `src/app`; otherwise the app dir plus the conventional
 * top-level code folders. Tests and generated output are left out.
 */
export function findSourceFiles(root: string, appDir: string): string[] {
  const roots =
    appDir === 'src/app'
      ? ['src']
      : [appDir, 'lib', 'components', 'features', 'utils', 'server'].filter((d) =>
          existsSync(join(root, d))
        );
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (!SKIP_DIRS.has(entry)) walk(full);
      } else if (CODE.test(entry) && !NOT_CODE.test(entry)) out.push(rel(root, full));
    }
  };
  for (const r of roots) walk(join(root, r));
  return out.sort();
}

/** Playwright specs under `e2e/` (the instant() tests of SPEC "Tests"). */
export function findSpecs(root: string): string[] {
  const dir = join(root, 'e2e');
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.spec\.[cm]?[jt]sx?$/.test(entry)) out.push(rel(root, full));
    }
  };
  walk(dir);
  return out.sort();
}
