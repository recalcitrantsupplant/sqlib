/**
 * Isolates the superlinear cost inside SparqlQueryParser.applyArguments.
 * Run: node_modules/.bin/tsx scripts/bench-apply-args.ts
 */
import { SparqlQueryParser } from '../src/lib/parser.js';

const parser = new SparqlQueryParser() as any;

const DOWNSTREAM = `
PREFIX ex: <http://ex.org/>
SELECT ?s ?kind WHERE {
  VALUES (?s ?label) { (UNDEF UNDEF) }
  ?s ex:kind ?kind .
}
`;

function argSet(rows: number) {
  const bindings = [];
  for (let i = 0; i < rows; i++) {
    bindings.push({
      s: { type: 'uri', value: `http://ex.org/s${i}` },
      label: { type: 'literal', value: `label ${i}` },
    });
  }
  return { head: { vars: ['s', 'label'] }, arguments: { bindings } };
}

const ms = (fn: () => void) => {
  const t = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - t) / 1e6;
};
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

console.log('rows'.padStart(8) + 'parse'.padStart(11) + 'buildRows'.padStart(12) + 'generate'.padStart(12) + 'total'.padStart(11) + 'µs/row'.padStart(11) + 'scaling'.padStart(10));

let prevRows = 0, prevTotal = 0;
for (const rows of [125, 250, 500, 1000, 2000, 4000, 8000]) {
  const iters = rows > 2000 ? 3 : 10;
  const set = argSet(rows);

  const tParse: number[] = [], tBuild: number[] = [], tGen: number[] = [], tTotal: number[] = [];
  for (let i = 0; i < iters; i++) {
    let parsed: any;
    tParse.push(ms(() => { parsed = parser.parseQuery(DOWNSTREAM); }));

    // Row construction only (mirrors the forEach body in applyArguments).
    const prefixes = parser.collectPrefixes(parsed);
    tBuild.push(ms(() => {
      const out: any[] = [];
      for (const argRow of set.arguments.bindings) {
        const newRow: any = {};
        for (const v of set.head.vars) newRow[v] = parser.buildValuesTerm((argRow as any)[v], v, 0, prefixes);
        out.push(newRow);
      }
    }));

    const applied = parser.applyArguments(DOWNSTREAM, [set]);
    const reparsed = parser.parseQuery(applied);
    tGen.push(ms(() => { parser.generator.generate(reparsed); }));

    tTotal.push(ms(() => { parser.applyArguments(DOWNSTREAM, [set]); }));
  }

  const p = median(tParse), b = median(tBuild), g = median(tGen), t = median(tTotal);
  const scaling = prevRows ? (t / prevTotal) / (rows / prevRows) : NaN;
  console.log(
    String(rows).padStart(8) + p.toFixed(2).padStart(11) + b.toFixed(2).padStart(12) +
    g.toFixed(2).padStart(12) + t.toFixed(2).padStart(11) +
    ((t * 1000) / rows).toFixed(1).padStart(11) +
    (isNaN(scaling) ? '-' : `${scaling.toFixed(2)}x`).padStart(10)
  );
  prevRows = rows; prevTotal = t;
}
console.log('\nscaling = cost-per-row growth vs previous size. 1.0 = linear, >1 = superlinear.');
