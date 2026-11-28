// Opens each screen, presses its Run button, and screenshots the result.
// It exits 1 when the page logs an error.
//   node runs.mjs <public dir> <out dir> <route> ...
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { serve } from './serve.mjs';
const { chromium } = createRequire(import.meta.url)('@playwright/test');

const [dir, out, ...routes] = process.argv.slice(2);
await mkdir(out, { recursive: true });
const server = await serve(dir, 0, { spaFallback: '200.html' });
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 250)); });
for (const route of routes) {
  await page.goto(base + route, { waitUntil: 'load' });
  const run = page.getByRole('button', { name: /^Run( all)?$/ }).first();
  await run.waitFor({ timeout: 20000 });
  await page.waitForTimeout(800);
  const t0 = Date.now();
  await run.click();
  await page.waitForTimeout(route.startsWith('/etl') ? 8000 : 2500);
  const name = 'run-' + route.split('/')[1];
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(route.split('/')[1], 'clicked', Date.now() - t0, 'ms');
}
console.log('errors', errors.length); for (const e of errors) console.log('  ', e);
await browser.close(); server.close();
if (errors.length) process.exit(1);
