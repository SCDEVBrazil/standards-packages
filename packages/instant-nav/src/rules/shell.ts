import { shellFacts } from '../scan/ast';
import type { Finding } from '../types';
import type { Rule } from './context';

/**
 * SHELL_PAGE_WIDE / SHELL_LESS (SPEC P2.1): a page that renders a <Suspense> must leave something marked
 * `data-shell` outside every boundary. One boundary around the whole return is its own rule: it looks like
 * streaming and paints nothing first (the WMS 394 ms defect).
 */
export const shell: Rule = ({ routes, parsed }) =>
  routes.pages.flatMap((file): Finding[] => {
    const p = parsed.get(file);
    if (!p) return [];
    const f = shellFacts(p);
    if (!f.suspense || f.shellOutside) return [];
    if (f.pageWide) {
      return [
        {
          rule: 'SHELL_PAGE_WIDE',
          file,
          line: f.line,
          message: 'one <Suspense> wraps the whole page, so nothing paints before the data arrives',
          fix: 'move the title and chrome outside the boundary (marked data-shell) and give each data region its own <Suspense>',
        },
      ];
    }
    return [
      {
        rule: 'SHELL_LESS',
        file,
        line: f.line,
        message:
          'the page renders <Suspense> but no element marked data-shell outside it — there is no shell to prefetch',
        fix: 'render the page title (or header) outside every boundary and put data-shell on it',
      },
    ];
  });
