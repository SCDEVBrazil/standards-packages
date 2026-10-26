import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser, type Page } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compareGeometry, defineInstantConfig, expectShellGeometryStable } from '../src/playwright';

/**
 * /stable: the skeleton title has the size of the real title. /jump reproduces the WMS defect: the skeleton row
 * above the title is 40 px shorter than the real header, so the title drops when the content arrives.
 */
const doc = (
  headerSkeleton: number,
  headerReal: number
) => `<!doctype html><html><body style="margin:0">
<nav><a href="/stable">S</a><a href="/jump">J</a></nav>
<div id="hdr" data-skeleton style="height:${headerSkeleton}px;background:#eee"></div>
<h1 data-shell style="margin:0;height:40px">Orders</h1>
<script>setTimeout(() => { const h = document.getElementById('hdr'); h.removeAttribute('data-skeleton');
  h.style.height='${headerReal}px'; }, 300);</script></body></html>`;

let server: Server;
let base = '';
let browser: Browser;
let page: Page;
beforeAll(async () => {
  server = createServer((req, res) => {
    res
      .writeHead(200, { 'Content-Type': 'text/html' })
      .end(req.url === '/jump' ? doc(20, 60) : doc(60, 60));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch({ channel: 'chrome' });
  page = await browser.newPage();
}, 60_000);
afterAll(async () => {
  await browser?.close();
  await new Promise<void>((r) => server.close(() => r()));
});

// A static page has no Next router to pause, so the instant() scope is a plain runner here.
const plain = <T>(_p: Page, fn: () => Promise<T>) => fn();

describe('compareGeometry', () => {
  it('is stable within the tolerance and unstable above it', () => {
    const a = { x: 0, y: 100, width: 300, height: 40 };
    expect(compareGeometry(a, { ...a, y: 101.5 }).stable).toBe(true);
    expect(compareGeometry(a, { ...a, y: 103 })).toMatchObject({ stable: false, dy: 3 });
    expect(compareGeometry(a, { ...a, height: 44 }).stable).toBe(false);
  });
});

describe('expectShellGeometryStable (real Chrome)', () => {
  it('passes when the skeleton has the size of the content', async () => {
    const d = await expectShellGeometryStable(page, {
      navigate: () => page.goto(`${base}/stable`).then(() => {}),
      scope: plain,
    });
    expect(d.stable).toBe(true);
  }, 60_000);

  it('🔴 FAILS on the WMS title jump (the fixture drops the title by 40 px)', async () => {
    await expect(
      expectShellGeometryStable(page, {
        navigate: () => page.goto(`${base}/jump`).then(() => {}),
        scope: plain,
      })
    ).rejects.toThrow(/the shell moved when the content loaded: dx 0px, dy 40px/);
  }, 60_000);
});

describe('defineInstantConfig', () => {
  it('one worker, no retries locally, and no web server unless CI', () => {
    const c = defineInstantConfig({ port: 3999 });
    expect(c.workers).toBe(1);
    expect(c.use?.baseURL).toBe(process.env['E2E_BASE_URL'] ?? 'http://localhost:3999');
    if (!process.env['CI']) {
      expect(c.retries).toBe(0);
      expect(c.webServer).toBeUndefined();
    }
  });
});
