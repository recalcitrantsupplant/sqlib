import { describe, expect, it } from 'vitest';
import { collectLibraryQueries, type LibraryQuerySource } from '../../../src/lib/export/collectLibraryQueries.js';
import type { LdkitQuery } from '../../../src/persistence/schemas/QuerySchema.js';
import type { LdkitQueryVersion } from '../../../src/persistence/schemas/QueryVersionSchema.js';

const LIBRARY = 'urn:sqlib:library:main';
const OTHER = 'urn:sqlib:library:other';

function query(partial: Partial<LdkitQuery> & { $id: string; name: string }): LdkitQuery {
  return { isPartOf: [LIBRARY], ...partial } as LdkitQuery;
}

function version(id: string, queryString: string): LdkitQueryVersion {
  return { $id: id, isPartOf: 'q', version: 1, queryString } as LdkitQueryVersion;
}

function source(
  queries: LdkitQuery[],
  versions: Record<string, LdkitQueryVersion>,
): LibraryQuerySource {
  return {
    listQueries: () => queries,
    getQueryVersion: (id) => versions[id] ?? null,
  };
}

describe('collectLibraryQueries', () => {
  it('resolves each query to its current version', () => {
    const result = collectLibraryQueries(
      source(
        [query({ $id: 'q1', name: 'People', currentVersion: 'v1' })],
        { v1: version('v1', 'SELECT * { ?s ?p ?o }') },
      ),
      LIBRARY,
    );

    expect(result.queries).toEqual([
      {
        name: 'People',
        queryString: 'SELECT * { ?s ?p ?o }',
        // The stable Query IRI travels with the text: it is how the export finds
        // the tests that become this query's examples.
        sourceQuery: 'q1',
        sourceVersion: 'v1',
      },
    ]);
    expect(result.skipped).toEqual([]);
  });

  it('ignores queries belonging to another library', () => {
    const result = collectLibraryQueries(
      source(
        [
          query({ $id: 'q1', name: 'Mine', currentVersion: 'v1' }),
          query({ $id: 'q2', name: 'Theirs', currentVersion: 'v1', isPartOf: [OTHER] }),
        ],
        { v1: version('v1', 'SELECT * { ?s ?p ?o }') },
      ),
      LIBRARY,
    );
    expect(result.queries.map((q) => q.name)).toEqual(['Mine']);
  });

  it('keeps a query that is also in a group, since isPartOf is a list', () => {
    const result = collectLibraryQueries(
      source(
        [
          query({
            $id: 'q1',
            name: 'Shared',
            currentVersion: 'v1',
            isPartOf: ['urn:sqlib:group:g', LIBRARY],
          }),
        ],
        { v1: version('v1', 'SELECT * { ?s ?p ?o }') },
      ),
      LIBRARY,
    );
    expect(result.queries.map((q) => q.name)).toEqual(['Shared']);
  });

  describe('tag filtering', () => {
    const tagged = () =>
      source(
        [
          query({ $id: 'q1', name: 'Both', currentVersion: 'v1', tags: ['t:a', 't:b'] }),
          query({ $id: 'q2', name: 'OnlyA', currentVersion: 'v1', tags: ['t:a'] }),
          query({ $id: 'q3', name: 'None', currentVersion: 'v1' }),
        ],
        { v1: version('v1', 'SELECT * { ?s ?p ?o }') },
      );

    it('keeps everything when no tags are given', () => {
      expect(collectLibraryQueries(tagged(), LIBRARY).queries.map((q) => q.name)).toEqual([
        'Both',
        'None',
        'OnlyA',
      ]);
    });

    it('matches any tag by default', () => {
      const result = collectLibraryQueries(tagged(), LIBRARY, { tags: ['t:b'] });
      expect(result.queries.map((q) => q.name)).toEqual(['Both']);
    });

    it('requires every tag under match: all', () => {
      const result = collectLibraryQueries(tagged(), LIBRARY, {
        tags: ['t:a', 't:b'],
        match: 'all',
      });
      expect(result.queries.map((q) => q.name)).toEqual(['Both']);
    });
  });

  describe('queries it cannot export are reported, never dropped silently', () => {
    it('reports a query with no current version', () => {
      const result = collectLibraryQueries(source([query({ $id: 'q1', name: 'Draft' })], {}), LIBRARY);
      expect(result.queries).toEqual([]);
      expect(result.skipped).toEqual([
        { id: 'q1', name: 'Draft', reason: 'The query has no current version.' },
      ]);
    });

    it('reports a dangling current version', () => {
      const result = collectLibraryQueries(
        source([query({ $id: 'q1', name: 'Broken', currentVersion: 'gone' })], {}),
        LIBRARY,
      );
      expect(result.skipped[0].reason).toMatch(/could not be found/);
    });

    it('reports a version with no query text', () => {
      const result = collectLibraryQueries(
        source([query({ $id: 'q1', name: 'Empty', currentVersion: 'v1' })], {
          v1: version('v1', ''),
        }),
        LIBRARY,
      );
      expect(result.skipped[0].reason).toMatch(/no query text/);
    });
  });

  it('orders output by name so an unchanged library re-exports byte-identically', () => {
    const result = collectLibraryQueries(
      source(
        [
          query({ $id: 'q1', name: 'Zebra', currentVersion: 'v1' }),
          query({ $id: 'q2', name: 'Alpha', currentVersion: 'v1' }),
        ],
        { v1: version('v1', 'SELECT * { ?s ?p ?o }') },
      ),
      LIBRARY,
    );
    expect(result.queries.map((q) => q.name)).toEqual(['Alpha', 'Zebra']);
  });
});
