import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import ruleSetRoutes from '../../src/routes/rule-sets.js';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';

const hoisted = vi.hoisted(() => ({
  ruleSet: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  ruleSetVersion: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  ruleVersion: {
    get: vi.fn(),
  },
  coordinatorGet: vi.fn(),
  mockCreateVersion: vi.fn(),
  mockExpand: vi.fn(),
}));

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getEntityRepositories: () => ({
    RuleSet: hoisted.ruleSet,
    RuleSetVersion: hoisted.ruleSetVersion,
    RuleVersion: hoisted.ruleVersion,
  }),
  getCacheCoordinator: () => ({
    get: hoisted.coordinatorGet,
  }),
}));

vi.mock('../../src/lib/RuleSetVersionWriter.js', () => ({
  createRuleSetVersion: hoisted.mockCreateVersion,
}));

vi.mock('../../src/lib/RuleSetVersionResolver.js', () => ({
  expandRuleSetVersion: hoisted.mockExpand,
}));

describe('RuleSets Routes (/rule-sets) - CRUD', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    setupValidator(app);

    app.setErrorHandler((error, request, reply) => {
      const statusCode = error.statusCode || 500;
      if (error.validation && Array.isArray(error.validation)) {
        const validationErrors = error.validation.map((err: any) => {
          if (err.keyword === 'required') {
            return `${err.params?.missingProperty || 'Field'} is required`;
          }
          return err.message || 'Validation error';
        });
        const errorMessage = validationErrors.length > 0 ? validationErrors[0] : 'Validation failed';
        return reply.status(statusCode).send({ error: errorMessage });
      }
      reply.status(statusCode).send({ error: error.message || 'An unexpected error occurred' });
    });

    for (const schema of Object.values(schemas)) {
      if (schema && typeof schema === 'object' && '$id' in schema) {
        app.addSchema(schema);
      }
    }
    await app.register(ruleSetRoutes, { prefix: '/rule-sets' });
    await app.ready();
  });

  beforeEach(() => vi.clearAllMocks());

  afterAll(async () => { await app.close(); });

  it('POST /rule-sets creates stable RuleSet', async () => {
    const libraryId = 'urn:sqlib:library:lib1';
    const library = { $id: libraryId, name: 'Test Library', '@type': 'Library' };
    const created = { $id: 'urn:sqlib:rule-set:abc', name: 'RS', isPartOf: [libraryId] };
    
    hoisted.coordinatorGet.mockReturnValue(library);
    hoisted.ruleSet.create.mockResolvedValue(created);
    
    const res = await app.inject({ 
      method: 'POST', 
      url: '/rule-sets', 
      payload: { name: 'RS', isPartOf: libraryId } 
    });
    
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ id: created.$id, name: 'RS', isPartOf: [libraryId] });
  });

  it('GET /rule-sets/:id returns RuleSet', async () => {
    const ruleSet = { $id: 'urn:sqlib:rule-set:abc', name: 'RS', isPartOf: ['urn:sqlib:library:lib1'] };
    hoisted.ruleSet.get.mockReturnValue(ruleSet);
    const res = await app.inject({ method: 'GET', url: `/rule-sets/${encodeURIComponent(ruleSet.$id)}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: ruleSet.$id, name: 'RS' });
  });

  it('PUT /rule-sets/:id updates metadata', async () => {
    const id = 'urn:sqlib:rule-set:abc';
    const currentRuleSet = { $id: id, '@type': 'RuleSet', name: 'RS', isPartOf: ['urn:sqlib:library:lib1'], dateModified: '2024-01-01T00:00:00.000Z' };
    const updated = { $id: id, name: 'RS2', isPartOf: ['urn:sqlib:library:lib1'], '@type': 'RuleSet', dateModified: '2024-01-02T00:00:00.000Z' };
    hoisted.ruleSet.get.mockImplementation((lookupId: string) => (lookupId === id ? currentRuleSet : null));
    hoisted.ruleSet.update.mockResolvedValue(updated);
    const res = await app.inject({
      method: 'PUT',
      url: `/rule-sets/${encodeURIComponent(id)}`,
      payload: { name: 'RS2' },
      headers: { 'if-match': currentRuleSet.dateModified },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id, name: 'RS2' });
    expect(res.headers.etag).toBe('"2024-01-02T00:00:00.000Z"');
    expect(res.headers['last-modified']).toBe('Tue, 02 Jan 2024 00:00:00 GMT');
  });

  it('PUT /rule-sets/:id rejects mismatched ETag', async () => {
    const id = 'urn:sqlib:rule-set:abc';
    const currentRuleSet = { $id: id, '@type': 'RuleSet', name: 'RS', isPartOf: ['urn:sqlib:library:lib1'], dateModified: '2024-01-01T00:00:00.000Z' };
    hoisted.ruleSet.get.mockReturnValue(currentRuleSet);

    const res = await app.inject({
      method: 'PUT',
      url: `/rule-sets/${encodeURIComponent(id)}`,
      payload: { name: 'RS2' },
      headers: { 'if-match': '"outdated-tag"' },
    });

    expect(res.statusCode).toBe(412);
    expect(res.json()).toMatchObject({
      error: 'Precondition Failed',
      expected: '2024-01-01T00:00:00.000Z',
    });
  });

  it('POST /rule-sets requires non-empty name', async () => {
    const libraryId = 'urn:sqlib:library:lib1';
    hoisted.coordinatorGet.mockReturnValue({ $id: libraryId, '@type': 'Library' });

    const res = await app.inject({
      method: 'POST',
      url: '/rule-sets',
      payload: { name: '   ', isPartOf: libraryId },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Rule set name is required' });
  });

  /**
   * Until Phase B2 this route registered no schema at all, so the body reached
   * the handler however it arrived and only `name`/`isPartOf` were looked at.
   * These assert the gate, and that the handler guard behind it still owns the
   * cases the document admits — a whitespace-only name is the one above.
   */
  describe('POST /rule-sets body validation', () => {
    it('rejects a missing name at the schema, before the handler', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/rule-sets',
        payload: { isPartOf: 'urn:sqlib:library:lib1' },
      });

      expect(res.statusCode).toBe(400);
      expect(hoisted.ruleSet.create).not.toHaveBeenCalled();
    });

    it('rejects a property no predicate stores', async () => {
      hoisted.coordinatorGet.mockReturnValue({ $id: 'urn:sqlib:library:lib1', '@type': 'Library' });

      const res = await app.inject({
        method: 'POST',
        url: '/rule-sets',
        payload: { name: 'RS', isPartOf: 'urn:sqlib:library:lib1', comment: 'nothing stores this' },
      });

      expect(res.statusCode).toBe(400);
      expect(hoisted.ruleSet.create).not.toHaveBeenCalled();
    });

    it('rejects an isPartOf entry that is not an IRI', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/rule-sets',
        payload: { name: 'RS', isPartOf: ['not an iri'] },
      });

      expect(res.statusCode).toBe(400);
      expect(hoisted.ruleSet.create).not.toHaveBeenCalled();
    });
  });

  it('POST /rule-sets validates referenced entities exist', async () => {
    const libraryId = 'urn:sqlib:library:lib1';
    hoisted.coordinatorGet.mockImplementation((iri: string) => {
      if (iri === libraryId) return { $id: libraryId, '@type': 'Library' };
      return null;
    });

    const res = await app.inject({
      method: 'POST',
      url: '/rule-sets',
      payload: { name: 'RS', isPartOf: [libraryId, 'urn:sqlib:rule:missing'] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Referenced entity urn:sqlib:rule:missing does not exist' });
  });

  it('DELETE /rule-sets/:id deletes RuleSet without versions', async () => {
    hoisted.ruleSet.get.mockReturnValue({ $id: 'urn:sqlib:rule-set:abc', name: 'RS', isPartOf: ['urn:sqlib:library:lib1'] });
    hoisted.ruleSetVersion.list.mockReturnValue([]);
    hoisted.ruleSet.delete.mockResolvedValue(undefined);
    const id = 'urn:sqlib:rule-set:abc';
    const res = await app.inject({ method: 'DELETE', url: `/rule-sets/${encodeURIComponent(id)}` });
    expect(res.statusCode).toBe(204);
    expect(hoisted.ruleSet.delete).toHaveBeenCalledWith(id);
  });

  it('DELETE /rule-sets/:id cascades to delete all versions', async () => {
    const id = 'urn:sqlib:rule-set:abc';
    const version1 = { $id: 'urn:sqlib:rule-set-version:1', isPartOf: id, version: 1 };
    const version2 = { $id: 'urn:sqlib:rule-set-version:2', isPartOf: id, version: 2 };

    hoisted.ruleSet.get.mockReturnValue({ $id: id, name: 'RS', isPartOf: ['urn:sqlib:library:lib1'] });
    hoisted.ruleSetVersion.list.mockReturnValue([version1, version2]);
    hoisted.ruleSetVersion.delete.mockResolvedValue(undefined);
    hoisted.ruleSet.delete.mockResolvedValue(undefined);

    const res = await app.inject({ method: 'DELETE', url: `/rule-sets/${encodeURIComponent(id)}` });

    expect(res.statusCode).toBe(204);
    expect(hoisted.ruleSetVersion.delete).toHaveBeenCalledTimes(2);
    expect(hoisted.ruleSetVersion.delete).toHaveBeenCalledWith(version1.$id);
    expect(hoisted.ruleSetVersion.delete).toHaveBeenCalledWith(version2.$id);
    expect(hoisted.ruleSet.delete).toHaveBeenCalledWith(id);
  });

  it('POST /rule-sets/:id/versions creates new version', async () => {
    const id = 'urn:sqlib:rule-set:abc';
    const parent = { $id: id, '@type': 'RuleSet', name: 'RS' };
    const createdVersion = {
      $id: 'urn:sqlib:rule-set-version:1',
      '@type': 'RuleSetVersion',
      isPartOf: id,
      version: 1,
      comment: 'Initial',
      hasRule: ['urn:sqlib:rule:1'],
      hasDataBlock: ['urn:sqlib:data-block:1'],
      dateModified: '2024-01-04T00:00:00.000Z',
    };

    hoisted.ruleSet.get.mockReturnValue(parent);
    hoisted.mockCreateVersion.mockResolvedValue(createdVersion);
    hoisted.mockExpand.mockResolvedValue({
      ruleSetVersion: {
        id: createdVersion.$id,
        isPartOf: id,
        version: 1,
        comment: 'Initial',
        hasRule: ['urn:sqlib:rule:1'],
        hasDataBlock: ['urn:sqlib:data-block:1'],
        dateModified: '2024-01-04T00:00:00.000Z',
      },
      rules: [],
      dataBlocks: [],
    });

    const res = await app.inject({
      method: 'POST',
      url: `/rule-sets/${encodeURIComponent(id)}/versions`,
      payload: {
        comment: 'Initial',
        hasRule: ['urn:sqlib:rule:1'],
        hasDataBlock: ['urn:sqlib:data-block:1'],
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      ruleSetVersion: {
        id: createdVersion.$id,
        isPartOf: id,
        version: 1,
        comment: 'Initial',
        hasRule: ['urn:sqlib:rule:1'],
        hasDataBlock: ['urn:sqlib:data-block:1'],
        dateModified: '2024-01-04T00:00:00.000Z',
      },
      rules: [],
      dataBlocks: [],
    });
    expect(res.headers.etag).toBe('"2024-01-04T00:00:00.000Z"');
    expect(res.headers['last-modified']).toBe('Thu, 04 Jan 2024 00:00:00 GMT');
    expect(hoisted.mockCreateVersion).toHaveBeenCalledWith(id, {
      comment: 'Initial',
      hasRule: ['urn:sqlib:rule:1'],
      hasDataBlock: ['urn:sqlib:data-block:1'],
    });
  });

  it('POST /rule-sets/:id/versions forwards immutable flag', async () => {
    const id = 'urn:sqlib:rule-set:abc';
    hoisted.ruleSet.get.mockReturnValue({ $id: id, '@type': 'RuleSet' });
    hoisted.mockCreateVersion.mockResolvedValue({
      $id: 'urn:sqlib:rule-set-version:1',
      '@type': 'RuleSetVersion',
      isPartOf: id,
      version: 1,
      immutable: true,
    });
    hoisted.mockExpand.mockResolvedValue({
      ruleSetVersion: {
        id: 'urn:sqlib:rule-set-version:1',
        isPartOf: id,
        version: 1,
        immutable: true,
      },
      rules: [],
      dataBlocks: [],
    });

    const res = await app.inject({
      method: 'POST',
      url: `/rule-sets/${encodeURIComponent(id)}/versions`,
      payload: { immutable: true },
    });

    expect(res.statusCode).toBe(201);
    expect(hoisted.mockCreateVersion).toHaveBeenCalledWith(id, expect.objectContaining({ immutable: true }));
  });

  it('POST /rule-sets/:id/versions defaults optional arrays', async () => {
    const id = 'urn:sqlib:rule-set:abc';
    hoisted.ruleSet.get.mockReturnValue({ $id: id, '@type': 'RuleSet' });
    hoisted.mockCreateVersion.mockResolvedValue({
      $id: 'urn:sqlib:rule-set-version:2',
      '@type': 'RuleSetVersion',
      isPartOf: id,
      version: 2,
      comment: null,
      hasRule: [],
      hasDataBlock: [],
      dateModified: '2024-01-05T00:00:00.000Z',
    });
    hoisted.mockExpand.mockResolvedValue({
      ruleSetVersion: {
        id: 'urn:sqlib:rule-set-version:2',
        isPartOf: id,
        version: 2,
        hasRule: [],
        hasDataBlock: [],
      },
      rules: [],
      dataBlocks: [],
    });

    const res = await app.inject({
      method: 'POST',
      url: `/rule-sets/${encodeURIComponent(id)}/versions`,
      payload: {},
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      ruleSetVersion: {
        id: 'urn:sqlib:rule-set-version:2',
        hasRule: [],
        hasDataBlock: [],
      },
      rules: [],
      dataBlocks: [],
    });
    expect(hoisted.mockCreateVersion).toHaveBeenCalledWith(id, {
      comment: null,
      hasRule: [],
      hasDataBlock: [],
    });
  });

  it('POST /rule-sets/:id/versions returns 404 when parent missing', async () => {
    hoisted.ruleSet.get.mockReturnValue(null);

    const res = await app.inject({
      method: 'POST',
      url: '/rule-sets/urn%3Asqlib%3Arule-set%3Amissing/versions',
      payload: {},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Rule set not found' });
    expect(hoisted.mockCreateVersion).not.toHaveBeenCalled();
  });

  it('PATCH /rule-sets/:id/versions/:version refuses to recompose a version', async () => {
    // A version is a snapshot (issue #192): `hasRule` and `hasDataBlock` are
    // what the set was composed of, so the stratification report computed from
    // them stays true. Only the comment is writable.
    const id = 'urn:sqlib:rule-set:abc';
    const parent = { $id: id, '@type': 'RuleSet' };
    const existingVersion = { $id: 'urn:sqlib:rule-set-version:1', '@type': 'RuleSetVersion', isPartOf: id, version: 1, immutable: true, dateModified: '2024-01-04T00:00:00.000Z' };
    hoisted.ruleSet.get.mockReturnValue(parent);
    hoisted.ruleSetVersion.list.mockReturnValue([existingVersion]);

    const res = await app.inject({
      method: 'PATCH',
      url: `/rule-sets/${encodeURIComponent(id)}/versions/1`,
      payload: { hasRule: ['urn:sqlib:rule-version:9'] },
      headers: { 'if-match': existingVersion.dateModified },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().fields).toEqual(['hasRule']);
    expect(hoisted.ruleSetVersion.update).not.toHaveBeenCalled();
  });

  it('PATCH /rule-sets/:id/versions/:version annotates a frozen version', async () => {
    const id = 'urn:sqlib:rule-set:abc';
    const parent = { $id: id, '@type': 'RuleSet' };
    const existingVersion = { $id: 'urn:sqlib:rule-set-version:1', '@type': 'RuleSetVersion', isPartOf: id, version: 1, immutable: true, dateModified: '2024-01-04T00:00:00.000Z' };
    hoisted.ruleSet.get.mockReturnValue(parent);
    hoisted.ruleSetVersion.list.mockReturnValue([existingVersion]);
    hoisted.ruleSetVersion.update.mockResolvedValue({ ...existingVersion, comment: 'the one that stratified' });

    const res = await app.inject({
      method: 'PATCH',
      url: `/rule-sets/${encodeURIComponent(id)}/versions/1`,
      payload: { comment: 'the one that stratified' },
      headers: { 'if-match': existingVersion.dateModified },
    });

    expect(res.statusCode, res.payload).toBe(200);
    expect(hoisted.ruleSetVersion.update).toHaveBeenCalledWith('urn:sqlib:rule-set-version:1', {
      comment: 'the one that stratified',
    });
  });
});
