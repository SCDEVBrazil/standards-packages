import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CannotMeasure, EXIT, type ExitCode } from '../exit-codes';
import { AREA } from '../types';
import { clerkSignInTicket } from './clerk';
import { summarize } from './stats';

/** `areas["perf-instant-nav"].measure` in standards.json: what to click and what "shell" and "content" mean. */
export interface MeasureConfig {
  /** Routes to measure, as they appear in a link's href (SPEC P1: the key screens). */
  routes: string[];
  /** The element whose links are clicked (soft navigations). */
  navSelector: string;
  shellSelector: string;
  skeletonSelector: string;
  /** Where Clerk's <SignIn /> lives, for the ticket hand-off. Absent ⇒ the app needs no sign-in. */
  signInPath?: string;
}

export interface MeasureOptions {
  base: string;
  runs: number;
  label: string;
  /** e-mail to sign in as (with signInPath) */
  user?: string;
  /** Clerk secret key, already read from the env file; never printed */
  secretKey?: string;
  /** Playwright browser channel; 'chrome' uses the installed Chrome (no browser download) */
  channel?: string;
  timeoutMs?: number;
}

export interface RouteResult {
  route: string;
  /** First visit to the route: cold (code split loaded, no prefetch yet). Kept apart (SPEC P1.3). */
  cold: { shellMs: number; contentMs: number } | null;
  shell: ReturnType<typeof summarize>;
  content: ReturnType<typeof summarize>;
  /** RSC requests per warm navigation (median), i.e. round trips the click cost. */
  roundTrips: number | null;
  /** Navigations that ended somewhere else (a 307): excluded from the timings, never timed (SPEC P1.2). */
  redirected: number;
  /** Navigations that loaded a whole new page instead of a soft (client) navigation: not instant by definition. */
  hardNavigations: number;
}

export interface MeasureReport {
  $schema: 'instant-nav-measure/v1';
  label: string;
  base: string;
  runs: number;
  at: string;
  completed: boolean;
  results: RouteResult[];
}

/** Reads and validates the measure config from standards.json. */
export function loadMeasureConfig(root: string): MeasureConfig {
  const p = join(root, 'standards.json');
  if (!existsSync(p)) throw new CannotMeasure(`no standards.json in ${root}`);
  const area = (
    JSON.parse(readFileSync(p, 'utf8')) as {
      areas?: Record<string, { measure?: Partial<MeasureConfig> }>;
    }
  ).areas?.[AREA];
  const m = area?.measure;
  if (!m || !Array.isArray(m.routes) || m.routes.length < 2) {
    throw new CannotMeasure(
      `areas["${AREA}"].measure.routes must list at least 2 routes (navigation needs somewhere to come from)`
    );
  }
  return {
    routes: m.routes,
    navSelector: m.navSelector ?? 'nav',
    shellSelector: m.shellSelector ?? '[data-shell]',
    skeletonSelector: m.skeletonSelector ?? '[data-skeleton]',
    ...(m.signInPath ? { signInPath: m.signInPath } : {}),
  };
}

/**
 * Drives a real browser through soft navigations and times shell vs content (SPEC P1).
 * 🔴 A PROBE NEVER WRITES (P1.4): every non-GET/HEAD request to the app's own origin is aborted and the run ends
 * with CANNOT MEASURE naming it. Clerk's hand-off goes to Clerk's own origin and is not affected.
 * @throws CannotMeasure when signed-in state, a selector or a link cannot be reached, or a write was attempted
 */
export async function measure(cfg: MeasureConfig, opts: MeasureOptions): Promise<MeasureReport> {
  let pw: typeof import('@playwright/test');
  try {
    pw = await import('@playwright/test');
  } catch {
    throw new CannotMeasure('@playwright/test is not installed — npm i -D @playwright/test');
  }
  const origin = new URL(opts.base).origin;
  const timeout = opts.timeoutMs ?? 20_000;
  const browser = await pw.chromium.launch({
    headless: true,
    ...(opts.channel ? { channel: opts.channel } : {}),
  });
  const writes: string[] = [];
  const report: MeasureReport = {
    $schema: 'instant-nav-measure/v1',
    label: opts.label,
    base: opts.base,
    runs: opts.runs,
    at: new Date().toISOString(),
    completed: false,
    results: [],
  };
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    let rsc = 0;
    await page.route('**/*', async (route) => {
      const req = route.request();
      const sameOrigin = new URL(req.url()).origin === origin;
      if (sameOrigin && !['GET', 'HEAD'].includes(req.method())) {
        writes.push(`${req.method()} ${new URL(req.url()).pathname}`);
        return route.abort('blockedbyclient');
      }
      if (
        sameOrigin &&
        (req.headers()['rsc'] === '1' || new URL(req.url()).searchParams.has('_rsc'))
      )
        rsc++;
      return route.continue();
    });
    const assertNoWrites = (): void => {
      if (writes.length) {
        throw new CannotMeasure(
          `the app tried to WRITE during a measurement (blocked): ${[...new Set(writes)].join(', ')} — a probe never writes (SPEC P1.4)`
        );
      }
    };

    if (cfg.signInPath) {
      if (!opts.secretKey || !opts.user)
        throw new CannotMeasure(
          'signInPath is set, so --user and a Clerk secret (--env) are needed'
        );
      const ticket = await clerkSignInTicket(opts.secretKey, opts.user);
      await page.goto(`${opts.base}${cfg.signInPath}?__clerk_ticket=${ticket}`, {
        waitUntil: 'domcontentloaded',
      });
      await page
        .waitForURL((u) => !u.pathname.startsWith(cfg.signInPath!), { timeout: 60_000 })
        .catch(() => {
          throw new CannotMeasure(
            `still on ${cfg.signInPath} after 60 s — the sign-in ticket was not accepted`
          );
        });
    } else {
      await page.goto(`${opts.base}${cfg.routes[0]}`, { waitUntil: 'domcontentloaded' });
    }
    await page.waitForSelector(cfg.navSelector, { timeout }).catch(() => {
      throw new CannotMeasure(
        `navSelector ${cfg.navSelector} never appeared on ${page.url()} — signed out, or the selector is wrong`
      );
    });
    assertNoWrites();

    const click = async (href: string): Promise<void> => {
      await page.click(`${cfg.navSelector} a[href="${href}"]`, { timeout }).catch(() => {
        throw new CannotMeasure(`no link a[href="${href}"] inside ${cfg.navSelector}`);
      });
    };
    for (const route of cfg.routes) {
      const from = route === cfg.routes[0] ? cfg.routes[1]! : cfg.routes[0]!;
      const shell: number[] = [];
      const content: number[] = [];
      const trips: number[] = [];
      let cold: RouteResult['cold'] = null;
      let redirected = 0;
      let hardNavigations = 0;
      for (let i = 0; i <= opts.runs; i++) {
        await click(from);
        await page.waitForURL((u) => u.pathname === from, { timeout }).catch(() => {});
        // Settle until the prefetch has landed (the WMS lesson: a 250 ms wait measured the cold path as steady state).
        await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
        await page.waitForTimeout(400);
        rsc = 0;
        // A marker on the current document: still there on arrival ⇒ a soft navigation; gone ⇒ the browser loaded
        // a whole new page (the link is not a Next <Link>, or the app forced it). Timed on Node's clock, because
        // the page's own performance.now() restarts on a full load (measured: a -835 ms "result").
        await page.evaluate(() => {
          (window as unknown as { __instantNav?: number }).__instantNav = 1;
        });
        const t0 = performance.now();
        // Any navigation of the main frame, soft (history) or full: a redirect may land back on `from`, so
        // "wait until the URL changes" could hang for the whole timeout (measured: 72 s for 4 runs).
        const navigated = page
          .waitForEvent('framenavigated', { predicate: (f) => f === page.mainFrame(), timeout })
          .catch(() => {});
        await click(route);
        await navigated;
        await page.waitForURL((u) => u.pathname === route, { timeout: 1_000 }).catch(() => {});
        if (new URL(page.url()).pathname !== route) {
          redirected++; // ended somewhere else (a 307): excluded, never timed
          continue;
        }
        await page.waitForSelector(`${cfg.shellSelector}, ${cfg.skeletonSelector}`, { timeout });
        const s = Math.round(performance.now() - t0);
        await page.waitForFunction(
          (sel) => document.querySelectorAll(sel).length === 0,
          cfg.skeletonSelector,
          { timeout }
        );
        const c = Math.round(performance.now() - t0);
        assertNoWrites();
        const soft = await page.evaluate(
          () => (window as unknown as { __instantNav?: number }).__instantNav === 1
        );
        if (!soft) hardNavigations++;
        if (i === 0) cold = { shellMs: s, contentMs: c };
        else {
          shell.push(s);
          content.push(c);
          trips.push(rsc);
        }
      }
      report.results.push({
        route,
        cold,
        shell: summarize(shell),
        content: summarize(content),
        roundTrips: summarize(trips)?.median ?? null,
        redirected,
        hardNavigations,
      });
    }
    report.completed = true;
    return report;
  } finally {
    await browser.close();
  }
}

/** One readable line per route: shell and content are always two numbers, never one. */
export function renderMeasure(r: MeasureReport): string {
  const ms = (x: { median: number; min: number; max: number } | null) =>
    x ? `${String(x.median).padStart(5)} ms (${x.min}–${x.max})` : '   n/a';
  const lines = r.results.map(
    (x) =>
      `  ${x.route.padEnd(28)} shell ${ms(x.shell)}   content ${ms(x.content)}   trips ${x.roundTrips ?? 'n/a'}` +
      `${x.cold ? `   cold ${x.cold.shellMs}/${x.cold.contentMs} ms` : ''}${x.redirected ? `   ${x.redirected} redirected (excluded)` : ''}` +
      (x.hardNavigations ? `   ${x.hardNavigations} FULL page loads (not soft navigations)` : '')
  );
  return [`measure "${r.label}" on ${r.base} — ${r.runs} warm runs per route`, ...lines].join('\n');
}

const value = (args: string[], name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

function envValue(file: string, key: string): string | undefined {
  if (!existsSync(file)) throw new CannotMeasure(`env file ${file} does not exist`);
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (line.startsWith(`${key}=`))
      return line
        .slice(key.length + 1)
        .replace(/^["']|["']$/g, '')
        .trim();
  }
  return undefined;
}

/**
 * `instant-nav measure --base <url> [--runs 5] [--label x] [--user <email>] [--env <file>] [--channel chrome]
 *  [--root <dir>] [--json]` — writes `standards/perf/measure-<label>.json`. Exit 0 measured · 3 cannot measure.
 */
export async function runMeasure(args: string[]): Promise<ExitCode> {
  const root = value(args, '--root') ?? process.cwd();
  const base = value(args, '--base');
  if (!base) {
    process.stderr.write('instant-nav measure: --base <url> is required\n');
    return EXIT.USAGE;
  }
  const runs = Number(value(args, '--runs') ?? 5);
  if (!Number.isInteger(runs) || runs < 3) {
    process.stderr.write(
      'instant-nav measure: --runs must be an integer >= 3 (one run is never a result)\n'
    );
    return EXIT.USAGE;
  }
  const label = value(args, '--label') ?? 'run';
  const envFile = value(args, '--env');
  const secretKey = envFile ? envValue(join(root, envFile), 'CLERK_SECRET_KEY') : undefined;
  const user = value(args, '--user');
  const channel = value(args, '--channel');
  const report = await measure(loadMeasureConfig(root), {
    base: base.replace(/\/$/, ''),
    runs,
    label,
    ...(user ? { user } : {}),
    ...(secretKey ? { secretKey } : {}),
    ...(channel ? { channel } : {}),
  });
  const dir = join(root, 'standards', 'perf');
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `measure-${label.replace(/[^\w.-]/g, '_')}.json`);
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(
    args.includes('--json')
      ? `${JSON.stringify(report, null, 2)}\n`
      : `${renderMeasure(report)}\nwrote ${out}\n`
  );
  return EXIT.PASS;
}
