/**
 * Update datasets: `using-graph-uri` and `using-named-graph-uri` (SPARQL 1.1
 * Protocol §2.2.3), and the `USING` clauses an in-process store gets instead.
 */
import { describe, it, expect } from 'vitest';
import {
  UpdateDatasetConflictError,
  assertUpdateTakesDataset,
  updateDatasetProtocolParameters,
  updateDatasetShape,
  withUsingClauses,
} from '../../src/lib/updateDataset.js';

const G1 = 'http://example.org/g1';
const G2 = 'http://example.org/g2';

describe('updateDatasetProtocolParameters', () => {
  it('gives one pair per graph, and the empty-dataset graph for an empty part', () => {
    expect(updateDatasetProtocolParameters({ defaultGraphs: [G1, G2], namedGraphs: [] })).toEqual([
      ['using-graph-uri', G1],
      ['using-graph-uri', G2],
      ['using-named-graph-uri', 'urn:sqlib:empty-dataset'],
    ]);
  });

  it('gives nothing for an absent part or no dataset', () => {
    expect(updateDatasetProtocolParameters({ namedGraphs: [G1] })).toEqual([['using-named-graph-uri', G1]]);
    expect(updateDatasetProtocolParameters(undefined)).toEqual([]);
  });
});

describe('updateDatasetShape', () => {
  it('tells an update that reads from one that does not', () => {
    expect(updateDatasetShape('INSERT DATA { <urn:a> <urn:b> <urn:c> }')).toEqual({ reads: false, namesDataset: false });
    expect(updateDatasetShape('DELETE WHERE { ?s ?p ?o }')).toEqual({ reads: true, namesDataset: false });
    expect(updateDatasetShape('CLEAR ALL ; DELETE { ?s ?p ?o } WHERE { ?s ?p ?o }')).toEqual({ reads: true, namesDataset: false });
  });

  it('finds USING, USING NAMED and WITH', () => {
    for (const text of [
      `DELETE { ?s ?p ?o } USING <${G1}> WHERE { ?s ?p ?o }`,
      `DELETE { ?s ?p ?o } USING NAMED <${G1}> WHERE { GRAPH ?g { ?s ?p ?o } }`,
      `WITH <${G1}> DELETE { ?s ?p ?o } WHERE { ?s ?p ?o }`,
    ]) {
      expect(updateDatasetShape(text)?.namesDataset).toBe(true);
    }
  });

  it('gives null for text that does not parse', () => {
    expect(updateDatasetShape('NOT SPARQL')).toBeNull();
  });
});

describe('assertUpdateTakesDataset', () => {
  it('refuses a dataset with USING or WITH in the text', () => {
    expect(() => assertUpdateTakesDataset(`WITH <${G1}> DELETE { ?s ?p ?o } WHERE { ?s ?p ?o }`, { defaultGraphs: [G2] }))
      .toThrow(UpdateDatasetConflictError);
  });

  it('accepts the same text with no dataset', () => {
    expect(() => assertUpdateTakesDataset(`WITH <${G1}> DELETE { ?s ?p ?o } WHERE { ?s ?p ?o }`, undefined)).not.toThrow();
  });
});

describe('withUsingClauses', () => {
  it('adds USING and USING NAMED to each operation with a WHERE clause', () => {
    const text = withUsingClauses(
      `INSERT DATA { <urn:a> <urn:b> <urn:c> } ; INSERT { ?s <urn:q> ?o } WHERE { ?s <urn:p> ?o }`,
      { defaultGraphs: [G1], namedGraphs: [G2] },
    );
    expect(text).toContain(`USING <${G1}> USING NAMED <${G2}> WHERE`);
    expect(text.match(/USING </g)).toHaveLength(1);
    expect(text).toContain('INSERT DATA');
  });

  it('writes DELETE WHERE as DELETE … WHERE, so it can take USING', () => {
    const text = withUsingClauses('DELETE WHERE { ?s <urn:p> ?o . GRAPH ?g { ?s <urn:p> ?o } }', { defaultGraphs: [] });
    expect(text).toMatch(/DELETE \{[\s\S]*\}\s*USING <urn:sqlib:empty-dataset> WHERE \{[\s\S]*GRAPH \?g/);
    expect(text).not.toContain('DELETE WHERE');
  });

  it('returns the text unchanged with no dataset', () => {
    const text = `WITH <${G1}> DELETE { ?s ?p ?o } WHERE { ?s ?p ?o }`;
    expect(withUsingClauses(text, undefined)).toBe(text);
  });

  it('refuses text that names its own dataset', () => {
    expect(() => withUsingClauses(`DELETE { ?s ?p ?o } USING <${G1}> WHERE { ?s ?p ?o }`, { namedGraphs: [G2] }))
      .toThrow(UpdateDatasetConflictError);
  });
});
