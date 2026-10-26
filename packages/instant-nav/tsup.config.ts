import { defineConfig } from 'tsup';

// ESM only: a dev tool run on Node >= 24 (the standard's runtime). No CJS build to keep in sync.
export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts', 'src/playwright.ts'],
  format: ['esm'],
  dts: { entry: ['src/index.ts', 'src/playwright.ts'] },
  clean: true,
  sourcemap: true,
  target: 'node24',
});
