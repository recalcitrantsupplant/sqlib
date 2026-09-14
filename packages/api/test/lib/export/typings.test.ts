import { describe, expect, it } from 'vitest';
import { buildExportBundle } from '../../../src/lib/export/queryBundle.js';
import {
  bundleTypingsFileName,
  generateBundleTypings,
} from '../../../src/lib/export/typings.js';

const QUERIES = [
  {
    name: 'People by city',
    queryString: 'SELECT ?name WHERE { VALUES (?city) { (UNDEF) } ?p ?name ?city }',
    description: 'Everyone in a city',
  },
  {
    name: 'Paged',
    queryString: 'SELECT ?s WHERE { ?s ?p ?o } LIMIT 0001 OFFSET 0002',
  },
];

async function typingsFor(queries = QUERIES) {
  const bundle = await buildExportBundle({
    library: { id: 'urn:sqlib:library:test', name: 'Test' },
    queries,
    generatedAt: '2026-08-25T00:00:00.000Z',
  });
  return generateBundleTypings(bundle, './queries.json');
}

describe('generateBundleTypings', () => {
  it('types the JSON through its file name rather than by augmenting it', async () => {
    // A module augmentation is how this used to end, and no consumer
    // configuration accepts one for a JSON path: TS2671 with
    // `resolveJsonModule` on, TS2436 with it off. What binds the declaration to
    // the bundle is the name tsc looks for beside it.
    const output = await typingsFor();
    expect(output).not.toContain('declare module');
    expect(output).toContain('declare const bundle: Bundle;');
    expect(output).toContain('export default bundle;');
    expect(output).toContain('export type Bundle = TypedExportBundle<QueryName>;');
  });

  it('exports the bundle fields, because a JSON default import is the namespace', async () => {
    const output = await typingsFor();
    expect(output).toContain("export declare const queries: Bundle['queries'];");
    expect(output).toContain("export declare const library: Bundle['library'];");
    expect(output).toContain("export declare const version: Bundle['version'];");
  });

  describe('bundleTypingsFileName', () => {
    it('re-spells the extension the way tsc resolves it', () => {
      expect(bundleTypingsFileName('./queries.json')).toBe('queries.d.json.ts');
      expect(bundleTypingsFileName('./data/library.json')).toBe('library.d.json.ts');
    });

    it('falls back to a plain declaration when there is no extension to re-spell', () => {
      expect(bundleTypingsFileName('./queries')).toBe('queries.d.ts');
    });

    it('is the name the generated header tells the consumer to keep', async () => {
      const output = await typingsFor();
      expect(output).toContain(`\`${bundleTypingsFileName('./queries.json')}\``);
      expect(output).toContain('"allowArbitraryExtensions": true');
    });
  });

  it('names every query, so a misspelling is a compile error', async () => {
    const output = await typingsFor();
    expect(output).toContain("'paged': {");
    expect(output).toContain("'people-by-city': {");
    expect(output).toContain('export type QueryName = keyof QueryCatalogue;');
  });

  it('spells out each query signature', async () => {
    const output = await typingsFor();
    expect(output).toContain("readonly inputs: readonly [readonly ['city']];");
    expect(output).toContain("readonly limits: '1';");
    expect(output).toContain("readonly offsets: '2';");
  });

  it('says never rather than nothing when a query takes no parameters', async () => {
    const output = await typingsFor([
      { name: 'All', queryString: 'SELECT * WHERE { ?s ?p ?o }' },
    ]);
    expect(output).toContain('readonly inputs: readonly [];');
    expect(output).toContain('readonly limits: never;');
  });

  it('carries the description into the doc comment', async () => {
    const output = await typingsFor();
    expect(output).toContain('Everyone in a city');
    expect(output).toContain('1. ?city');
  });

  it('cannot be closed early by a description containing a comment terminator', async () => {
    const output = await typingsFor([
      {
        name: 'Sneaky',
        queryString: 'SELECT * WHERE { ?s ?p ?o }',
        description: 'ends the comment */ export type Oops = 1;',
      },
    ]);
    expect(output).not.toContain('*/ export type Oops');
    expect(output).toContain('*\\/');
  });

  it('handles an empty bundle without emitting a broken union', async () => {
    const output = await typingsFor([]);
    expect(output).toContain('export type QueryName = never;');
  });
});
