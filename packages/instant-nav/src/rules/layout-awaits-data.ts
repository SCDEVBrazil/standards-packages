import { isReason } from '../config';
import { REQUEST_AWAITS, type Rule } from './context';

/**
 * LAYOUT_AWAITS_DATA (SPEC P2.3): a layout sits above every page under it, so one await re-blocks the whole
 * subtree. A data await is always a violation unless exempted with a reason; a request primitive (cookies,
 * headers, params) also needs a written reason, because it still blocks the static shell.
 */
export const layoutAwaitsData: Rule = ({ routes, parsed, config }) =>
  routes.layouts.flatMap((file) => {
    const awaits = parsed.get(file)?.awaits ?? [];
    if (!awaits.length || isReason(config.exemptions.layoutAwaits[file])) return [];
    const data = awaits.filter((a) => !REQUEST_AWAITS.has(a.root));
    const names = (list: typeof awaits) => [...new Set(list.map((a) => a.root))].join(', ');
    const short =
      file in config.exemptions.layoutAwaits
        ? ' (its exemption reason is under 40 characters)'
        : '';
    return [
      {
        rule: 'LAYOUT_AWAITS_DATA' as const,
        file,
        line: (data[0] ?? awaits[0]!).line,
        message: data.length
          ? `the layout awaits ${names(data)} — every page beneath it waits for that read${short}`
          : `the layout awaits the request primitive ${names(awaits)} with no written reason${short}`,
        fix: data.length
          ? 'pass the promise down and resolve it inside a <Suspense> in the component that needs it'
          : `push the read down, or add exemptions.layoutAwaits["${file}"] with a reason of at least 40 characters`,
      },
    ];
  });
