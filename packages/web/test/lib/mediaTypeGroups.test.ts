import { describe, expect, it } from 'vitest';
import { QueryTypeIri, OUTPUT_MEDIA_TYPES } from '@sparql-query-lib/types';
import {
  getAllMediaTypeOptions,
  getGroupedMediaTypeOptions,
  getMediaTypeChoiceGroups,
  getMediaTypeHint,
} from '../../src/lib/mediaTypes';

const flatten = (queryType: Parameters<typeof getGroupedMediaTypeOptions>[0]) =>
  getGroupedMediaTypeOptions(queryType).flatMap(group => group.options);

const suggested = (queryType: Parameters<typeof getGroupedMediaTypeOptions>[0]) =>
  flatten(queryType).filter(option => option.isPrimary).map(option => option.value);

describe('grouped mediatype options', () => {
  it('always offers every result format, in two groups', () => {
    for (const queryType of [null, QueryTypeIri.select, QueryTypeIri.ask, QueryTypeIri.construct]) {
      const groups = getGroupedMediaTypeOptions(queryType);
      expect(groups.map(g => g.category)).toEqual(['TABULAR', 'GRAPH']);
      expect(flatten(queryType).map(o => o.value).sort()).toEqual(
        getAllMediaTypeOptions()
          .map(o => o.value)
          .filter(value => value !== OUTPUT_MEDIA_TYPES.RDF_PATCH)
          .sort(),
      );
    }
  });

  it('adds the patch group only where there is a patch to ask for', () => {
    // Not a format the result comes back in — a different thing to ask for.
    expect(getGroupedMediaTypeOptions(QueryTypeIri.update).map(g => g.category))
      .toEqual(['TABULAR', 'GRAPH', 'PATCH']);
    expect(getGroupedMediaTypeOptions(QueryTypeIri.drop).map(g => g.category))
      .toEqual(['TABULAR', 'GRAPH']);
  });

  it('suggests the SPARQL Results formats for a SELECT', () => {
    expect(suggested(QueryTypeIri.select)).toEqual([
      OUTPUT_MEDIA_TYPES.JSON,
      OUTPUT_MEDIA_TYPES.XML,
      OUTPUT_MEDIA_TYPES.CSV,
      OUTPUT_MEDIA_TYPES.TSV,
    ]);
  });

  it('narrows an ASK to the formats that can carry a boolean, and heads them so', () => {
    expect(suggested(QueryTypeIri.ask)).toEqual([OUTPUT_MEDIA_TYPES.JSON, OUTPUT_MEDIA_TYPES.XML]);
    expect(getGroupedMediaTypeOptions(QueryTypeIri.ask)[0].label).toBe('BOOLEAN');
    expect(getGroupedMediaTypeOptions(QueryTypeIri.select)[0].label).toBe('TABULAR');
  });

  it('suggests the RDF serialisations for a CONSTRUCT or DESCRIBE', () => {
    for (const queryType of [QueryTypeIri.construct, QueryTypeIri.describe]) {
      expect(suggested(queryType)).toEqual([
        OUTPUT_MEDIA_TYPES.TURTLE,
        OUTPUT_MEDIA_TYPES.N_TRIPLES,
        OUTPUT_MEDIA_TYPES.RDF_XML,
        OUTPUT_MEDIA_TYPES.JSON_LD,
        OUTPUT_MEDIA_TYPES.N3,
        OUTPUT_MEDIA_TYPES.TRIG,
        OUTPUT_MEDIA_TYPES.N_QUADS,
      ]);
    }
  });

  it('narrows an update to the one output it has', () => {
    for (const queryType of [QueryTypeIri.update, QueryTypeIri.insert, QueryTypeIri.deleteInsert]) {
      expect(suggested(queryType)).toEqual([OUTPUT_MEDIA_TYPES.RDF_PATCH]);
    }
  });

  it('has no opinion when the query type is unknown or has no output at all', () => {
    // DROP names a graph rather than triples, so there is no diff to suggest.
    for (const queryType of [null, QueryTypeIri.drop]) {
      expect(flatten(queryType).every(option => option.isPrimary)).toBe(true);
    }
  });

  it('says why a format is played down for an update', () => {
    const groups = getGroupedMediaTypeOptions(QueryTypeIri.update);
    const turtle = groups[1].options.find(o => o.value === OUTPUT_MEDIA_TYPES.TURTLE)!;
    const patch = groups[2].options.find(o => o.value === OUTPUT_MEDIA_TYPES.RDF_PATCH)!;

    expect(getMediaTypeHint(turtle, QueryTypeIri.update)).toContain('the patch it would make');
    expect(getMediaTypeHint(patch, QueryTypeIri.update)).toBeNull();
  });

  it('explains a played-down format and stays quiet about a suggested one', () => {
    const [tabular, graph] = getGroupedMediaTypeOptions(QueryTypeIri.construct);
    const csv = tabular.options.find(o => o.value === OUTPUT_MEDIA_TYPES.CSV)!;
    const turtle = graph.options.find(o => o.value === OUTPUT_MEDIA_TYPES.TURTLE)!;

    expect(getMediaTypeHint(csv, QueryTypeIri.construct)).toContain('graph result');
    expect(getMediaTypeHint(turtle, QueryTypeIri.construct)).toBeNull();
  });

  it('carries the same grouping into the run bar shape', () => {
    const groups = getMediaTypeChoiceGroups(QueryTypeIri.select);
    expect(groups.map(g => g.label)).toEqual(['TABULAR', 'GRAPH']);
    expect(groups[0].options.every(o => !o.muted)).toBe(true);
    expect(groups[1].options.every(o => o.muted)).toBe(true);
    expect(groups[1].options[0].title).toContain('result set');
  });
});
