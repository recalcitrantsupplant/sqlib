// Times screens on two deployments of the demo: from navigation until a
// known text is on the screen. The first visit to each site is not timed, so
// both are compared with their files in the browser cache.
//   node compare.mjs <site A> <site B>
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('@playwright/test');

const screens = [
  ['/queries/urn%3Asqlib%3Aquery%3Arail-departures-from-station', 'valid SELECT'],
  ['/queryGroups/urn%3Asqlib%3Agroup%3Arail-one-change-away', 'LINES THROUGH A STATION'],
  ['/benchmarks/urn%3Asqlib%3Abenchmark-experiment%3Arail-values-vs-filter', 'REQUESTS'],
  ['/tupleSets/urn%3Asqlib%3Atuple-set%3Arail-closed-this-week', 'Rail'],
  ['/tests', 'TESTS'],
  ['/backends', 'Rail store'],
];

async function time(base) {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(base + '/', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => document.body.innerText.includes('ACTIVITY'), null, { timeout: 60000 });
  const out = [];
  // A cold start of the app, with its files cached: reload, until the home screen shows its activity.
  const starts = [];
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    await page.goto(base + '/', { waitUntil: 'commit', timeout: 60000 });
    await page.waitForFunction(() => document.body.innerText.includes('ACTIVITY'), null, { timeout: 60000, polling: 50 });
    starts.push(Date.now() - t0);
  }
  out.push(['app start (reload)', Math.min(...starts), starts.sort((x, y) => x - y)[1]]);
  // Moving between screens inside the app, as a visitor does.
  for (const [route, text] of screens) {
    const runs = [];
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => { history.pushState({}, '', '/'); dispatchEvent(new PopStateEvent('popstate')); });
      await page.waitForFunction(() => document.body.innerText.includes('ACTIVITY'), null, { timeout: 60000, polling: 50 });
      const t0 = Date.now();
      await page.evaluate(r => { history.pushState({}, '', r); dispatchEvent(new PopStateEvent('popstate')); }, route);
      await page.waitForFunction(t => document.body.innerText.toUpperCase().includes(t.toUpperCase()), text, { timeout: 60000, polling: 20 });
      runs.push(Date.now() - t0);
    }
    out.push([route.split('/')[1] || 'home', Math.min(...runs), runs.sort((x, y) => x - y)[1]]);
  }
  await browser.close();
  return out;
}

const [a, b] = process.argv.slice(2);
const [ra, rb] = [await time(a), await time(b)];
console.log(`screen | ${a} best / median ms | ${b} best / median ms`);
for (let i = 0; i < ra.length; i++) console.log(`${ra[i][0]} | ${ra[i][1]} / ${ra[i][2]} | ${rb[i][1]} / ${rb[i][2]}`);
