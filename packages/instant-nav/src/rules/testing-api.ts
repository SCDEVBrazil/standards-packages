import ts from 'typescript';
import type { Rule } from './context';

const KEY = 'exposeTestingApiInProductionBuild';

/**
 * TESTING_API_EXPOSED (SPEC P6.5): Next says this flag must not be on in a user-facing production deployment.
 * Only withInstantNav() may set it (behind INSTANT_NAV_E2E=1, and never with VERCEL=1), so any appearance of the
 * key in next.config is a violation.
 */
export const testingApi: Rule = ({ nextConfig }) => {
  if (!nextConfig) return [];
  const out: ReturnType<Rule> = [];
  const visit = (n: ts.Node): void => {
    const name =
      (ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n)) &&
      n.name.getText().replace(/['"]/g, '');
    const access = ts.isPropertyAccessExpression(n) && n.name.text === KEY;
    if (name === KEY || access) {
      out.push({
        rule: 'TESTING_API_EXPOSED',
        file: nextConfig.file,
        line: nextConfig.sf.getLineAndCharacterOfPosition(n.getStart(nextConfig.sf)).line + 1,
        message: `${KEY} is set in next.config directly, so it can reach a production build`,
        fix: 'remove it and wrap the config in withInstantNav(); the e2e job sets INSTANT_NAV_E2E=1, which turns it on only there',
      });
    }
    ts.forEachChild(n, visit);
  };
  visit(nextConfig.sf);
  return out;
};
