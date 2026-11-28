// Opens the map page of the browser-only site with no basemap, so that every
// request stays on the site's origin. It checks that both Rail collections
// load, that the Stations pages follow the `next` link, that a name filter
// matches part of a name in any case, that the page shows the SPARQL it ran,
// and that Open with the service URL loads the service again. It exits 1 on a failed check, a logged error or a request
// to another origin.
//   node map.mjs <public dir> <out dir>
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { serve } from './serve.mjs';
const { chromium } = createRequire(import.meta.url)('@playwright/test');

const [dir, out] = process.argv.slice(2);
await mkdir(out, { recursive: true });
const server = await serve(dir, 0, { spaFallback: '200.html' });
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
page.on('pageerror', e => errors.push('pageerror ' + e.message.slice(0, 300)));
const outside = new Set();
page.on('request', r => { const u = new URL(r.url()); if (!['http:', 'https:'].includes(u.protocol)) return; if (u.origin !== base) outside.add(u.origin); });

const failures = [];
const expectText = async (selector, expected, label) => {
  const actual = (await page.locator(selector).allTextContents()).map(s => s.trim());
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? 'ok  ' : 'FAIL', label, ok ? '' : `got ${JSON.stringify(actual)}`);
  if (!ok) failures.push(label);
};

const t0 = Date.now();
await page.goto(`${base}/map/?basemap=none`, { waitUntil: 'load' });
await page.waitForSelector('.features li', { timeout: 60_000 });
console.log('first features', `${Date.now() - t0} ms`);
await expectText('.collection-title', ['Lines', 'Stations'], 'collections');
await expectText('.features button', ['Blue line', 'Green line', 'Red line', 'Yellow line'], 'lines');
await page.screenshot({ path: `${out}/map-lines.png` });

await page.click('.collection-title:text("Stations")');
await expectText('.pager span', ['1–10'], 'stations page 1');
await page.click('button[title="Next page"]');
await page.waitForFunction(() => document.querySelector('.pager span')?.textContent === '11–16');
await expectText('.features li', ['Parkside', 'Riverside', 'Southbank', 'Stadium', 'University', 'Westfield'], 'stations page 2');

await page.fill('input[name="name"]', 'cENTr');
await page.click('button:text("Search")');
await page.waitForFunction(() => document.querySelector('.pager span')?.textContent === '1–1');
await expectText('.features li', ['Central'], 'name filter, any case, part of the name');
await page.click('.sparql summary');
const sparql = await page.locator('.sparql pre').textContent();
const shown = /VALUES \?nameLike \{ "cENTr" \}/.test(sparql ?? '') && /REGEX/i.test(sparql ?? '') && !/LIMIT 0001/.test(sparql ?? '');
console.log(shown ? 'ok  ' : 'FAIL', 'SPARQL of the page', shown ? '' : JSON.stringify(sparql?.slice(0, 400)));
if (!shown) failures.push('SPARQL of the page');
await page.screenshot({ path: `${out}/map-filter.png` });

await page.click('#service-form button[type="submit"]');
await page.waitForURL(/[?&]url=/);
await page.waitForSelector('.features li', { timeout: 60_000 });
await expectText('.collection-title', ['Lines', 'Stations'], 'open the same service by URL');

console.log('outside origins', [...outside]);
console.log('errors', errors.length); for (const e of errors.slice(0, 20)) console.log('  ', e);
await browser.close(); server.close();
if (failures.length || errors.length || outside.size) process.exit(1);
