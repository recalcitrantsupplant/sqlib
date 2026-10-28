import { describe, it, expect } from 'vitest';
import {
  EMPTY_DATASET_GRAPH,
  datasetFromRequest,
  datasetProtocolParameters,
  hasDataset,
  intersectDatasets,
} from '../../src/lib/dataset.js';
import { ValidationError } from '../../src/lib/validationError.js';

const A = 'http://example.org/g/a';
const B = 'http://example.org/g/b';
const C = 'http://example.org/g/c';

describe('datasetFromRequest', () => {
  it('returns undefined when neither part is present', () => {
    expect(datasetFromRequest({})).toBeUndefined();
    expect(datasetFromRequest({ defaultGraphs: null, namedGraphs: undefined })).toBeUndefined();
  });

  it('keeps an empty part, which means no graphs', () => {
    expect(datasetFromRequest({ namedGraphs: [] })).toEqual({ namedGraphs: [] });
  });

  it('drops duplicates and keeps the first', () => {
    expect(datasetFromRequest({ defaultGraphs: [B, A, B] })).toEqual({ defaultGraphs: [B, A] });
  });

  it('refuses a part that is not an array', () => {
    expect(() => datasetFromRequest({ defaultGraphs: A })).toThrow(ValidationError);
  });

  it('refuses a value that is not an IRI', () => {
    expect(() => datasetFromRequest({ namedGraphs: ['not an iri'] })).toThrow(/IRIs only/);
    expect(() => datasetFromRequest({ namedGraphs: [42] })).toThrow(ValidationError);
  });
});

describe('hasDataset', () => {
  it('is true only when a part is present', () => {
    expect(hasDataset(undefined)).toBe(false);
    expect(hasDataset({})).toBe(false);
    expect(hasDataset({ defaultGraphs: [] })).toBe(true);
  });
});

describe('intersectDatasets', () => {
  it('returns the other dataset when one is absent', () => {
    expect(intersectDatasets(undefined, undefined)).toBeUndefined();
    expect(intersectDatasets({ defaultGraphs: [A] }, undefined)).toEqual({ defaultGraphs: [A] });
    expect(intersectDatasets(undefined, { namedGraphs: [B] })).toEqual({ namedGraphs: [B] });
  });

  it('intersects part by part', () => {
    expect(intersectDatasets(
      { defaultGraphs: [A, B], namedGraphs: [A, B, C] },
      { defaultGraphs: [B, C], namedGraphs: [C] },
    )).toEqual({ defaultGraphs: [B], namedGraphs: [C] });
  });

  it('keeps a part that only one side restricts', () => {
    expect(intersectDatasets({ defaultGraphs: [A] }, { namedGraphs: [B] }))
      .toEqual({ defaultGraphs: [A], namedGraphs: [B] });
  });

  it('gives an empty part when the sides share no graph', () => {
    expect(intersectDatasets({ namedGraphs: [A] }, { namedGraphs: [B] })).toEqual({ namedGraphs: [] });
  });
});

describe('datasetProtocolParameters', () => {
  it('sends one pair per graph', () => {
    expect(datasetProtocolParameters({ defaultGraphs: [A, B], namedGraphs: [C] })).toEqual([
      ['default-graph-uri', A],
      ['default-graph-uri', B],
      ['named-graph-uri', C],
    ]);
  });

  it('sends the sentinel for a part that is present and empty', () => {
    expect(datasetProtocolParameters({ namedGraphs: [] })).toEqual([['named-graph-uri', EMPTY_DATASET_GRAPH]]);
  });

  it('sends nothing without a dataset', () => {
    expect(datasetProtocolParameters(undefined)).toEqual([]);
  });
});
