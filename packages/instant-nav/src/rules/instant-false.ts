import ts from 'typescript';
import { isReason } from '../config';
import type { Rule } from './context';

/**
 * INSTANT_FALSE_UNLISTED (SPEC P4.2): `export const instant = false` switches off instant-navigation validation
 * for the segment. It is allowed as a visible parking spot, never silently: every one needs a written reason.
 */
export const instantFalse: Rule = ({ routes, parsed, config }) =>
  [...routes.pages, ...routes.layouts].flatMap((file) => {
    const e = parsed.get(file)?.segmentExports.get('instant');
    if (!e || e.node.kind !== ts.SyntaxKind.FalseKeyword) return [];
    if (isReason(config.exemptions.instantFalse[file])) return [];
    return [
      {
        rule: 'INSTANT_FALSE_UNLISTED' as const,
        file,
        line: e.line,
        message:
          'export const instant = false opts this segment out of validation with no written reason',
        fix: `make the segment instant, or add exemptions.instantFalse["${file}"] with a reason of at least 40 characters`,
      },
    ];
  });
