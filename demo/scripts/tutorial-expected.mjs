#!/usr/bin/env node
/**
 * Write the expected results of a tutorial library's query exercises.
 *
 * An exercise is a test whose subject is a query. Its expected result is what
 * the query's solution (`file` in seed.json) returns on the test's backend,
 * with each case's argument set. This runs each solution through `POST
 * /sparql` and writes the result beside it, so the expectations follow the
 * solutions. It reads the argument sets from the manifest, so it needs no
 * seeded tutorial: a server with the Rail store is enough.
 *
 * It trusts the solutions. Read the diff before you commit it, because a wrong
 * solution writes a matching wrong expectation. `bash scripts/ci/demo.sh` then
 * seeds the library and runs its tests against these files.
 *
 * Usage: tutorial-expected.mjs API_URL LIBRARY_DIR...
 *   API_URL      a sqlib that holds urn:sqlib:backend:rail-store, such as `just demo`
 *   LIBRARY_DIR  for example demo/libraries/sparql-tutorial
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [apiArg, ...dirs] = process.argv.slice(2);
if (!apiArg || !dirs.length) {
  console.error('usage: tutorial-expected.mjs API_URL LIBRARY_DIR...');
  process.exit(2);
}
const api = apiArg.replace(/\/$/, '');

/** A stored argument set's bindings, as the inline payload of one run. */
function inlineArguments(set) {
  if (!set) return {};
  const payload = {};
  const tuples = set.tupleBindings ?? [];
  if (tuples.length) {
    payload.arguments = tuples.map(binding => ({
      head: { vars: binding.variables },
      results: { bindings: binding.rows.map(row => row.values) },
    }));
  }
  for (const scalar of set.scalarBindings ?? []) {
    const key = scalar.parameterKind === 'limit' ? 'limits' : 'offsets';
    (payload[key] ??= []).push({ name: scalar.parameterName, value: scalar.numericValue });
  }
  return payload;
}

for (const dirArg of dirs) {
  const dir = resolve(dirArg);
  const manifest = JSON.parse(readFileSync(join(dir, 'seed.json'), 'utf8'));
  const queries = new Map((manifest.queries ?? []).map(query => [query.id, query]));
  const sets = new Map((manifest.argumentSets ?? []).map(set => [set.key, set]));
  const defaultBackend = manifest.library.defaultBackend;

  for (const test of manifest.tests ?? []) {
    if (test.subjectKind !== 'query') continue;
    const solution = queries.get(test.subject);
    if (!solution) throw new Error(`${test.name}: no query ${test.subject} in ${dirArg}`);
    for (const testCase of test.cases) {
      if (testCase.argumentSet && !sets.has(testCase.argumentSet)) {
        throw new Error(`${test.name}: no argument set "${testCase.argumentSet}"`);
      }
      const response = await fetch(`${api}/sparql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: readFileSync(join(dir, solution.file), 'utf8'),
          backendId: test.backend ?? defaultBackend,
          ...inlineArguments(sets.get(testCase.argumentSet)),
        }),
      });
      const body = await response.text();
      if (!response.ok) throw new Error(`${test.name} / ${testCase.name}: ${response.status} ${body}`);
      let written;
      if (test.expectationKind === 'graph') {
        const lines = [...new Set(body.split('\n').map(line => line.trim()).filter(Boolean))].sort();
        written = `${lines.join('\n')}\n`;
        console.log(`${testCase.expectedFile}: ${lines.length} triples`);
      } else if (test.expectationKind === 'boolean') {
        written = `${JSON.parse(body).boolean}\n`;
        console.log(`${testCase.expectedFile}: ${written.trim()}`);
      } else {
        const results = JSON.parse(body);
        written = `${JSON.stringify(results, null, 2)}\n`;
        console.log(`${testCase.expectedFile}: ${results.results.bindings.length} rows`);
      }
      writeFileSync(join(dir, testCase.expectedFile), written);
    }
  }
}
