/**
 * Serialisations and the inversion property.
 */

import { describe, expect, it } from 'vitest';
import {
  invertPatch,
  patchToNQuads,
  patchToRdfPatch,
  patchToSparqlUpdate,
  UnsupportedUpdateError,
} from '../src/index.js';
import { applyPatch, canonical, patchFor, storeFrom } from './support/harness.js';

const DATA = `
<http://ex/a> <http://ex/p> <http://ex/b> .
<http://ex/c> <http://ex/p> <http://ex/d> <http://ex/g> .
`;

const REPLACE =
  'DELETE { ?s <http://ex/p> ?o } INSERT { ?s <http://ex/was> ?o } WHERE { ?s <http://ex/p> ?o }';

describe('serialisation', () => {
  it('writes each side as N-Quads, graph included', async () => {
    const patch = await patchFor(storeFrom(DATA), 'INSERT DATA { GRAPH <http://ex/g> { <http://ex/n> <http://ex/p> <http://ex/o> } }');

    expect(patchToNQuads(patch).additions).toBe('<http://ex/n> <http://ex/p> <http://ex/o> <http://ex/g> .\n');
    expect(patchToNQuads(patch).deletions).toBe('');
  });

  it('writes ground SPARQL that any endpoint can apply', async () => {
    const patch = await patchFor(storeFrom(DATA), REPLACE);

    const sparql = patchToSparqlUpdate(patch);
    expect(sparql).toMatch(/^DELETE DATA \{/);
    expect(sparql).toContain(';');
    expect(sparql).toContain('INSERT DATA {');

    // And it is not just well-shaped text: applying it reaches the same store.
    const viaSparql = storeFrom(DATA);
    const viaQuads = storeFrom(DATA);
    viaSparql.update(sparql);
    applyPatch(viaQuads, patch);
    expect(await canonical(viaSparql)).toBe(await canonical(viaQuads));
  });

  it('writes named-graph quads as GRAPH blocks, not as N-Quads', async () => {
    // N-Quads inside `DELETE DATA` parses as a triple with a fourth node in it.
    // The two forms coincide for the default graph, which is exactly why this
    // needs its own case rather than riding along with the one above.
    const patch = await patchFor(
      storeFrom(DATA),
      'DELETE { GRAPH <http://ex/g> { ?s ?p ?o } } INSERT { GRAPH <http://ex/g2> { ?s ?p ?o } } ' +
        'WHERE { GRAPH <http://ex/g> { ?s ?p ?o } }',
    );

    const sparql = patchToSparqlUpdate(patch);
    expect(sparql).toContain('GRAPH <http://ex/g> {');
    expect(sparql).toContain('GRAPH <http://ex/g2> {');

    const viaSparql = storeFrom(DATA);
    const viaQuads = storeFrom(DATA);
    viaSparql.update(sparql);
    applyPatch(viaQuads, patch);
    expect(await canonical(viaSparql)).toBe(await canonical(viaQuads));
  });

  it('writes ground SPARQL an endpoint can apply for a patch that spans graphs', async () => {
    const patch = await patchFor(storeFrom(DATA), 'CLEAR ALL', { enumerateGraphOps: true });

    const viaSparql = storeFrom(DATA);
    viaSparql.update(patchToSparqlUpdate(patch));
    expect(await canonical(viaSparql)).toBe('');
  });

  it('refuses to write ground SPARQL for a patch carrying blank nodes', async () => {
    const patch = await patchFor(
      storeFrom(DATA),
      'INSERT { ?s <http://ex/about> [ <http://ex/of> ?o ] } WHERE { ?s <http://ex/p> ?o }',
    );

    expect(() => patchToSparqlUpdate(patch)).toThrow(UnsupportedUpdateError);
  });

  it('writes the RDF Patch text format', async () => {
    const patch = await patchFor(storeFrom(DATA), REPLACE);

    const text = patchToRdfPatch(patch, { id: 'urn:sqlib:patch:1', previous: 'urn:sqlib:patch:0' });
    const lines = text.trimEnd().split('\n');

    expect(lines[0]).toBe('H id <urn:sqlib:patch:1> .');
    expect(lines[1]).toBe('H prev <urn:sqlib:patch:0> .');
    expect(lines[2]).toBe('TX .');
    expect(lines.at(-1)).toBe('TC .');
    // Deletions before additions.
    expect(lines.filter((line) => line.startsWith('D '))).toHaveLength(patch.deletionCount);
    expect(lines.filter((line) => line.startsWith('A '))).toHaveLength(patch.additionCount);
    expect(lines.indexOf('TC .')).toBeGreaterThan(lines.findIndex((line) => line.startsWith('A ')));
  });

  it('names the graph on a quad that is not in the default graph', async () => {
    const patch = await patchFor(
      storeFrom(DATA),
      'DELETE WHERE { GRAPH <http://ex/g> { ?s <http://ex/p> ?o } }',
    );

    expect(patchToRdfPatch(patch)).toContain('D <http://ex/c> <http://ex/p> <http://ex/d> <http://ex/g> .');
  });
});

describe('inversion', () => {
  it('undoes the change it recorded', async () => {
    const store = storeFrom(DATA);
    const before = await canonical(store);

    const patch = await patchFor(store, REPLACE);
    applyPatch(store, patch);
    expect(await canonical(store)).not.toBe(before);

    applyPatch(store, invertPatch(patch));
    expect(await canonical(store)).toBe(before);
  });

  it('refuses to invert a patch that would have to re-mint blank nodes', async () => {
    const patch = await patchFor(
      storeFrom(DATA),
      'INSERT { ?s <http://ex/about> [ <http://ex/of> ?o ] } WHERE { ?s <http://ex/p> ?o }',
    );

    expect(() => invertPatch(patch)).toThrow(UnsupportedUpdateError);
  });
});
