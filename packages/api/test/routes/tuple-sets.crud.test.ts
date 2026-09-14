import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import tupleSetRoutes from '../../src/routes/tuple-sets.js';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';

const hoisted = vi.hoisted(() => ({
  tupleSet: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  tupleSetVersion: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  coordinatorGet: vi.fn(),
  mockCreateVersion: vi.fn(),
  mockUpdateVersion: vi.fn(),
}));

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getEntityRepositories: () => ({
    TupleSet: hoisted.tupleSet,
    TupleSetVersion: hoisted.tupleSetVersion,
  }),
  getCacheCoordinator: () => ({ get: hoisted.coordinatorGet }),
}));

vi.mock('../../src/lib/TupleSetVersionWriter.js', () => ({
  createTupleSetVersion: hoisted.mockCreateVersion,
  updateTupleSetVersion: hoisted.mockUpdateVersion,
  /*
   * Deliberately far below the real default (1 MiB).
   *
   * Fastify's own body limit is also 1 MiB, and the content string is a subset
   * of the body, so at stock settings the transport rejects an oversized
   * payload with 413 before the handler can look at it. The handler's own check
   * only ever fires where a deployment has lowered
   * TUPLE_SET_MAX_VERSION_BYTES — which is exactly the shape this stands in
   * for, and the only way to exercise the guard rather than the transport.
   */
  MAX_TUPLE_SET_VERSION_BYTES: 128,
}));

const LIBRARY_ID = 'urn:sqlib:library:lib1';
const OTHER_LIBRARY_ID = 'urn:sqlib:library:lib2';
const SET_ID = 'urn:sqlib:tuple-set:s1';

describe('TupleSets Routes (/tuple-sets)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    setupValidator(app);

    app.setErrorHandler((error, request, reply) => {
      const statusCode = error.statusCode || 500;
      if (error.validation && Array.isArray(error.validation)) {
        return reply.status(statusCode).send({ error: error.validation[0]?.message ?? 'Validation failed' });
      }
      reply.status(statusCode).send({ error: error.message || 'An unexpected error occurred' });
    });

    for (const schema of Object.values(schemas)) {
      if (schema && typeof schema === 'object' && '$id' in schema) {
        app.addSchema(schema);
      }
    }
    await app.register(tupleSetRoutes, { prefix: '/tuple-sets' });
    await app.ready();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.tupleSet.list.mockReturnValue([]);
    hoisted.tupleSetVersion.list.mockReturnValue([]);
    hoisted.coordinatorGet.mockImplementation((iri: string) => {
      if (iri === LIBRARY_ID) return { $id: LIBRARY_ID, '@type': 'Library', name: 'Lib' };
      if (iri === OTHER_LIBRARY_ID) return { $id: OTHER_LIBRARY_ID, '@type': 'Library', name: 'Other' };
      return null;
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a tuple set in a library', async () => {
    hoisted.tupleSet.create.mockImplementation(async (entity: Record<string, unknown>) => entity);

    const res = await app.inject({
      method: 'POST',
      url: '/tuple-sets',
      payload: { name: 'Cities', isPartOf: [LIBRARY_ID] },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ name: 'Cities', isPartOf: [LIBRARY_ID] });
    expect(res.json().id).toMatch(/^urn:sqlib:tuple-set:/);
  });

  it('rejects a tuple set whose parent is not a library', async () => {
    hoisted.coordinatorGet.mockImplementation((iri: string) =>
      iri === 'urn:sqlib:query:q1' ? { $id: 'urn:sqlib:query:q1', '@type': 'Query' } : null,
    );

    const res = await app.inject({
      method: 'POST',
      url: '/tuple-sets',
      payload: { name: 'Cities', isPartOf: ['urn:sqlib:query:q1'] },
    });

    expect(res.statusCode).toBe(400);
  });

  it('scopes the listing to a library when asked', async () => {
    hoisted.tupleSet.list.mockReturnValue([
      { $id: SET_ID, '@type': 'TupleSet', name: 'Cities', isPartOf: [LIBRARY_ID] },
      { $id: 'urn:sqlib:tuple-set:s2', '@type': 'TupleSet', name: 'Other', isPartOf: [OTHER_LIBRARY_ID] },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: `/tuple-sets?library=${encodeURIComponent(LIBRARY_ID)}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0].id).toBe(SET_ID);
  });

  it('creates a version through the writer and returns its computed facts', async () => {
    hoisted.tupleSet.get.mockReturnValue({ $id: SET_ID, '@type': 'TupleSet', name: 'Cities' });
    hoisted.mockCreateVersion.mockResolvedValue({
      $id: 'urn:sqlib:tuple-set-version:v1',
      '@type': 'TupleSetVersion',
      isPartOf: SET_ID,
      version: 1,
      contentString: '{"head":{"vars":["city"]},"results":{"bindings":[]}}',
      sourceFormat: 'csv',
      tupleColumns: ['city'],
      rowCount: 0,
      byteSize: 51,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/tuple-sets/${encodeURIComponent(SET_ID)}/versions`,
      payload: { contentString: 'city\nPerth\n', sourceFormat: 'csv' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ version: 1, sourceFormat: 'csv', tupleColumns: ['city'] });
  });

  it('forwards accepted column types to the writer', async () => {
    hoisted.tupleSet.get.mockReturnValue({ $id: SET_ID, '@type': 'TupleSet' });
    hoisted.mockCreateVersion.mockResolvedValue({
      $id: 'urn:sqlib:tuple-set-version:v1',
      '@type': 'TupleSetVersion',
      isPartOf: SET_ID,
      version: 1,
      contentString: '{"head":{"vars":["pop"]},"results":{"bindings":[]}}',
      sourceFormat: 'csv',
      tupleColumns: ['pop'],
      rowCount: 0,
      byteSize: 51,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/tuple-sets/${encodeURIComponent(SET_ID)}/versions`,
      payload: {
        contentString: 'pop\n2100000\n',
        sourceFormat: 'csv',
        columnTypes: { pop: 'xsd:integer' },
      },
    });

    expect(res.statusCode).toBe(201);
    expect(hoisted.mockCreateVersion).toHaveBeenCalledWith(
      SET_ID,
      expect.objectContaining({ columnTypes: { pop: 'xsd:integer' } }),
    );
  });

  it('requires sourceFormat rather than guessing it', async () => {
    // Plain TSV and SPARQL Results TSV share an extension and mean different
    // things; a default would type or un-type a dataset invisibly.
    hoisted.tupleSet.get.mockReturnValue({ $id: SET_ID, '@type': 'TupleSet' });

    const res = await app.inject({
      method: 'POST',
      url: `/tuple-sets/${encodeURIComponent(SET_ID)}/versions`,
      payload: { contentString: 'city\nPerth\n' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('reports a content error as a 400 with the parser message', async () => {
    hoisted.tupleSet.get.mockReturnValue({ $id: SET_ID, '@type': 'TupleSet' });
    const { TupleContentError } = await import('../../src/lib/tupleContent.js');
    hoisted.mockCreateVersion.mockRejectedValue(new TupleContentError('Blank node in column "s"'));

    const res = await app.inject({
      method: 'POST',
      url: `/tuple-sets/${encodeURIComponent(SET_ID)}/versions`,
      payload: { contentString: '?s\n_:b1', sourceFormat: 'sparql-results-tsv' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('Blank node');
  });

  it('repoints currentVersion when the version it named is deleted', async () => {
    const v1 = { $id: 'urn:sqlib:tuple-set-version:v1', isPartOf: SET_ID, version: 1, contentString: '{}' };
    const v2 = { $id: 'urn:sqlib:tuple-set-version:v2', isPartOf: SET_ID, version: 2, contentString: '{}' };
    hoisted.tupleSetVersion.list.mockReturnValueOnce([v1, v2]).mockReturnValue([v1]);
    hoisted.tupleSet.get.mockReturnValue({
      $id: SET_ID,
      '@type': 'TupleSet',
      currentVersion: v2.$id,
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/tuple-sets/${encodeURIComponent(SET_ID)}/versions/2`,
    });

    expect(res.statusCode).toBe(204);
    expect(hoisted.tupleSetVersion.delete).toHaveBeenCalledWith(v2.$id);
    // Falls back to the highest remaining version rather than dangling.
    expect(hoisted.tupleSet.update).toHaveBeenCalledWith(SET_ID, { currentVersion: v1.$id });
  });

  it('deletes a frozen version, because freezing is about content and not existence', async () => {
    // This used to refuse. Every version is frozen on create now (issue #192),
    // so refusing here would mean no tuple set version could ever be deleted —
    // and pruning unreferenced versions is the same decision's answer to
    // version growth, not a way around immutability.
    const v1 = {
      $id: 'urn:sqlib:tuple-set-version:v1',
      isPartOf: SET_ID,
      version: 1,
      contentString: '{}',
      immutable: true,
    };
    hoisted.tupleSetVersion.list.mockReturnValue([v1]);

    const res = await app.inject({
      method: 'DELETE',
      url: `/tuple-sets/${encodeURIComponent(SET_ID)}/versions/1`,
    });

    expect(res.statusCode).toBe(204);
    expect(hoisted.tupleSetVersion.delete).toHaveBeenCalledWith(v1.$id);
  });

  it('cascades version deletion when the set is deleted', async () => {
    hoisted.tupleSet.get.mockReturnValue({ $id: SET_ID, '@type': 'TupleSet' });
    hoisted.tupleSetVersion.list.mockReturnValue([
      { $id: 'urn:sqlib:tuple-set-version:v1', isPartOf: SET_ID, version: 1, contentString: '{}' },
    ]);

    const res = await app.inject({
      method: 'DELETE',
      url: `/tuple-sets/${encodeURIComponent(SET_ID)}`,
    });

    expect(res.statusCode).toBe(204);
    expect(hoisted.tupleSetVersion.delete).toHaveBeenCalledWith('urn:sqlib:tuple-set-version:v1');
    expect(hoisted.tupleSet.delete).toHaveBeenCalledWith(SET_ID);
  });

  describe('POST /detect-format', () => {
    it.each([
      ['{"head":{"vars":["a"]}}', 'sparql-results-json'],
      ['?a\t?b\n<http://ex/x>\t1', 'sparql-results-tsv'],
      ['a\tb\n1\t2', 'tsv'],
      ['a,b\n1,2', 'csv'],
    ])('suggests %s → %s', async (contentString, suggested) => {
      const res = await app.inject({
        method: 'POST',
        url: '/tuple-sets/detect-format',
        payload: { contentString },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().suggested).toBe(suggested);
    });
  });

  /*
   * The parse a save would do, stopping before the write.
   *
   * It exists so the browser never needs its own parser: the editor previews
   * unsaved rows and converts pasted text into its row builder through this,
   * which is what keeps one interpretation of a cell in one place.
   */
  describe('POST /preview', () => {
    const post = (payload: unknown) =>
      app.inject({ method: 'POST', url: '/tuple-sets/preview', payload });

    it('normalises CSV into SPARQL Results JSON without storing anything', async () => {
      const res = await post({ contentString: 'city,population\nParis,2161000', sourceFormat: 'csv' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.tupleColumns).toEqual(['city', 'population']);
      expect(body.rowCount).toBe(1);
      expect(JSON.parse(body.contentString)).toEqual({
        head: { vars: ['city', 'population'] },
        results: {
          bindings: [{
            city: { type: 'literal', value: 'Paris' },
            population: { type: 'literal', value: '2161000' },
          }],
        },
      });
      // Nothing was written — that is the whole point of the route.
      expect(hoisted.mockCreateVersion).not.toHaveBeenCalled();
      expect(hoisted.tupleSetVersion.create).not.toHaveBeenCalled();
    });

    it('reads SPARQL Results TSV as typed terms, unlike plain TSV', async () => {
      const content = '?city\t?population\n<http://ex/Paris>\t2161000';

      const typed = await post({ contentString: content, sourceFormat: 'sparql-results-tsv' });
      expect(typed.json().contentString).toContain('"type":"uri"');

      const plain = await post({ contentString: content, sourceFormat: 'tsv' });
      // Same bytes, different dataset — which is why the format is stated and
      // never guessed.
      expect(plain.json().contentString).not.toContain('"type":"uri"');
    });

    it('reports the parse error a save would have returned', async () => {
      const res = await post({ contentString: 'a,b\n1,2,3', sourceFormat: 'csv' });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('expected 2');
    });

    it('refuses a blank node, naming the column and line', async () => {
      const res = await post({
        contentString: '?city\n_:b0',
        sourceFormat: 'sparql-results-tsv',
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('Blank node');
    });

    it('requires the source format rather than defaulting one', async () => {
      const res = await post({ contentString: 'a,b\n1,2' });
      expect(res.statusCode).toBe(400);
    });

    it('refuses content over the per-version byte cap', async () => {
      const res = await post({
        contentString: `a\n${'x'.repeat(200)}`,
        sourceFormat: 'csv',
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('limit');
    });

    // Issue #208: scan a column at import, propose a type, let the author
    // accept or reject per column, persist the outcome.
    describe('column-type suggestions', () => {
      it('proposes a type for a column that is entirely one shape', async () => {
        const res = await post({ contentString: 'city,pop\nPerth,2100000', sourceFormat: 'csv' });

        expect(res.statusCode).toBe(200);
        expect(res.json().columnTypeSuggestions).toEqual([{ column: 'pop', suggested: 'xsd:integer' }]);
        // Nothing is applied unless the caller accepts it.
        expect(JSON.parse(res.json().contentString).results.bindings[0].pop).toEqual({
          type: 'literal',
          value: '2100000',
        });
      });

      it('applies an accepted column type to the previewed outcome', async () => {
        const res = await post({
          contentString: 'city,pop\nPerth,2100000',
          sourceFormat: 'csv',
          columnTypes: { pop: 'xsd:integer' },
        });

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.json().contentString).results.bindings[0].pop).toEqual({
          type: 'literal',
          value: '2100000',
          datatype: 'http://www.w3.org/2001/XMLSchema#integer',
        });
        // The suggestion is still reported even once accepted, so the UI does
        // not read acceptance as the suggestion disappearing.
        expect(res.json().columnTypeSuggestions).toEqual([{ column: 'pop', suggested: 'xsd:integer' }]);
      });

      it('reports a rejected accepted-type as a 400 naming the offending cell', async () => {
        const res = await post({
          contentString: 'n\n42\nnope',
          sourceFormat: 'csv',
          columnTypes: { n: 'xsd:integer' },
        });

        expect(res.statusCode).toBe(400);
        expect(res.json().error).toContain('row 2');
      });
    });
  });
});
