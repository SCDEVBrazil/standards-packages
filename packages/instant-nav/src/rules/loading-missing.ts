import { dirOf, PARAM_AWAITS, type Rule } from './context';

/** LOADING_MISSING (SPEC P2.2): a page that awaits data needs a loading file in its own segment. */
export const loadingMissing: Rule = ({ routes, parsed }) =>
  routes.pages.flatMap((file) => {
    const p = parsed.get(file);
    const data = (p?.awaits ?? []).filter((a) => !PARAM_AWAITS.has(a.root));
    if (!data.length || routes.loadingDirs.has(dirOf(file))) return [];
    return [
      {
        rule: 'LOADING_MISSING' as const,
        file,
        line: data[0]!.line,
        message: `the page awaits ${[...new Set(data.map((a) => a.root))].join(', ')} and its segment has no loading.tsx, so the navigation shows nothing until the data arrives`,
        fix: `add ${dirOf(file)}/loading.tsx rendering the page's real shell (title + data-shell) with the shared skeletons — npx instant-nav scaffold-loading`,
      },
    ];
  });
