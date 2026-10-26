/**
 * The subset of a Next.js config this wrapper reads and writes. Typed locally so the package does not need `next`
 * at runtime (it is an optional peer); the caller's own config type passes through unchanged.
 */
interface NextConfigLike {
  cacheComponents?: boolean;
  partialPrefetching?: boolean;
  experimental?: Record<string, unknown>;
  [key: string]: unknown;
}

type ConfigFn<T> = (phase: string, ctx: { defaultConfig: T }) => T | Promise<T>;

export interface InstantNavOptions {
  /** The SWITCH (SPEC P4): Cache Components + Partial Prefetching. Only on Renan's date for an existing app. */
  switch: boolean;
}

const KEY = 'exposeTestingApiInProductionBuild';

/** Thrown at config load, so `next build` / `next dev` stop before anything is built. */
export class InstantNavConfigError extends Error {
  override readonly name = 'InstantNavConfigError';
}

function apply<T extends NextConfigLike>(
  config: T,
  opts: InstantNavOptions,
  env: NodeJS.ProcessEnv
): T {
  const e2e = env.INSTANT_NAV_E2E === '1';
  if (e2e && env.VERCEL === '1') {
    throw new InstantNavConfigError(
      'INSTANT_NAV_E2E=1 is set on a Vercel build: it would expose the instant() testing API in a deployed app ' +
        '(Next: "do not enable in user-facing production deployments"). Set it only in the CI e2e job (SPEC P6.5).'
    );
  }
  if (config.experimental && KEY in config.experimental) {
    throw new InstantNavConfigError(
      `experimental.${KEY} is set by hand in next.config — remove it; withInstantNav() turns it on only when ` +
        'INSTANT_NAV_E2E=1 (SPEC P6.5)'
    );
  }
  const out: NextConfigLike = { ...config };
  if (opts.switch) {
    for (const k of ['cacheComponents', 'partialPrefetching'] as const) {
      if (config[k] === false) {
        throw new InstantNavConfigError(
          `${k}: false contradicts withInstantNav({ switch: true }). Either the SWITCH is on (remove ${k}: false) ` +
            'or it is not (switch: false) — the wrapper never overrides an explicit setting silently.'
        );
      }
    }
    // Both explicitly: Next 16.4 warns when cacheComponents is on and partialPrefetching is left unset (SPEC §0).
    out.cacheComponents = true;
    out.partialPrefetching = true;
  }
  if (e2e) out.experimental = { ...config.experimental, [KEY]: true };
  return out as T;
}

/**
 * Wraps a Next.js config for the perf-instant-nav standard (SPEC P4.1, P6.5).
 * - `switch: true` sets `cacheComponents` and `partialPrefetching` to `true` (throws if the config says `false`).
 * - `switch: false` leaves both exactly as the config has them.
 * - `experimental.exposeTestingApiInProductionBuild` is set ONLY when `INSTANT_NAV_E2E=1`, and the wrapper throws
 *   when that is combined with `VERCEL=1` or when the config sets the flag itself.
 * Accepts an object or a `(phase, ctx) => config` function, like `next.config` itself.
 * @param config the app's Next.js config
 * @param opts `{ switch }` — the app's SWITCH state, matching `standards.json`
 * @param env environment to read (defaults to `process.env`; injectable for tests)
 * @returns the wrapped config, of the same shape as the input
 */
export function withInstantNav<T extends NextConfigLike>(
  config: T,
  opts: InstantNavOptions,
  env?: NodeJS.ProcessEnv
): T;
export function withInstantNav<T extends NextConfigLike>(
  config: ConfigFn<T>,
  opts: InstantNavOptions,
  env?: NodeJS.ProcessEnv
): ConfigFn<T>;
export function withInstantNav<T extends NextConfigLike>(
  config: T | ConfigFn<T>,
  opts: InstantNavOptions,
  env: NodeJS.ProcessEnv = process.env
): T | ConfigFn<T> {
  if (typeof opts?.switch !== 'boolean') {
    throw new InstantNavConfigError(
      'withInstantNav(config, { switch }) needs switch: true or false — no default'
    );
  }
  if (typeof config === 'function') {
    return async (phase, ctx) => apply(await config(phase, ctx), opts, env);
  }
  return apply(config, opts, env);
}
