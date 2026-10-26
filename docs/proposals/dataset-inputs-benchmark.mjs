// Benchmark for docs/proposals/dataset-inputs.md: restricting a query to K of N
// named graphs, Oxigraph JS vs Fuseki. Needs a Fuseki with an in-memory, updatable
// dataset at FUSEKI, e.g. `java -jar jena-fuseki-server.jar --mem --update /ds`
// on port 3399. Run from the repository root: `node docs/proposals/dataset-inputs-benchmark.mjs`.
import { createRequire } from "node:module";
const require = createRequire(new URL("../../packages/api/package.json", import.meta.url));
const ox = require("oxigraph");

const N_GRAPHS = 20000;
const TRIPLES_PER_GRAPH = 10;
const SIZES = [10, 100, 1000, 10000];
const REPS = 5;
const FUSEKI = "http://127.0.0.1:3399/ds";

const g = (i) => `http://example.org/g/${i}`;
let nq = "";
for (let i = 0; i < N_GRAPHS; i++)
  for (let j = 0; j < TRIPLES_PER_GRAPH; j++)
    nq += `<http://example.org/s/${i}> <http://example.org/p/${j}> "${i}-${j}" <${g(i)}> .\n`;

// Every 2nd graph is allowed, so the selection is spread across the store.
const allowed = (k) => Array.from({ length: k }, (_, i) => g(i * 2));

const Q_NAMED = "SELECT (COUNT(*) AS ?c) WHERE { GRAPH ?g { ?s ?p ?o } }";
const Q_DEFAULT = "SELECT (COUNT(*) AS ?c) WHERE { ?s ?p ?o }";
const valuesQuery = (gs) =>
  `SELECT (COUNT(*) AS ?c) WHERE { VALUES ?g { ${gs.map((x) => `<${x}>`).join(" ")} } GRAPH ?g { ?s ?p ?o } }`;
const fromNamedQuery = (gs) =>
  `SELECT (COUNT(*) AS ?c) ${gs.map((x) => `FROM NAMED <${x}>`).join(" ")} WHERE { GRAPH ?g { ?s ?p ?o } }`;
const fromQuery = (gs) =>
  `SELECT (COUNT(*) AS ?c) ${gs.map((x) => `FROM <${x}>`).join(" ")} WHERE { ?s ?p ?o }`;

async function time(fn) {
  const ms = [];
  let out;
  for (let r = 0; r < REPS; r++) {
    const t = performance.now();
    out = await fn();
    ms.push(performance.now() - t);
  }
  ms.sort((a, b) => a - b);
  return { median: ms[Math.floor(REPS / 2)].toFixed(1), count: out };
}

// ---- Oxigraph JS (in-process) ----
const store = new ox.Store();
store.load(nq, { format: "application/n-quads" });
const oxCount = (q, opts = {}) => {
  const [row] = store.query(q, opts);
  return row.get("c").value;
};

// ---- Fuseki (HTTP) ----
await fetch(`${FUSEKI}/data`, { method: "POST", headers: { "content-type": "application/n-quads" }, body: nq });
const countOf = async (res) => {
  if (!res.ok) return `HTTP ${res.status}`;
  const j = await res.json();
  return j.results.bindings[0].c.value;
};
const accept = { accept: "application/sparql-results+json" };
const fusekiGet = (q, params = []) => {
  const qs = new URLSearchParams([["query", q], ...params]);
  return fetch(`${FUSEKI}/query?${qs}`, { headers: accept }).then(countOf, (e) => `ERR ${e.cause?.code ?? e.message}`);
};
const fusekiForm = (q, params = []) =>
  fetch(`${FUSEKI}/query`, {
    method: "POST",
    headers: { ...accept, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams([["query", q], ...params]),
  }).then(countOf, (e) => `ERR ${e.cause?.code ?? e.message}`);

const named = (gs) => gs.map((x) => ["named-graph-uri", x]);
const deflt = (gs) => gs.map((x) => ["default-graph-uri", x]);

const rows = [];
const add = (engine, method, k, r) => rows.push({ engine, method, k, ms: r.median, count: r.count });

for (const k of SIZES) {
  const gs = allowed(k);
  const nodes = gs.map((x) => ox.namedNode(x));
  add("oxigraph", "named_graphs option", k, await time(() => oxCount(Q_NAMED, { named_graphs: nodes })));
  add("oxigraph", "default_graph option", k, await time(() => oxCount(Q_DEFAULT, { default_graph: nodes })));
  add("oxigraph", "VALUES ?g in text", k, await time(() => oxCount(valuesQuery(gs))));
  add("oxigraph", "FROM NAMED in text", k, await time(() => oxCount(fromNamedQuery(gs))));
  add("oxigraph", "FROM in text", k, await time(() => oxCount(fromQuery(gs))));

  add("fuseki", "GET named-graph-uri", k, await time(() => fusekiGet(Q_NAMED, named(gs))));
  add("fuseki", "POST form named-graph-uri", k, await time(() => fusekiForm(Q_NAMED, named(gs))));
  add("fuseki", "POST form default-graph-uri", k, await time(() => fusekiForm(Q_DEFAULT, deflt(gs))));
  add("fuseki", "POST form VALUES ?g", k, await time(() => fusekiForm(valuesQuery(gs))));
  add("fuseki", "POST form FROM NAMED", k, await time(() => fusekiForm(fromNamedQuery(gs))));
  add("fuseki", "POST form FROM", k, await time(() => fusekiForm(fromQuery(gs))));
}
add("oxigraph", "unrestricted GRAPH ?g", N_GRAPHS, await time(() => oxCount(Q_NAMED)));
add("fuseki", "unrestricted GRAPH ?g", N_GRAPHS, await time(() => fusekiForm(Q_NAMED)));

// Override check: protocol dataset vs FROM NAMED in the text.
const overrideOx = oxCount(fromNamedQuery(allowed(100)), { named_graphs: allowed(10).map((x) => ox.namedNode(x)) });
const overrideFu = await fusekiForm(fromNamedQuery(allowed(100)), named(allowed(10)));
// Empty set: what happens when zero graphs are sent?
const emptyOx = oxCount(Q_NAMED, { named_graphs: [] });

console.table(rows);
console.log({ overrideOx, overrideFu, emptyOx, note: "override: 100 = protocol dataset (10 graphs) wins, 1000 = query text (100 graphs) wins" });
