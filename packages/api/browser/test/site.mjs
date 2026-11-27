// Loads the browser-only site in headless Chromium, records the network, and
// screenshots each route. It exits 1 when the page logs an error or loads
// anything from another origin.
//   node site.mjs <public dir> <out dir> [route ...]
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { serve } from './serve.mjs';
const { chromium } = createRequire(import.meta.url)('@playwright/test');

const [dir, out, ...routes] = process.argv.slice(2);
await mkdir(out, { recursive: true });
const server = await serve(dir, 0, { spaFallback: '200.html' });
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
page.on('pageerror', e => errors.push('pageerror ' + e.message.slice(0, 300)));
const outside = new Set();
page.on('request', r => { const u = new URL(r.url()); if (u.origin !== base) outside.add(u.origin); });
for (const route of routes.length ? routes : ['/']) {
  const t0 = Date.now();
  await page.goto(base + route, { waitUntil: 'load' });
  await page.waitForTimeout(6000);
  const name = route.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home';
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(route, `${Date.now() - t0} ms`);
}
console.log('outside origins', [...outside]);
console.log('errors', errors.length); for (const e of errors.slice(0, 20)) console.log('  ', e);
await browser.close(); server.close();
if (errors.length || outside.size) process.exit(1);
