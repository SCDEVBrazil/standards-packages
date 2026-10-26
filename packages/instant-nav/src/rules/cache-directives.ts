import { isReason } from '../config';
import type { Rule } from './context';

const PRIVATE = 'use cache: private';

/**
 * PRIVATE_CACHE_AS_SHELL (SPEC P5.3): `"use cache: private"` is excluded from the static shell, so putting it on a
 * page or layout component cannot make that shell instant.
 */
export const privateCacheAsShell: Rule = ({ routes, parsed }) =>
  [...routes.pages, ...routes.layouts].flatMap((file) => {
    const d = parsed.get(file)?.directives.find((x) => x.value === PRIVATE);
    if (!d) return [];
    return [
      {
        rule: 'PRIVATE_CACHE_AS_SHELL' as const,
        file,
        line: d.line,
        message:
          '"use cache: private" on a page/layout is excluded from the static shell, so it cannot be the shell',
        fix: 'keep the shell free of per-user data; read per-user data inside a <Suspense> region instead',
      },
    ];
  });

/**
 * CACHED_LAYOUT (SPEC P4.4): a caching directive on a layout is a claim that its data may be served from a cache.
 * Each one must be approved for that exact directive, with a reason. `"use cache: private"` is
 * PRIVATE_CACHE_AS_SHELL's, so one directive never produces two findings.
 */
export const cachedLayout: Rule = ({ routes, parsed, config }) =>
  routes.layouts.flatMap((file) => {
    const d = parsed.get(file)?.directives.find((x) => x.value !== PRIVATE);
    if (!d) return [];
    const row = config.exemptions.cachedLayouts[file];
    if (row && row.directive === d.value && isReason(row.reason)) return [];
    const why = !row
      ? 'is not on the approved list'
      : row.directive !== d.value
        ? `is approved for "${row.directive}", not "${d.value}"`
        : 'has an approval reason under 40 characters';
    return [
      {
        rule: 'CACHED_LAYOUT' as const,
        file,
        line: d.line,
        message: `the layout carries "${d.value}" and ${why}`,
        fix: `remove the directive, or add exemptions.cachedLayouts["${file}"] = { directive, reason } (Renan approves business data, SPEC P5.1)`,
      },
    ];
  });
