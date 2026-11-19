/**
 * `applyExecutionArguments` and the graph policy functions take an optional
 * parser. Building one takes about 25 ms, so a call without a parser must reuse
 * the shared one. `POST /sparql` calls without a parser for each request.
 */
import { describe, expect, it } from 'vitest';
import { applyExecutionArguments } from '../../src/lib/executionArguments.js';
import { sharedSparqlQueryParser } from '../../src/lib/parser.js';

describe('the shared SPARQL parser', () => {
  it('is built once', () => {
    expect(sharedSparqlQueryParser()).toBe(sharedSparqlQueryParser());
  });

  it('serves applyExecutionArguments calls that pass no parser', () => {
    const query = 'SELECT ?s WHERE { VALUES ?s { UNDEF } ?s ?p ?o }';
    const argumentSets = [
      { head: { vars: ['s'] }, results: { bindings: [{ s: { type: 'uri', value: 'http://example.org/a' } }] } },
    ];
    applyExecutionArguments(query, { argumentSets, caller: null });

    // 40 calls took more than 1,000 ms when each call built a parser, and
    // take about 10 ms with the shared one.
    const start = performance.now();
    for (let call = 0; call < 40; call += 1) {
      expect(applyExecutionArguments(query, { argumentSets, caller: null })).toContain('http://example.org/a');
    }
    expect(performance.now() - start).toBeLessThan(400);
  });
});
