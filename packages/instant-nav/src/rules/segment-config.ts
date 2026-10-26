import ts from 'typescript';
import type { Rule } from './context';

const INCOMPATIBLE = ['dynamic', 'revalidate', 'fetchCache', 'dynamicParams'] as const;

/**
 * SEGMENT_CONFIG_INCOMPATIBLE (SPEC P4.3): once the SWITCH is on, these segment exports error under Cache
 * Components. Before the SWITCH they are legal, so the rule stays quiet until standards.json says `switch: true`.
 */
export const segmentConfig: Rule = ({ routes, parsed, config }) => {
  if (!config.switch) return [];
  return [...routes.pages, ...routes.layouts, ...routes.defaults].flatMap((file) => {
    const ex = parsed.get(file)?.segmentExports;
    if (!ex) return [];
    const hits: { name: string; line: number }[] = INCOMPATIBLE.filter((n) => ex.has(n)).map(
      (n) => ({
        name: n,
        line: ex.get(n)!.line,
      })
    );
    const rt = ex.get('runtime');
    if (rt && ts.isStringLiteralLike(rt.node) && rt.node.text === 'edge')
      hits.push({ name: "runtime = 'edge'", line: rt.line });
    return hits.map((h) => ({
      rule: 'SEGMENT_CONFIG_INCOMPATIBLE' as const,
      file,
      line: h.line,
      message: `export ${h.name} errors under Cache Components, which this project has switched on`,
      fix: 'remove it as the switch-on recipe says (SPEC P4.2): await connection() for request APIs, instant = false as a listed parking spot',
    }));
  });
};
