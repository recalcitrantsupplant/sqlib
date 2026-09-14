import { describe, it, expect } from 'vitest';
import { sdo, sqlib } from '../../src/persistence/namespaces.js';

describe('LDKit namespaces', () => {
  it('defines Schema.org namespace properties', () => {
    expect(typeof sdo).toBe('object');
    expect(sdo.name).toBeDefined();
    expect(sdo.description).toBeDefined();
    expect(sdo.version).toBeDefined();
    expect(sdo.dateCreated).toBeDefined();
  });

  it('defines SPARQL Query Library custom namespace properties', () => {
    expect(typeof sqlib).toBe('object');
    expect(sqlib.Backend).toBeDefined();
    expect(sqlib.Query).toBeDefined();
    expect(sqlib.QueryGroup).toBeDefined();
    expect(sqlib.Library).toBeDefined();
  });

  it('includes essential vocabulary terms for core entities', () => {
    // Core RDF types should be defined as strings
    expect(typeof sqlib.Backend).toBe('string');
    expect(typeof sqlib.Query).toBe('string');
    expect(typeof sqlib.QueryGroup).toBe('string');
    expect(typeof sqlib.Library).toBe('string');

    // Schema.org terms should be defined as strings
    expect(typeof sdo.name).toBe('string');
    expect(typeof sdo.description).toBe('string');

    // Should contain expected namespace prefixes
    expect(sqlib.Backend).toContain('sparql-query-lib');
    expect(sdo.name).toContain('schema.org');
  });
});