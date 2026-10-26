/**
 * `@scdevbrazil/instant-nav/playwright`: the e2e helpers of the perf-instant-nav standard (SPEC Tests, P7.1).
 * A separate entry point so apps without Playwright never load it.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { instant } from '@next/playwright';
import {
  defineConfig,
  devices,
  expect,
  type Page,
  type PlaywrightTestConfig,
} from '@playwright/test';
import { clerkSignInTicket } from './measure/clerk';
import { compareGeometry, type Box, type GeometryDiff } from './playwright/geometry';

export { instant };
export { compareGeometry };
export type { Box, GeometryDiff };

export interface ClerkAuthOptions {
  /** Clerk's <SignIn /> page; the ticket only works there (WMS: handing it to /admin silently did nothing). */
  signInPath: string;
  /** The user to sign in as. */
  email: string;
  /** The Clerk secret key of the instance under test (a TEST instance in CI). Never printed. */
  secretKey: string;
  /** Visible once signed in; proves the session is real before the state is saved. */
  readySelector: string;
  /** Where the storage state goes, e.g. `e2e/.auth/user.json`. */
  storageState: string;
  baseURL?: string;
}

/**
 * Signs in once with a Clerk sign-in ticket and saves the storage state for every other spec (the WMS
 * `auth.setup.ts` flow, generalised). Call it from a `setup` project.
 */
export async function clerkAuthSetup(page: Page, o: ClerkAuthOptions): Promise<void> {
  const ticket = await clerkSignInTicket(o.secretKey, o.email);
  await page.goto(`${o.baseURL ?? ''}${o.signInPath}?__clerk_ticket=${ticket}`);
  await page.waitForURL((u) => !u.pathname.startsWith(o.signInPath), { timeout: 60_000 });
  await expect(page.locator(o.readySelector).first()).toBeVisible({ timeout: 30_000 });
  mkdirSync(dirname(o.storageState), { recursive: true });
  await page.context().storageState({ path: o.storageState });
}

export interface GeometryOptions {
  /** Starts the navigation (e.g. clicks the link). Runs inside `instant()`, so only prefetched UI renders. */
  navigate: () => Promise<void>;
  shellSelector?: string;
  skeletonSelector?: string;
  tolerancePx?: number;
  /**
   * The instant() scope. Defaults to @next/playwright's; tests of this helper inject a plain runner because a
   * static fixture page has no Next router to pause.
   */
  scope?: <T>(page: Page, fn: () => Promise<T>) => Promise<T>;
}

/**
 * SPEC P7.1: the `[data-shell]` box while only the prefetched shell shows must equal its box once the data has
 * streamed in (within 2 px). Fails with the measured shift, e.g. the WMS title that dropped when the real header
 * replaced the skeleton.
 * @returns the measured difference (also when it passes, for the report)
 */
export async function expectShellGeometryStable(
  page: Page,
  o: GeometryOptions
): Promise<GeometryDiff> {
  const shellSel = o.shellSelector ?? '[data-shell]';
  const skelSel = o.skeletonSelector ?? '[data-skeleton]';
  const scope = o.scope ?? ((p, fn) => instant(p, fn));
  const during = await scope(page, async () => {
    await o.navigate();
    const shell = page.locator(shellSel).first();
    await expect(shell).toBeVisible();
    await expect(page.locator(skelSel).first()).toBeVisible();
    return shell.boundingBox();
  });
  await expect(page.locator(skelSel)).toHaveCount(0, { timeout: 20_000 });
  const after = await page.locator(shellSel).first().boundingBox();
  if (!during || !after)
    throw new Error(`${shellSel} has no box (not rendered) — cannot compare geometry`);
  const diff = compareGeometry(during, after, o.tolerancePx ?? 2);
  expect(
    diff.stable,
    `the shell moved when the content loaded: dx ${diff.dx}px, dy ${diff.dy}px, height ${diff.dHeight}px ` +
      `(tolerance ${o.tolerancePx ?? 2}px) — the skeleton must have the size and place of the content (SPEC P2.6)`
  ).toBe(true);
  return diff;
}

export interface InstantConfigOptions {
  /** Port for `next start` (default 3850, as in the WMS). */
  port?: number;
  /** Extra Playwright config, merged over the preset. */
  overrides?: PlaywrightTestConfig;
}

/**
 * Playwright preset for `instant()` tests (SPEC Tests): a PRODUCTION build (`next start`, prefetching is off in
 * dev) with `INSTANT_NAV_E2E=1`, so `withInstantNav()` exposes the testing API in that server only. One worker
 * (one signed-in user), one retry in CI only, and a retry-pass is reported as flaky, never as passed.
 * Locally, point E2E_BASE_URL at a server you started; in CI the preset starts one.
 * ⚠️ The testing API is compiled in at BUILD time: the CI job runs `INSTANT_NAV_E2E=1 next build` before this
 * preset's `next start` (reference/ci/instant-e2e.yml). Never on Vercel — withInstantNav() throws there.
 */
export function defineInstantConfig(o: InstantConfigOptions = {}): PlaywrightTestConfig {
  const port = o.port ?? 3850;
  const base = process.env['E2E_BASE_URL'] ?? `http://localhost:${port}`;
  const ci = !!process.env['CI'];
  return defineConfig({
    testDir: './e2e',
    workers: 1,
    fullyParallel: false,
    forbidOnly: ci,
    retries: ci ? 1 : 0,
    timeout: 60_000,
    reporter: ci ? [['github'], ['list']] : [['list']],
    use: { baseURL: base, trace: 'retain-on-failure', ...devices['Desktop Chrome'] },
    ...(ci && !process.env['E2E_BASE_URL']
      ? {
          webServer: {
            command: `npx next start -p ${port}`,
            url: base,
            timeout: 120_000,
            reuseExistingServer: false,
            env: { INSTANT_NAV_E2E: '1' },
          },
        }
      : {}),
    ...o.overrides,
  });
}
