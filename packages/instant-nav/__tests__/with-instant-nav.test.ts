import { describe, expect, it } from 'vitest';
import { InstantNavConfigError, withInstantNav } from '../src/index';

const E2E = { INSTANT_NAV_E2E: '1' };

describe('withInstantNav', () => {
  it('throws with INSTANT_NAV_E2E=1 + VERCEL=1', () => {
    expect(() => withInstantNav({}, { switch: false }, { ...E2E, VERCEL: '1' })).toThrow(
      InstantNavConfigError
    );
    expect(() => withInstantNav({}, { switch: true }, { ...E2E, VERCEL: '1' })).toThrow(
      /Vercel build/
    );
  });

  it('sets the testing flag only with INSTANT_NAV_E2E=1, keeping other experimental keys', () => {
    const cfg = { experimental: { typedEnv: true } };
    expect(withInstantNav(cfg, { switch: false }, {})).toEqual(cfg);
    expect(withInstantNav(cfg, { switch: false }, E2E).experimental).toEqual({
      typedEnv: true,
      exposeTestingApiInProductionBuild: true,
    });
    expect(
      withInstantNav(cfg, { switch: false }, { INSTANT_NAV_E2E: 'true' }).experimental
    ).toEqual({ typedEnv: true });
  });

  it('throws when next.config sets the testing flag itself', () => {
    expect(() =>
      withInstantNav(
        { experimental: { exposeTestingApiInProductionBuild: false } },
        { switch: false },
        {}
      )
    ).toThrow(/set by hand/);
  });

  it('switch: true sets both keys explicitly', () => {
    expect(withInstantNav({ reactStrictMode: true }, { switch: true }, {})).toEqual({
      reactStrictMode: true,
      cacheComponents: true,
      partialPrefetching: true,
    });
  });

  it('switch: false leaves the user config untouched (including a cacheComponents the app already has)', () => {
    const cfg = { cacheComponents: true, partialPrefetching: true, images: { remotePatterns: [] } };
    expect(withInstantNav(cfg, { switch: false }, {})).toEqual(cfg);
    expect(withInstantNav({}, { switch: false }, {})).toEqual({});
  });

  it('never overrides an explicit cacheComponents: false / partialPrefetching: false silently', () => {
    expect(() => withInstantNav({ cacheComponents: false }, { switch: true }, {})).toThrow(
      /contradicts/
    );
    expect(() => withInstantNav({ partialPrefetching: false }, { switch: true }, {})).toThrow(
      /contradicts/
    );
  });

  it('does not mutate the input', () => {
    const cfg = { experimental: {} as Record<string, unknown> };
    withInstantNav(cfg, { switch: true }, E2E);
    expect(cfg).toEqual({ experimental: {} });
  });

  it('wraps a (phase, ctx) => config function too', async () => {
    const fn = withInstantNav(async () => ({ output: 'standalone' }), { switch: true }, {});
    expect(await fn('phase-production-build', { defaultConfig: {} })).toEqual({
      output: 'standalone',
      cacheComponents: true,
      partialPrefetching: true,
    });
  });

  it('requires switch to be stated', () => {
    expect(() => withInstantNav({}, {} as { switch: boolean }, {})).toThrow(/needs switch/);
  });
});
