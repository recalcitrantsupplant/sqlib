/**
 * Whether an update can take graphs chosen at run time: the same facts the
 * API checks before it sends `using-graph-uri`.
 */
import { describe, it, expect } from 'vitest';
import { updateGraphsState } from '../../src/lib/updateGraphs';

const copy = 'INSERT { GRAPH <http://ex/out> { ?s ?p ?o } } WHERE { ?s ?p ?o }';

describe('updateGraphsState', () => {
  it('lets graphs be chosen for DELETE/INSERT … WHERE on an HTTP backend', () => {
    expect(updateGraphsState(copy, 'http')).toBe('choose');
  });

  it('has nothing to choose for an update with no WHERE clause', () => {
    expect(updateGraphsState('INSERT DATA { <http://ex/a> <http://ex/p> 1 }', 'http')).toBe('none');
    expect(updateGraphsState('CLEAR GRAPH <http://ex/g>', 'http')).toBe('none');
  });

  it('marks USING, USING NAMED and WITH as graphs in the text', () => {
    expect(updateGraphsState('INSERT { ?s ?p ?o } USING <http://ex/g> WHERE { ?s ?p ?o }', 'http')).toBe('text');
    expect(updateGraphsState('INSERT { ?s ?p ?o } USING NAMED <http://ex/g> WHERE { GRAPH ?g { ?s ?p ?o } }', 'http')).toBe('text');
    expect(updateGraphsState('WITH <http://ex/g> DELETE { ?s ?p ?o } WHERE { ?s ?p ?o }', 'http')).toBe('text');
  });

  it('marks DELETE WHERE, which cannot take graphs', () => {
    expect(updateGraphsState('DELETE WHERE { ?s ?p ?o }', 'http')).toBe('deleteWhere');
  });

  it('checks every operation of a request', () => {
    expect(updateGraphsState(`INSERT DATA { <http://ex/a> <http://ex/p> 1 } ; ${copy}`, 'http')).toBe('choose');
    expect(updateGraphsState(`${copy} ; WITH <http://ex/g> DELETE { ?s ?p ?o } WHERE { ?s ?p ?o }`, 'http')).toBe('text');
  });

  it('marks an in-process Oxigraph backend, which cannot apply graphs to an update', () => {
    expect(updateGraphsState(copy, 'oxigraphMemory')).toBe('backend');
    expect(updateGraphsState(copy, 'oxigraphEphemeral')).toBe('backend');
  });

  it('says query for a query, which always takes graphs', () => {
    expect(updateGraphsState('SELECT * WHERE { ?s ?p ?o }', 'oxigraphMemory')).toBe('query');
  });

  it('says unparsed for text that does not parse, so the caller decides from the type it knows', () => {
    expect(updateGraphsState('INSERT { ?s ?p ?o WHERE', 'http')).toBe('unparsed');
  });
});
