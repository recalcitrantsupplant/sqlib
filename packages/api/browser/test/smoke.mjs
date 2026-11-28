// Starts the API Worker in headless Chromium and calls a few routes.
//   node smoke.mjs <dist-browser> [route ...]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('@playwright/test');
import { serve } from './serve.mjs';

const dir = process.argv[2];
const routes = process.argv.slice(3).length ? process.argv.slice(3) : ['/health', '/libraries', '/queries?limit=5'];
const server = await serve(dir);
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
const page = await browser.newPage();
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}]`, m.text().startsWith('│') ? m.text() : m.text().slice(0, 400)); });
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto(base + 'harness.html?persist=false&name=debug');
const ready = await page.evaluate(() => window.sqlibReady.then(r => r, e => ({ error: e.message })));
console.log('ready', JSON.stringify(ready).slice(0, 3000));
if (!ready.error) {
  for (const r of routes) {
    const parts = r.split(' ');
    const [method, url] = parts.length > 1 ? parts.slice(0, 2) : ['GET', r];
    const body = parts.length > 2 ? JSON.parse(parts.slice(2).join(' ')) : null;
    const res = await page.evaluate(([m, u, b]) => window.sqlibCall(m, u, b), [method, url, body]);
    console.log(method, url, res.status, `${res.ms.toFixed(1)}ms`, res.text.length, res.text.slice(0, 300));
  }
}
await browser.close();
server.close();
