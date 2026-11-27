// Runs the same API calls on a sqlib server and on the browser Worker, and
// compares status codes and response bodies.
//   node parity.mjs <dist-browser> <server base URL>
import { createRequire } from 'node:module';
import { serve } from './serve.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const oxigraph = createRequire(import.meta.url)('oxigraph');

const [dir, serverBase] = process.argv.slice(2);
const server = await serve(dir);
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${server.address().port}/harness.html?persist=false`);
const ready = await page.evaluate(() => window.sqlibReady.then(r => r, e => ({ error: e.message })));
if (ready.error) { console.log('worker failed', ready.error); process.exit(1); }

async function onServer(method, url, body) {
  const t0 = performance.now();
  const r = await fetch(serverBase + url, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, text: await r.text(), ms: performance.now() - t0 };
}
const inBrowser = (method, url, body) => page.evaluate(([m, u, b]) => window.sqlibCall(m, u, b), [method, url, body]);

/** Drop what differs between two runs of the same call: times, durations and minted ids. */
function normalise(text) {
  let value;
  try { value = JSON.parse(text); } catch {
    // RDF text: the order of statements and the blank node labels may differ.
    try {
      const store = new oxigraph.Store();
      store.load(text, { format: 'text/turtle' });
      return store.dump({ format: 'application/n-quads' }).replace(/_:[\w-]+/g, '_:b').split('\n').filter(Boolean).sort().join('\n');
    } catch { /* not Turtle */ }
    return text.replace(/_:[\w-]+/g, '_:b').split('\n').map(l => l.trim()).filter(Boolean).sort().join('\n');
  }
  const walk = v => {
    if (Array.isArray(v)) {
      const items = v.map(walk);
      // Rows of a query with no ORDER BY come in store order. Compare them as a multiset.
      return items.map(i => JSON.stringify(i)).sort().map(i => JSON.parse(i));
    }
    if (typeof v === 'string' && /^\s*[[{]/.test(v)) { try { return walk(JSON.parse(v)); } catch { /* text */ } }
    if (typeof v === 'string' && /> \.\s*$/.test(v)) return normalise(v);
    if (v && typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v).sort()) {
        if (/(^|[a-z])(At|Ms|ms|Time|time|Date|date|duration|Duration|timestamp|Timestamp|uptime|Uptime|elapsed|Elapsed|memory|Memory|Nanos|nanos)$|^(id|run|runId|requestId|traceId|executionId|startedAt|endedAt|ranAt)$/.test(k)) continue;
        out[k] = walk(v[k]);
      }
      return out;
    }
    if (typeof v === 'string') return v.replace(/urn:sqlib:(test-run|run|execution|benchmark-run|etl-run|observation)[:\w-]*/g, 'urn:run').replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, 'T');
    return v;
  };
  return JSON.stringify(walk(value));
}

const results = [];
async function compare(label, method, url, body) {
  const [a, b] = [await onServer(method, url, body), await inBrowser(method, url, body)];
  const same = a.status === b.status && normalise(a.text) === normalise(b.text);
  results.push({ label, same, server: a.status, browser: b.status, serverMs: a.ms, browserMs: b.ms });
  const tag = same ? 'same' : 'DIFF';
  console.log(`${tag} ${label}  server ${a.status} ${a.ms.toFixed(0)}ms  browser ${b.status} ${b.ms.toFixed(0)}ms`);
  if (!same) {
    const na = normalise(a.text), nb = normalise(b.text);
    let i = 0; while (i < na.length && na[i] === nb[i]) i++;
    console.log(`    server : ${na.slice(Math.max(0, i - 80), i + 200)}`);
    console.log(`    browser: ${nb.slice(Math.max(0, i - 80), i + 200)}`);
  }
  try { return JSON.parse(a.text || 'null'); } catch { return a.text; }
}
const list = async path => JSON.parse((await onServer('GET', path)).text);

for (const path of ['/libraries', '/queries', '/query-groups', '/rule-sets', '/tests', '/benchmark-experiments', '/etl-jobs', '/notebooks', '/backends', '/data-graphs', '/argument-sets', '/tags', '/environments']) {
  await compare(`GET ${path}`, 'GET', path);
}

for (const q of await list('/queries?limit=200')) {
  const sets = await list(`/queries/${encodeURIComponent(q.id)}/argument-sets`).catch(() => []);
  const backend = q.defaultBackend ?? 'urn:sqlib:backend:rail-store';
  const body = { targetId: q.id, backendId: backend, ...(Array.isArray(sets) && sets[0] ? { argumentSetIds: [sets[0].id] } : {}) };
  await compare(`run query ${q.name}`, 'POST', '/execute', body);
}
for (const g of await list('/query-groups')) await compare(`run group ${g.name}`, 'POST', '/execute', { targetId: g.id });
for (const r of await list('/rule-sets')) await compare(`run rule set ${r.name}`, 'POST', `/rule-sets/${encodeURIComponent(r.id)}/execute`, {});
const tests = await list('/tests');
await compare(`run ${tests.length} tests`, 'POST', '/tests/run', { tests: tests.map(t => t.id) });
for (const n of await list('/notebooks')) await compare(`notebook ${n.name}`, 'GET', `/notebooks/${encodeURIComponent(n.id)}`);
for (const e of await list('/etl-jobs')) await compare(`run ETL ${e.name}`, 'POST', `/etl-jobs/${encodeURIComponent(e.id)}/execute`, {});

const same = results.filter(r => r.same).length;
console.log(`\n${same}/${results.length} calls gave the same status and body`);
await browser.close();
server.close();
