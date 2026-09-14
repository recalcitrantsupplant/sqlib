/**
 * Benchmarks the per-node-hop overhead in query group execution.
 *
 * A hop today is: execute upstream -> SPARQL-JSON -> ArgumentSet -> applyArguments
 * (full SPARQL parse + VALUES injection + regenerate) -> downstream engine reparses
 * an inflated query string.
 *
 * This measures each stage against the floor (executing the queries themselves), so
 * we can size the win from the first recommendation of the engine-integration
 * and transport analysis.
 *
 * Run: node_modules/.bin/tsx scripts/bench-node-hop.ts
 */
import * as oxigraph from 'oxigraph';
import { SparqlQueryParser } from '../src/lib/parser.js';
import type { SparqlBinding } from '../src/lib/query-chaining.js';

const ROW_COUNTS = [10, 100, 1_000, 10_000];
const ITERATIONS = 30;

const parser = new SparqlQueryParser();

/** Upstream store: N subjects, each with a label. */
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

const UPSTREAM = `
PREFIX ex: <http://ex.org/>
SELECT ?s ?label WHERE { ?s ex:label ?label }
`;

/** Downstream node with an UNDEF VALUES parameter slot, as query groups author them. */
const DOWNSTREAM = `
PREFIX ex: <http://ex.org/>
SELECT ?s ?kind WHERE {
  VALUES (?s ?label) { (UNDEF UNDEF) }
  ?s ex:kind ?kind .
}
`;

function time(fn: () => void): number {
  const t = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - t) / 1e6; // ms
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Mirrors OxigraphSparqlExecutor.convertOxigraphSelectToJson. */
function toSparqlJson(results: Array<Map<string, oxigraph.Term>>): { head: { vars: string[] }; results: { bindings: SparqlBinding[] } } {
  const vars = results.length > 0 ? [...results[0].keys()] : [];
  const bindings: SparqlBinding[] = [];
  for (const row of results) {
    const b: SparqlBinding = {};
    for (const [k, term] of row.entries()) {
      if (!term) continue;
      if (term.termType === 'NamedNode') b[k] = { type: 'uri', value: term.value };
      else if (term.termType === 'BlankNode') b[k] = { type: 'bnode', value: term.value };
      else b[k] = { type: 'literal', value: term.value };
    }
    bindings.push(b);
  }
  return { head: { vars }, results: { bindings } };
}

console.log(`node ${process.version} | median of ${ITERATIONS} iterations | times in ms\n`);
console.log(
  ['rows', 'A: exec up', 'B: ->JSON', 'C: dedup', 'D: applyArgs', 'E: exec down', 'overhead B+C+D', '% of hop']
    .map((h) => h.padStart(14))
    .join('')
);

for (const rows of ROW_COUNTS) {
  const store = buildStore(rows);

  const tExec: number[] = [];
  const tJson: number[] = [];
  const tDedup: number[] = [];
  const tApply: number[] = [];
  const tDown: number[] = [];

  for (let i = 0; i < ITERATIONS; i++) {
    let raw!: Array<Map<string, oxigraph.Term>>;
    tExec.push(time(() => { raw = store.query(UPSTREAM) as Array<Map<string, oxigraph.Term>>; }));

    let json!: ReturnType<typeof toSparqlJson>;
    tJson.push(time(() => { json = toSparqlJson(raw); }));

    // ExecutionEngine.ts:774 dedups rows by JSON.stringify.
    tDedup.push(time(() => {
      const seen = new Set<string>();
      for (const r of json.results.bindings) seen.add(JSON.stringify(r));
    }));

    const argSet = { head: { vars: json.head.vars }, arguments: { bindings: json.results.bindings } };
    let applied!: string;
    tApply.push(time(() => { applied = parser.applyArguments(DOWNSTREAM, [argSet as never]); }));

    tDown.push(time(() => { store.query(applied); }));
  }

  const a = median(tExec), b = median(tJson), c = median(tDedup), d = median(tApply), e = median(tDown);
  const overhead = b + c + d;
  const hop = a + b + c + d + e;
  console.log(
    [rows, a, b, c, d, e, overhead, `${((overhead / hop) * 100).toFixed(1)}%`]
      .map((v) => (typeof v === 'number' ? v.toFixed(2) : String(v)).padStart(14))
      .join('')
  );
}
