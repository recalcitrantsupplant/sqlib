import { describe, it, expect } from 'vitest';
import { QueryTypeIri } from '../../src/constants/queryTypes.js';
import {
  SPARQL_RESULTS_MEDIA_TYPES,
  RDF_MEDIA_TYPES,
  OUTPUT_MEDIA_TYPES,
  OUTPUT_MEDIA_TYPE_VALUES,
  PATCH_MEDIA_TYPES,
  getDefaultMediaType,
  isMediaTypeValidForQuery,
  MEDIA_TYPE_LABELS,
} from '../../src/types/media-types.js';

describe('Media Types', () => {
  describe('Constants', () => {
    it('should export SPARQL results media types', () => {
      expect(SPARQL_RESULTS_MEDIA_TYPES.JSON).toBe('application/sparql-results+json');
      expect(SPARQL_RESULTS_MEDIA_TYPES.XML).toBe('application/sparql-results+xml');
      expect(SPARQL_RESULTS_MEDIA_TYPES.CSV).toBe('text/csv');
      expect(SPARQL_RESULTS_MEDIA_TYPES.TSV).toBe('text/tab-separated-values');
    });

    it('should export RDF media types', () => {
      expect(RDF_MEDIA_TYPES.TURTLE).toBe('text/turtle');
      expect(RDF_MEDIA_TYPES.N_TRIPLES).toBe('application/n-triples');
      expect(RDF_MEDIA_TYPES.RDF_XML).toBe('application/rdf+xml');
      expect(RDF_MEDIA_TYPES.JSON_LD).toBe('application/ld+json');
      expect(RDF_MEDIA_TYPES.N3).toBe('text/n3');
      expect(RDF_MEDIA_TYPES.TRIG).toBe('application/trig');
      expect(RDF_MEDIA_TYPES.N_QUADS).toBe('application/n-quads');
    });

    it('should combine all media types in OUTPUT_MEDIA_TYPES', () => {
      expect(OUTPUT_MEDIA_TYPES.JSON).toBe('application/sparql-results+json');
      expect(OUTPUT_MEDIA_TYPES.TURTLE).toBe('text/turtle');
      expect(OUTPUT_MEDIA_TYPES.RDF_PATCH).toBe('text/rdf-patch');
      expect(Object.keys(OUTPUT_MEDIA_TYPES).length).toBe(12);
    });

    it('should provide array of all media type values', () => {
      expect(OUTPUT_MEDIA_TYPE_VALUES).toHaveLength(12);
      expect(OUTPUT_MEDIA_TYPE_VALUES).toContain('application/sparql-results+json');
      expect(OUTPUT_MEDIA_TYPE_VALUES).toContain('text/turtle');
    });

    it('should have media type labels for all output types', () => {
      expect(MEDIA_TYPE_LABELS[OUTPUT_MEDIA_TYPES.JSON]).toBe('JSON (SPARQL Results)');
      expect(MEDIA_TYPE_LABELS[OUTPUT_MEDIA_TYPES.TURTLE]).toBe('Turtle');
      expect(MEDIA_TYPE_LABELS[OUTPUT_MEDIA_TYPES.N_TRIPLES]).toBe('N-Triples');
      expect(MEDIA_TYPE_LABELS[OUTPUT_MEDIA_TYPES.RDF_PATCH]).toBe('RDF Patch');
      expect(Object.keys(MEDIA_TYPE_LABELS).length).toBe(12);
    });
  });
  describe('getDefaultMediaType', () => {
    it('returns JSON for SELECT queries', () => {
      expect(getDefaultMediaType(QueryTypeIri.select)).toBe(OUTPUT_MEDIA_TYPES.JSON);
    });

    it('returns JSON for ASK queries', () => {
      expect(getDefaultMediaType(QueryTypeIri.ask)).toBe(OUTPUT_MEDIA_TYPES.JSON);
    });

    it('returns TURTLE for CONSTRUCT queries', () => {
      expect(getDefaultMediaType(QueryTypeIri.construct)).toBe(OUTPUT_MEDIA_TYPES.TURTLE);
    });

    it('returns TURTLE for DESCRIBE queries', () => {
      expect(getDefaultMediaType(QueryTypeIri.describe)).toBe(OUTPUT_MEDIA_TYPES.TURTLE);
    });

    it('returns RDF Patch for the update forms that have a diff', () => {
      // An update produces no result set; what it has is the change it makes.
      expect(getDefaultMediaType(QueryTypeIri.update)).toBe(OUTPUT_MEDIA_TYPES.RDF_PATCH);
      expect(getDefaultMediaType(QueryTypeIri.insert)).toBe(OUTPUT_MEDIA_TYPES.RDF_PATCH);
      expect(getDefaultMediaType(QueryTypeIri.delete)).toBe(OUTPUT_MEDIA_TYPES.RDF_PATCH);
      expect(getDefaultMediaType(QueryTypeIri.deleteInsert)).toBe(OUTPUT_MEDIA_TYPES.RDF_PATCH);
    });

    it('leaves the graph-management verbs without an output', () => {
      // LOAD and friends name whole graphs, so there is no triple diff to show.
      expect(getDefaultMediaType(QueryTypeIri.load)).toBe(OUTPUT_MEDIA_TYPES.JSON);
      expect(getDefaultMediaType(QueryTypeIri.clear)).toBe(OUTPUT_MEDIA_TYPES.JSON);
    });

    it('falls back to JSON for unknown values', () => {
      expect(getDefaultMediaType('UNKNOWN')).toBe(OUTPUT_MEDIA_TYPES.JSON);
      expect(getDefaultMediaType('')).toBe(OUTPUT_MEDIA_TYPES.JSON);
    });

    it('handles null-like inputs safely', () => {
      expect(getDefaultMediaType(null as any)).toBe(OUTPUT_MEDIA_TYPES.JSON);
      expect(getDefaultMediaType(undefined as any)).toBe(OUTPUT_MEDIA_TYPES.JSON);
    });
  });

  describe('isMediaTypeValidForQuery', () => {
    it('accepts SPARQL result formats for SELECT queries', () => {
      expect(isMediaTypeValidForQuery(SPARQL_RESULTS_MEDIA_TYPES.JSON, QueryTypeIri.select)).toBe(true);
      expect(isMediaTypeValidForQuery(SPARQL_RESULTS_MEDIA_TYPES.XML, QueryTypeIri.select)).toBe(true);
      expect(isMediaTypeValidForQuery(SPARQL_RESULTS_MEDIA_TYPES.CSV, QueryTypeIri.select)).toBe(true);
      expect(isMediaTypeValidForQuery(SPARQL_RESULTS_MEDIA_TYPES.TSV, QueryTypeIri.select)).toBe(true);
    });

    it('rejects RDF formats for SELECT queries', () => {
      expect(isMediaTypeValidForQuery(RDF_MEDIA_TYPES.TURTLE, QueryTypeIri.select)).toBe(false);
      expect(isMediaTypeValidForQuery(RDF_MEDIA_TYPES.N_TRIPLES, QueryTypeIri.select)).toBe(false);
    });

    it('accepts JSON and XML for ASK queries', () => {
      expect(isMediaTypeValidForQuery(SPARQL_RESULTS_MEDIA_TYPES.JSON, QueryTypeIri.ask)).toBe(true);
      expect(isMediaTypeValidForQuery(SPARQL_RESULTS_MEDIA_TYPES.XML, QueryTypeIri.ask)).toBe(true);
    });

    it('rejects RDF media types for ASK queries', () => {
      expect(isMediaTypeValidForQuery(RDF_MEDIA_TYPES.TURTLE, QueryTypeIri.ask)).toBe(false);
    });

    it('accepts RDF formats for CONSTRUCT queries', () => {
      expect(isMediaTypeValidForQuery(RDF_MEDIA_TYPES.TURTLE, QueryTypeIri.construct)).toBe(true);
      expect(isMediaTypeValidForQuery(RDF_MEDIA_TYPES.N_TRIPLES, QueryTypeIri.construct)).toBe(true);
      expect(isMediaTypeValidForQuery(RDF_MEDIA_TYPES.JSON_LD, QueryTypeIri.construct)).toBe(true);
    });

    it('rejects SPARQL result formats for CONSTRUCT queries', () => {
      expect(isMediaTypeValidForQuery(SPARQL_RESULTS_MEDIA_TYPES.JSON, QueryTypeIri.construct)).toBe(false);
    });

    it('mirrors CONSTRUCT behaviour for DESCRIBE queries', () => {
      expect(isMediaTypeValidForQuery(RDF_MEDIA_TYPES.TURTLE, QueryTypeIri.describe)).toBe(true);
      expect(isMediaTypeValidForQuery(SPARQL_RESULTS_MEDIA_TYPES.JSON, QueryTypeIri.describe)).toBe(false);
    });

    it('accepts RDF Patch for update queries, and nothing else', () => {
      expect(isMediaTypeValidForQuery(PATCH_MEDIA_TYPES.RDF_PATCH, QueryTypeIri.update)).toBe(true);
      expect(isMediaTypeValidForQuery(PATCH_MEDIA_TYPES.RDF_PATCH, QueryTypeIri.deleteInsert)).toBe(true);
      expect(isMediaTypeValidForQuery(RDF_MEDIA_TYPES.TURTLE, QueryTypeIri.update)).toBe(false);
      expect(isMediaTypeValidForQuery(SPARQL_RESULTS_MEDIA_TYPES.JSON, QueryTypeIri.update)).toBe(false);
    });

    it('gives the graph-management verbs no valid output at all', () => {
      expect(isMediaTypeValidForQuery(PATCH_MEDIA_TYPES.RDF_PATCH, QueryTypeIri.load)).toBe(false);
      expect(isMediaTypeValidForQuery(PATCH_MEDIA_TYPES.RDF_PATCH, QueryTypeIri.drop)).toBe(false);
    });

    it('rejects unrecognized query type strings', () => {
      expect(isMediaTypeValidForQuery(SPARQL_RESULTS_MEDIA_TYPES.JSON, 'select')).toBe(false);
    });
  });
});
