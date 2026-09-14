import { describe, it, expect } from 'vitest';
import { xsd, ldkit as ldkitNs } from '../../src/persistence/namespaces.js';
import { inferOpenAPIType, XSD_TO_OPENAPI, FIELD_PATTERNS } from '../../scripts/lib/type-mappings.js';

describe('type-mappings', () => {
  describe('XSD_TO_OPENAPI', () => {
    it('should map xsd:dateTime to OpenAPI date-time format', () => {
      const mapping = XSD_TO_OPENAPI.get(xsd.dateTime);
      expect(mapping).toEqual({
        type: 'string',
        format: 'date-time',
        readOnly: true
      });
    });

    it('should map xsd:integer to OpenAPI integer', () => {
      const mapping = XSD_TO_OPENAPI.get(xsd.integer);
      expect(mapping).toEqual({ type: 'integer' });
    });

    it('should map xsd:anyURI to OpenAPI IRI format', () => {
      const mapping = XSD_TO_OPENAPI.get(xsd.anyURI);
      expect(mapping).toEqual({
        type: 'string',
        format: 'iri'
      });
    });

    it('should map ldkit.IRI to OpenAPI IRI format', () => {
      const mapping = XSD_TO_OPENAPI.get((ldkitNs as any).IRI);
      expect(mapping).toEqual({
        type: 'string',
        format: 'iri'
      });
    });
  });

  describe('FIELD_PATTERNS', () => {
    it('should have pattern for date fields', () => {
      const patterns = Array.from(FIELD_PATTERNS.keys());
      const datePattern = patterns.find(p => p.test('dateCreated'));
      expect(datePattern).toBeDefined();

      const mapping = FIELD_PATTERNS.get(datePattern!);
      expect(mapping).toEqual({
        type: 'string',
        format: 'date-time',
        readOnly: true
      });
    });

    it('should match dateCreated and dateModified fields', () => {
      const patterns = Array.from(FIELD_PATTERNS.keys());
      const datePattern = patterns.find(p => p.test('dateCreated'));

      expect(datePattern?.test('dateCreated')).toBe(true);
      expect(datePattern?.test('dateModified')).toBe(true);
    });

    it('should have pattern for URI/IRI fields', () => {
      const patterns = Array.from(FIELD_PATTERNS.keys());
      const uriPattern = patterns.find(p => p.test('endpoint'));
      expect(uriPattern).toBeDefined();

      const mapping = FIELD_PATTERNS.get(uriPattern!);
      expect(mapping).toEqual({
        type: 'string',
        format: 'iri'
      });
    });

    it('should match various URI-like field names', () => {
      const patterns = Array.from(FIELD_PATTERNS.keys());
      const uriPattern = patterns.find(p => p.test('endpoint'));

      expect(uriPattern?.test('url')).toBe(true);
      expect(uriPattern?.test('URI')).toBe(true);
      expect(uriPattern?.test('iri')).toBe(true);
      expect(uriPattern?.test('endpoint')).toBe(true);
    });
  });

  describe('inferOpenAPIType', () => {
    describe('with explicit XSD types', () => {
      it('should infer dateTime from XSD type', () => {
        const result = inferOpenAPIType('someField', xsd.dateTime, undefined);
        expect(result).toEqual({
          type: 'string',
          format: 'date-time',
          readOnly: true
        });
      });

      it('should infer integer from XSD type', () => {
        const result = inferOpenAPIType('count', xsd.integer, undefined);
        expect(result).toEqual({ type: 'integer' });
      });

      it('should infer IRI from XSD anyURI', () => {
        const result = inferOpenAPIType('endpoint', xsd.anyURI, undefined);
        expect(result).toEqual({
          type: 'string',
          format: 'iri'
        });
      });

      it('should infer IRI from ldkit.IRI', () => {
        const result = inferOpenAPIType('id', (ldkitNs as any).IRI, undefined);
        expect(result).toEqual({
          type: 'string',
          format: 'iri'
        });
      });
    });

    describe('with field name patterns (no explicit type)', () => {
      it('should infer date-time from field name pattern', () => {
        const result = inferOpenAPIType('dateCreated', undefined, undefined);
        expect(result).toEqual({
          type: 'string',
          format: 'date-time',
          readOnly: true
        });
      });

      it('should infer IRI from field name pattern', () => {
        const result = inferOpenAPIType('endpoint', undefined, 'http://schema.org/endpoint');
        expect(result).toEqual({
          type: 'string',
          format: 'iri'
        });
      });

      it('should infer IRI from @id containing URI', () => {
        const result = inferOpenAPIType('backendURI', undefined, 'http://schema.org/url');
        expect(result).toEqual({
          type: 'string',
          format: 'iri'
        });
      });
    });

    describe('with array option', () => {
      it('should wrap type in array', () => {
        const result = inferOpenAPIType('endpoints', xsd.anyURI, undefined, {
          isArray: true
        });
        expect(result).toEqual({
          type: 'array',
          items: {
            type: 'string',
            format: 'iri'
          }
        });
      });

      it('should wrap integer array', () => {
        const result = inferOpenAPIType('counts', xsd.integer, undefined, {
          isArray: true
        });
        expect(result).toEqual({
          type: 'array',
          items: { type: 'integer' }
        });
      });

      it('should mark array as nullable when optional', () => {
        const result = inferOpenAPIType('tags', undefined, undefined, {
          isArray: true,
          isOptional: true
        });
        expect(result).toEqual({
          type: 'array',
          items: { type: 'string' },
          nullable: true
        });
      });
    });

    describe('with optional flag', () => {
      it('should add nullable for optional fields', () => {
        const result = inferOpenAPIType('description', undefined, undefined, {
          isOptional: true
        });
        expect(result).toEqual({
          type: 'string',
          nullable: true
        });
      });

      it('should add nullable for optional integers', () => {
        const result = inferOpenAPIType('count', xsd.integer, undefined, {
          isOptional: true
        });
        expect(result).toEqual({
          type: 'integer',
          nullable: true
        });
      });
    });

    describe('with a declared value vocabulary', () => {
      // The blocker Phase B step 1 removes: `ldkit.IRI` alone yields
      // `format: iri`, which rejects `"http"` — the only thing the endpoint has
      // ever accepted for backendType. `@values` states the wire vocabulary, so
      // the emitted document describes the wire.
      it('should emit the tokens as an enum, not the IRI format', () => {
        const result = inferOpenAPIType('backendType', ldkitNs.IRI, undefined, {
          values: {
            http: 'https://sparql-query-lib/backendType/http',
            oxigraphEphemeral: 'https://sparql-query-lib/backendType/oxigraphEphemeral',
          },
        });
        expect(result).toEqual({
          type: 'string',
          enum: ['http', 'oxigraphEphemeral'],
        });
      });

      // `nullable: true` alone does not survive an enum: ajv has no such
      // keyword, so a `null` reaching `{type: 'string'}` is *coerced* to `''`,
      // which the enum then rejects. The vocabulary has to permit null outright.
      it('should permit null outright when the property is optional', () => {
        const result = inferOpenAPIType('queryMethod', ldkitNs.IRI, undefined, {
          values: { post: 'urn:m:post', get: 'urn:m:get' },
          isOptional: true,
        });
        expect(result).toEqual({
          type: ['string', 'null'],
          enum: ['post', 'get', null],
          nullable: true,
        });
      });

      it('should take the vocabulary over a field-name pattern', () => {
        // `endpoint` matches the IRI pattern; a declared vocabulary outranks it.
        const result = inferOpenAPIType('endpoint', undefined, 'https://schema.org/url', {
          values: { local: 'urn:e:local', remote: 'urn:e:remote' },
        });
        expect(result).toEqual({
          type: 'string',
          enum: ['local', 'remote'],
        });
      });
    });

    describe('fallback behavior', () => {
      it('should default to string for unknown types', () => {
        const result = inferOpenAPIType('unknownField', undefined, undefined);
        expect(result).toEqual({ type: 'string' });
      });

      it('should prioritize explicit type over field name pattern', () => {
        // Even though field name contains 'url', explicit integer type wins
        const result = inferOpenAPIType('urlCount', xsd.integer, undefined);
        expect(result).toEqual({ type: 'integer' });
      });
    });
  });
});