/**
 * The SPARQL-only path — what every HTTP backend takes.
 *
 * `packages/rdf-delta` pins its equivalence suite to in-process Oxigraph, where
 * quads come back as objects and membership is exact. Over HTTP neither is
 * true: results arrive as N-Quads text and SPARQL Results JSON, and a blank
 * node cannot be asked about at all. This checks the adapter that bridges that,
 * against a store standing in for the endpoint.
 */

import { describe, it, expect } from 'vitest';
import * as oxigraph from 'oxigraph';
import { derivePatch } from '@sparql-query-lib/rdf-delta';
import { executorDeltaStore } from '../../src/lib/deltaStore.js';
import type { ISparqlExecutor } from '../../src/server/ISparqlExecutor.js';

/**
 * An executor with the shape of the HTTP one and the behaviour of a local
 * store: it answers in the serialisations an endpoint would return, which is
 * exactly the part being tested.
 */
function endpointLike(store: oxigraph.Store): ISparqlExecutor {
  return {
    async constructQueryParsed(sparql: string) {
      return {
        result: store.query(sparql, { results_format: 'application/n-quads' }) as string,
        duration: 0,
        contentType: 'application/n-quads',
      };
    },
    async selectQueryParsed(sparql: string) {
      return {
        result: JSON.parse(store.query(sparql, { results_format: 'application/sparql-results+json' }) as string),
        duration: 0,
        contentType: 'application/sparql-results+json',
      };
    },
    async update() {
      throw new Error('not used');
    },
    async askQuery() {
      throw new Error('not used');
    },
    async selectQueryStream() {
      throw new Error('not used');
    },
    async constructQueryStream() {
      throw new Error('not used');
    },
  } as unknown as ISparqlExecutor;
}

function seeded(nquads: string): oxigraph.Store {
  const store = new oxigraph.Store();
  store.load(nquads, { format: 'application/n-quads' });
  return store;
}

const DATA = `
<http://ex/a> <http://ex/status> "draft" .
<http://ex/b> <http://ex/status> "live" .
<http://ex/c> <http://ex/n> "1"^^<http://www.w3.org/2001/XMLSchema#integer> .
<http://ex/d> <http://ex/label> "bonjour"@fr .
<http://ex/e> <http://ex/p> _:hidden .
`;

describe('a backend reachable only over SPARQL', () => {
  it('derives the same net diff as the in-process path', async () => {
    const store = seeded(DATA);

    const patch = await derivePatch(
      'DELETE { ?s <http://ex/status> "draft" } INSERT { ?s <http://ex/status> "live" } WHERE { ?s <http://ex/status> "draft" }',
      executorDeltaStore(endpointLike(store)),
    );

    expect(patch.deletionCount).toBe(1);
    expect(patch.additionCount).toBe(1);
    expect(patch.netEffectExact).toBe(true);
  });

  it('carries datatypes and language tags across the results-JSON boundary', async () => {
    const store = seeded(DATA);

    const patch = await derivePatch(
      'DELETE DATA { <http://ex/c> <http://ex/n> 1 . <http://ex/d> <http://ex/label> "bonjour"@fr }',
      executorDeltaStore(endpointLike(store)),
    );

    // Both existed, so both are real deletions: a lost datatype or lang tag
    // would have made the membership test miss and the count come back 0.
    expect(patch.deletionCount).toBe(2);
  });

  it('keeps a blank-node deletion but says it could not verify it', async () => {
    const store = seeded(DATA);

    const patch = await derivePatch(
      'DELETE WHERE { <http://ex/e> <http://ex/p> ?o }',
      executorDeltaStore(endpointLike(store)),
    );

    // No SPARQL text can name a blank node, so the existence check cannot run.
    // The quad is kept — it came out of the store a moment ago — and the patch
    // reports the gap rather than implying an exactness it does not have.
    expect(patch.deletionCount).toBe(1);
    expect(patch.netEffectExact).toBe(false);
  });

  it('cannot apply a blank-node patch as ground SPARQL, and says so', async () => {
    const store = seeded(DATA);

    const patch = await derivePatch(
      'INSERT { ?s <http://ex/about> [ <http://ex/of> ?o ] } WHERE { ?s <http://ex/status> ?o }',
      executorDeltaStore(endpointLike(store)),
    );

    expect(patch.applyMode).toBe('store');
    expect(patch.revertible).toBe(false);
  });
});
