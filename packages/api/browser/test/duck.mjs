import { createRequire } from 'node:module';
import { serve } from './serve.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const server = await serve(process.argv[2]);
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', m => console.log('[c]', m.text().slice(0, 300)));
await page.goto(`http://127.0.0.1:${server.address().port}/harness.html?persist=false`);
const out = await page.evaluate(async sql => {
  const m = await import('./sqlib-duckdb.js');
  const c = await m.DuckDBConnection.create();
  const all = await c.runAndReadAll(sql);
  const s = await c.stream(sql);
  const chunk = await s.fetchChunk();
  return { all: all.getRowObjectsJson().slice(0, 2), names: s.deduplicatedColumnNames(), chunk: chunk.convertRows().slice(0, 2) };
}, process.argv[3]);
console.log(JSON.stringify(out, null, 1));
await browser.close(); server.close();
