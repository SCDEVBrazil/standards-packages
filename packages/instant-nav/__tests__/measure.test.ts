import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CannotMeasure, measure, type MeasureConfig } from '../src/index';
import { median, summarize } from '../src/measure/stats';

/**
 * A tiny app: every page has a nav, a data-shell title and a data-skeleton that a script removes after 80 ms.
 * /write POSTs on load (the "mark as seen" defect the write-block exists for); /moved answers 307.
 */
const page = (title: string, extra = '') => `<!doctype html><html><body>
<nav><a href="/a">A</a><a href="/b">B</a><a href="/write">W</a><a href="/moved">M</a></nav>
<h1 data-shell>${title}</h1><div data-skeleton>loading</div>
<script>setTimeout(() => document.querySelector('[data-skeleton]').remove(), 80);${extra}</script>
</body></html>`;

let server: Server;
let base = '';
const posts: string[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      posts.push(`${req.method} ${req.url}`);
      res.writeHead(204).end();
      return;
    }
    if (req.url === '/moved') {
      res.writeHead(307, { Location: '/a' }).end();
      return;
    }
    const body =
      req.url === '/write'
        ? page('Write', "fetch('/api/mark-seen', { method: 'POST' });")
        : page(req.url === '/b' ? 'B' : 'A');
    res.writeHead(200, { 'Content-Type': 'text/html' }).end(body);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const cfg = (routes: string[]): MeasureConfig => ({
  routes,
  navSelector: 'nav',
  shellSelector: '[data-shell]',
  skeletonSelector: '[data-skeleton]',
});
const opts = { runs: 3, label: 't', channel: 'chrome', timeoutMs: 8_000 };

describe('stats', () => {
  it('median of odd and even samples; no sample is null, never 0', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(3);
    expect(summarize([])).toBeNull();
  });
});

describe('measure (real Chrome, local server)', () => {
  it('times shell and content separately, cold kept apart, for every route', async () => {
    const r = await measure(cfg(['/a', '/b']), { base, ...opts });
    expect(r.completed).toBe(true);
    expect(r.results.map((x) => x.route)).toEqual(['/a', '/b']);
    for (const x of r.results) {
      expect(x.shell!.n).toBe(3);
      expect(x.cold).not.toBeNull();
      expect(x.content!.median).toBeGreaterThanOrEqual(x.shell!.median);
      expect(x.content!.median).toBeGreaterThanOrEqual(70); // the skeleton lives 80 ms
      expect(x.shell!.min).toBeGreaterThanOrEqual(0);
      // The fixture uses plain links, so every navigation is a full page load, and must be reported as one.
      expect(x.hardNavigations).toBe(4);
    }
  }, 120_000);

  it('🔴 a page that POSTs on load ⇒ CANNOT MEASURE naming the request, and the write never reaches the server', async () => {
    posts.length = 0;
    const run = measure(cfg(['/a', '/write']), { base, ...opts });
    await expect(run).rejects.toThrow(CannotMeasure);
    await expect(measure(cfg(['/a', '/write']), { base, ...opts })).rejects.toThrow(
      /POST \/api\/mark-seen/
    );
    expect(posts).toEqual([]);
  }, 120_000);

  it('a route that redirects (307) is counted as redirected and never timed', async () => {
    const r = await measure(cfg(['/a', '/b', '/moved']), { base, ...opts });
    const moved = r.results.find((x) => x.route === '/moved')!;
    expect(moved.redirected).toBe(4); // the cold run + 3 warm runs
    expect(moved.shell).toBeNull();
  }, 120_000);

  it('a missing nav selector is CANNOT MEASURE, not a fast result', async () => {
    await expect(
      measure({ ...cfg(['/a', '/b']), navSelector: '#nope' }, { base, ...opts })
    ).rejects.toThrow(/navSelector #nope never appeared/);
  }, 120_000);
});
