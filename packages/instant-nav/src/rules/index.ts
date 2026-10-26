import { cachedLayout, privateCacheAsShell } from './cache-directives';
import type { Rule } from './context';
import { instantFalse } from './instant-false';
import { layoutAwaitsData } from './layout-awaits-data';
import { loadingMissing } from './loading-missing';
import { segmentConfig } from './segment-config';
import { shell } from './shell';
import { testingApi } from './testing-api';

export type { RuleContext } from './context';

/** Every blocking rule built so far (chunk 3). Chunk 4 adds FRESHNESS_TTL and the WATERFALL? advisory. */
export const RULES: readonly Rule[] = [
  loadingMissing,
  layoutAwaitsData,
  shell,
  instantFalse,
  cachedLayout,
  privateCacheAsShell,
  segmentConfig,
  testingApi,
];
