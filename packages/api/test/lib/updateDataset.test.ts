/**
 * Update datasets: `using-graph-uri` and `using-named-graph-uri` (SPARQL 1.1
 * Protocol §2.2.3), and the checks that refuse a dataset an update cannot
 * take (docs/proposals/update-dataset.md).
 */
import { describe, it, expect } from 'vitest';
import {
  UpdateDatasetError,
  assertUpdateTakesDataset,
  assertUpdateTextTakesDataset,
  updateDatasetProtocolParameters,
  updateDatasetShape,
} from '../../src/lib/updateDataset.js';

const G1 = 'http://example.org/g1';
const G2 = 'http://example.org/g2';

const codeOf = (run: () => void): string | undefined => {
  try {
    run();
  } catch (error) {
    if (error instanceof UpdateDatasetError) return error.code;
    throw error;
  }
  return undefined;
};

describe('updateDatasetProtocolParameters', () => {
  it('gives one pair per graph, in order, and the empty-dataset graph for an empty part', () => {
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
    expect(updateDatasetShape('INSERT DATA { <urn:a> <urn:b> <urn:c> }'))
      .toEqual({ reads: false, namesDataset: false, deleteWhere: false });
    expect(updateDatasetShape('CLEAR ALL ; DELETE { ?s ?p ?o } WHERE { ?s ?p ?o }'))
      .toEqual({ reads: true, namesDataset: false, deleteWhere: false });
  });

  it('finds DELETE WHERE, in a request of one or more operations', () => {
    expect(updateDatasetShape('DELETE WHERE { ?s ?p ?o }'))
      .toEqual({ reads: true, namesDataset: false, deleteWhere: true });
    expect(updateDatasetShape('INSERT DATA { <urn:a> <urn:b> 1 } ; DELETE WHERE { ?s ?p ?o }')?.deleteWhere).toBe(true);
  });

  it('finds USING, USING NAMED and WITH', () => {
    for (const text of [
      `DELETE { ?s ?p ?o } USING <${G1}> WHERE { ?s ?p ?o }`,
      `DELETE { ?s ?p ?o } USING NAMED <${G1}> WHERE { GRAPH ?g { ?s ?p ?o } }`,
      `WITH <${G1}> DELETE { ?s ?p ?o } WHERE { ?s ?p ?o }`,
      `INSERT DATA { <urn:a> <urn:b> 1 } ; WITH <${G1}> DELETE { ?s ?p ?o } WHERE { ?s ?p ?o }`,
    ]) {
      expect(updateDatasetShape(text)?.namesDataset).toBe(true);
    }
  });

  it('gives null for text that does not parse', () => {
    expect(updateDatasetShape('NOT SPARQL')).toBeNull();
  });
});

describe('assertUpdateTextTakesDataset', () => {
  it('refuses a dataset with USING or WITH in the text', () => {
    expect(codeOf(() => assertUpdateTextTakesDataset(`WITH <${G1}> DELETE { ?s ?p ?o } WHERE { ?s ?p ?o }`, { defaultGraphs: [G2] })))
      .toBe('UPDATE_DATASET_CONFLICT');
  });

  it('refuses a dataset with DELETE WHERE', () => {
    expect(codeOf(() => assertUpdateTextTakesDataset('DELETE WHERE { ?s ?p ?o }', { defaultGraphs: [G1] })))
      .toBe('UPDATE_DATASET_DELETE_WHERE');
  });

  it('accepts either text with no dataset', () => {
    expect(codeOf(() => assertUpdateTextTakesDataset(`WITH <${G1}> DELETE { ?s ?p ?o } WHERE { ?s ?p ?o }`, undefined))).toBeUndefined();
    expect(codeOf(() => assertUpdateTextTakesDataset('DELETE WHERE { ?s ?p ?o }', undefined))).toBeUndefined();
  });
});

describe('assertUpdateTakesDataset', () => {
  const text = 'INSERT { ?s <urn:q> ?o } WHERE { ?s <urn:p> ?o }';

  it('refuses a dataset an executor cannot apply', () => {
    expect(codeOf(() => assertUpdateTakesDataset(text, { defaultGraphs: [G1] }, { supportsUpdateDataset: false }, 'urn:b')))
      .toBe('UPDATE_DATASET_UNSUPPORTED');
  });

  it('accepts it on an executor that can, and anything with no dataset', () => {
    expect(codeOf(() => assertUpdateTakesDataset(text, { defaultGraphs: [G1] }, { supportsUpdateDataset: true }))).toBeUndefined();
    expect(codeOf(() => assertUpdateTakesDataset(text, undefined, { supportsUpdateDataset: false }))).toBeUndefined();
  });
});
