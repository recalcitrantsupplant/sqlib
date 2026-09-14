/**
 * Measures what crossing the Oxigraph wasm boundary costs, and what moving work
 * *into* wasm would save.
 *
 * Three questions, one per section:
 *
 *   1. Serialisation. `OxigraphSparqlExecutor` walks `Map<string, Term>` and
 *      `Quad[]` in JavaScript to build SPARQL-JSON and N-Triples. Oxigraph will
 *      do both itself when handed `results_format`. How much is the JS walk
 *      costing?
 *   2. VALUES injection. A downstream node's query carries the upstream rows as
 *      spliced VALUES text, so Oxigraph re-parses them on every hop. How much of
 *      "executing the downstream query" is really parsing our own text?
 *   3. Bulk I/O. `load` and `dump` are how a durable store reaches disk, and
 *      `dump` is synchronous. What throughput do they run at, and how does it
 *      scale?
 *
 * Run: node_modules/.bin/tsx scripts/bench-wasm-boundary.ts [select|construct|values|io]
 *
 * Each section runs in its own process, and with no argument this script spawns
 * itself once per section. That is not tidiness: a section that has just
 * materialised 50k result rows leaves the wasm heap grown and the JS heap under
 * collection pressure, and the next section measures that rather than itself.
 * Sharing one process inflated the 10k-row VALUES figures below by ~15×.
 *
 * Companion to scripts/bench-node-hop.ts, which sizes the whole hop.
 */
import { spawnSync } from 'node:child_process';
import * as oxigraph from 'oxigraph';

const SECTIONS = ['select', 'construct', 'values', 'io'] as const;
type Section = (typeof SECTIONS)[number];

const requested = process.argv[2] as Section | undefined;

if (!requested) {
  // Fan out: one child per section, so no section pays for the last one's heap.
  for (const section of SECTIONS) {
    const { status } = spawnSync(process.argv[0], [process.argv[1], section], { stdio: 'inherit' });
    if (status !== 0) process.exit(status ?? 1);
  }
  process.exit(0);
}

if (!SECTIONS.includes(requested)) {
  console.error(`Unknown section "${requested}". Expected one of: ${SECTIONS.join(', ')}`);
  process.exit(1);
}

const ITERATIONS = 20;
/** Discarded iterations, so the first row of a table is not measuring the JIT. */
const WARMUP = 3;
const RESULTS_JSON = 'application/sparql-results+json';
const NTRIPLES = 'application/n-triples';

function time(fn: () => void): number {
  const t = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - t) / 1e6; // ms
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function row(cells: Array<string | number>, width = 18): string {
  return cells
    .map((c) => (typeof c === 'number' ? (Number.isInteger(c) ? String(c) : c.toFixed(2)) : c).padStart(width))
    .join('');
}

/** Upstream store: N subjects, each with a label and a kind. */
function buildStore(rows: number): oxigraph.Store {
  const store = new oxigraph.Store();
  const lines: string[] = [];
  for (let i = 0; i < rows; i++) {
    lines.push(`<http://ex.org/s${i}> <http://ex.org/label> "label ${i}" .`);
    lines.push(`<http://ex.org/s${i}> <http://ex.org/kind> <http://ex.org/Kind${i % 7}> .`);
  }
  store.load(lines.join('\n'), { format: 'nt' });
  return store;
}

/** Mirrors OxigraphSparqlExecutor.convertOxigraphSelectToJson. */
function toSparqlJson(results: Array<Map<string, oxigraph.Term>>) {
  const vars = results.length > 0 ? [...results[0].keys()] : [];
  const bindings: Array<Record<string, { type: string; value: string }>> = [];
  for (const r of results) {
    const b: Record<string, { type: string; value: string }> = {};
    for (const [k, term] of r.entries()) {
      if (!term) continue;
      const t = term as { termType: string; value: string };
      if (t.termType === 'NamedNode') b[k] = { type: 'uri', value: t.value };
      else if (t.termType === 'BlankNode') b[k] = { type: 'bnode', value: t.value };
      else b[k] = { type: 'literal', value: t.value };
    }
    bindings.push(b);
  }
  return { head: { vars }, results: { bindings } };
}

/** Mirrors OxigraphSparqlExecutor.quadsToNQuadsString, for the shapes used here. */
function toNQuads(quads: Array<{ subject: { value: string }; predicate: { value: string }; object: { termType: string; value: string } }>): string {
  return quads
    .map((q) => {
      const obj = q.object.termType === 'NamedNode' ? `<${q.object.value}>` : JSON.stringify(q.object.value);
      return `<${q.subject.value}> <${q.predicate.value}> ${obj} .`;
    })
    .join('\n');
}

// An `io` child measuring one size is a continuation of its parent's table, so
// it prints its row and nothing else.
if (!process.env.BENCH_IO_QUADS) {
  console.log(`node ${process.version} | section "${requested}" | median of ${ITERATIONS} iterations | times in ms\n`);
}

// ---------------------------------------------------------------------------
// 1a. SELECT: build SPARQL-JSON in JS, or let wasm serialise it.
// ---------------------------------------------------------------------------
if (requested === 'select') {
  console.log('--- SELECT results: JS Term walk vs wasm results_format ---');
  console.log(row(['rows', 'query->Maps', 'Maps->JSON', 'JS total', 'wasm JSON str', '+JSON.parse', 'wasm total', 'speedup']));

  const SELECT = `PREFIX ex: <http://ex.org/>\nSELECT ?s ?label WHERE { ?s ex:label ?label }`;

  for (const rows of [100, 1_000, 10_000, 50_000]) {
    const store = buildStore(rows);
    const tQuery: number[] = [], tWalk: number[] = [], tWasm: number[] = [], tParse: number[] = [];

    for (let i = 0; i < WARMUP; i++) {
      toSparqlJson(store.query(SELECT) as Array<Map<string, oxigraph.Term>>);
      JSON.parse(store.query(SELECT, { results_format: RESULTS_JSON }) as string);
    }

    for (let i = 0; i < ITERATIONS; i++) {
      let raw!: Array<Map<string, oxigraph.Term>>;
      tQuery.push(time(() => { raw = store.query(SELECT) as Array<Map<string, oxigraph.Term>>; }));
      tWalk.push(time(() => { toSparqlJson(raw); }));

      let str!: string;
      tWasm.push(time(() => { str = store.query(SELECT, { results_format: RESULTS_JSON }) as string; }));
      tParse.push(time(() => { JSON.parse(str); }));
    }

    const js = median(tQuery) + median(tWalk);
    // The parse back into JS is only paid by callers that need objects; a caller
    // that writes the bytes to a response (selectQueryStream) pays `wasm` alone.
    const wasm = median(tWasm) + median(tParse);
    console.log(row([rows, median(tQuery), median(tWalk), js, median(tWasm), median(tParse), wasm, `${(js / wasm).toFixed(2)}x`]));
}

}

// ---------------------------------------------------------------------------
// 1b. CONSTRUCT: same question, quads instead of bindings.
// ---------------------------------------------------------------------------
if (requested === 'construct') {
  console.log('--- CONSTRUCT results: JS quad walk vs wasm results_format ---');
  console.log(row(['quads', 'query->Quads', 'JS ->nquads', 'JS total', 'wasm ->nquads', 'speedup']));

  const CONSTRUCT = `PREFIX ex: <http://ex.org/>\nCONSTRUCT { ?s ex:copy ?label } WHERE { ?s ex:label ?label }`;

  for (const rows of [1_000, 10_000, 50_000]) {
    const store = buildStore(rows);
    const tQuery: number[] = [], tWalk: number[] = [], tWasm: number[] = [];

    for (let i = 0; i < WARMUP; i++) {
      toNQuads(store.query(CONSTRUCT) as unknown as Parameters<typeof toNQuads>[0]);
      store.query(CONSTRUCT, { results_format: NTRIPLES });
    }

    for (let i = 0; i < ITERATIONS; i++) {
      let quads!: Parameters<typeof toNQuads>[0];
      tQuery.push(time(() => { quads = store.query(CONSTRUCT) as unknown as Parameters<typeof toNQuads>[0]; }));
      tWalk.push(time(() => { toNQuads(quads); }));
      tWasm.push(time(() => { store.query(CONSTRUCT, { results_format: NTRIPLES }); }));
    }

    const js = median(tQuery) + median(tWalk);
    const wasm = median(tWasm);
    console.log(row([rows, median(tQuery), median(tWalk), js, wasm, `${(js / wasm).toFixed(2)}x`]));
}

}

// ---------------------------------------------------------------------------
// 2. How much of a downstream execution is Oxigraph re-parsing our VALUES text?
//
//    `parse+bind only` runs the identical VALUES block against a triple pattern
//    that matches nothing, so the join contributes nothing and what is left is
//    lexing and binding the spliced rows.
// ---------------------------------------------------------------------------
if (requested === 'values') {
  console.log('--- Downstream execution: join work vs parsing the spliced VALUES ---');
  console.log(row(['rows', 'query bytes', 'with VALUES', 'parse+bind only', 'no VALUES', 'parse share']));

  for (const rows of [10, 100, 1_000, 10_000]) {
    const store = buildStore(rows);
    const valuesRows: string[] = [];
    for (let i = 0; i < rows; i++) valuesRows.push(`(<http://ex.org/s${i}> "label ${i}")`);
    const values = valuesRows.join(' ');

    const withValues = `PREFIX ex: <http://ex.org/>\nSELECT ?s ?kind WHERE {\n VALUES (?s ?label) {${values}}\n ?s ex:kind ?kind .\n}`;
    const parseOnly = `PREFIX ex: <http://ex.org/>\nSELECT ?s WHERE {\n VALUES (?s ?label) {${values}}\n ?s <http://ex.org/matches-nothing> ?z .\n}`;
    const noValues = `PREFIX ex: <http://ex.org/>\nSELECT ?s ?kind WHERE { ?s ex:label ?label . ?s ex:kind ?kind . }`;

    const tWith: number[] = [], tParse: number[] = [], tNo: number[] = [];
    for (let i = 0; i < WARMUP; i++) {
      store.query(withValues);
      store.query(parseOnly);
      store.query(noValues);
    }
    for (let i = 0; i < ITERATIONS; i++) {
      tWith.push(time(() => { store.query(withValues); }));
      tParse.push(time(() => { store.query(parseOnly); }));
      tNo.push(time(() => { store.query(noValues); }));
    }

    const w = median(tWith), p = median(tParse);
    console.log(row([rows, withValues.length, w, p, median(tNo), `${((p / w) * 100).toFixed(0)}%`]));
}


  // Of that cost, how much is lexing bytes and how much is building rows?
  // Padding the terms grows the text without changing the row count: a cost that
  // tracks bytes is the parser, one that tracks rows is the solution sequence
  // being materialised — and only the first is recoverable by not using text.
  console.log('\n--- ...and of that, bytes (parser) vs rows (materialisation) ---');
  console.log(row(['rows', 'term padding', 'query KB', 'ms', 'ms/KB', 'µs/row']));

  const empty = new oxigraph.Store();
  empty.load('<http://ex.org/a> <http://ex.org/b> <http://ex.org/c> .', { format: 'nt' });

  for (const [rows, pad] of [[2_500, 0], [5_000, 0], [10_000, 0], [10_000, 20], [10_000, 60], [2_500, 60]] as const) {
    const p = 'x'.repeat(pad);
    const vs: string[] = [];
    for (let i = 0; i < rows; i++) vs.push(`(<http://ex.org/${p}s${i}> "label${p} ${i}")`);
    const text = `PREFIX ex: <http://ex.org/>\nSELECT ?s WHERE {\n VALUES (?s ?label) {${vs.join(' ')}}\n ?s <http://ex.org/matches-nothing> ?z .\n}`;

    for (let i = 0; i < WARMUP; i++) empty.query(text);
    const ts: number[] = [];
    for (let i = 0; i < ITERATIONS; i++) ts.push(time(() => { empty.query(text); }));
    const t = median(ts);
    const kb = text.length / 1024;
    console.log(row([rows, pad, kb, t, t / kb, (t * 1000) / rows]));
  }
}

// ---------------------------------------------------------------------------
// 3. Bulk I/O across the boundary: what a checkpoint costs.
// ---------------------------------------------------------------------------
if (requested === 'io') {
  // Each size needs its own process for the same reason each section does, and
  // more sharply: `load` is measured once per size, so a store already holding
  // half a million quads makes the next size look superlinear when it is not.
  // A run with no BENCH_IO_QUADS fans out and prints the header; a run with one
  // measures that single size.
  const sizes = [50_000, 200_000, 500_000];
  const only = process.env.BENCH_IO_QUADS ? Number(process.env.BENCH_IO_QUADS) : undefined;

  if (only === undefined) {
    console.log('--- load / dump: the durable store\'s boundary (one process per size) ---');
    console.log(row(['quads', 'load(string)', 'load(bytes)', 'µs/quad', 'dump', 'MB', 'dump MB/s']));
    for (const n of sizes) {
      const { status } = spawnSync(process.argv[0], [process.argv[1], 'io'], {
        stdio: 'inherit',
        env: { ...process.env, BENCH_IO_QUADS: String(n) },
      });
      if (status !== 0) process.exit(status ?? 1);
    }
  } else {
    const lines: string[] = [];
    for (let i = 0; i < only; i++) lines.push(`<http://ex.org/s${i}> <http://ex.org/p> "value number ${i} with some padding text" .`);
    const nt = lines.join('\n');
    // Release the per-line array before loading. Not housekeeping: half a
    // million live JS strings make `load` 16x slower (2.4s -> 39.8s at 500k
    // quads) because the load allocates hard and every GC pass then has to walk
    // them. Leaving it alive measures the harness, not Oxigraph -- and the same
    // trap is available to any caller that holds its input while loading it.
    lines.length = 0;
    const bytes = new TextEncoder().encode(nt);

    const fromString = new oxigraph.Store();
    const fromBytes = new oxigraph.Store();
    const tString = time(() => { fromString.load(nt, { format: 'nt' }); });
    const tBytes = time(() => { fromBytes.load(bytes, { format: 'nt' }); });

    let dumped!: string;
    const tDump = time(() => { dumped = fromString.dump({ format: 'nq' }); });
    const mb = dumped.length / 1048576;

    console.log(row([only, tString, tBytes, (tString * 1000) / only, tDump, mb, mb / (tDump / 1000)]));
  }
}
