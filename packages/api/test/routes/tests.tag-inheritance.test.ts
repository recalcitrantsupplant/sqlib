/**
 * A new test starts with the tags of the thing it tests.
 *
 * The rule lives on the server rather than in the client, because a test is
 * created from four places in the UI, from the REST API and through MCP — a
 * default only some callers apply is not a default. These cases are therefore the whole feature: the UI's
 * checkbox is nothing but a chooser between the two bodies exercised here, one
 * that omits `tags` and one that sends `[]`.
 *
 * The distinction those two bodies draw is the thing most worth pinning. Silent
 * and empty are different requests, and if `[]` ever starts seeding there is no
 * way left to say "no tags" at all.
 */
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import testRoutes from '../../src/routes/tests.js';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';

const hoisted = vi.hoisted(() => ({
  test: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  testVersion: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  testCase: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  coordinatorGet: vi.fn(),
  createVersion: vi.fn(),
  updateVersion: vi.fn(),
  runTestVersion: vi.fn(),
}));

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getEntityRepositories: () => ({ Test: hoisted.test, TestVersion: hoisted.testVersion, TestCase: hoisted.testCase }),
  getCacheCoordinator: () => ({ get: hoisted.coordinatorGet }),
}));

vi.mock('../../src/lib/TestVersionWriter.js', () => ({
  createTestVersion: hoisted.createVersion,
  updateTestVersion: hoisted.updateVersion,
  TestVersionError: class TestVersionError extends Error {},
}));

vi.mock('../../src/lib/TestRunner.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/TestRunner.js')>();
  return {
    ...actual,
    TestRunner: class {
      runTestVersion = hoisted.runTestVersion;
    },
  };
});

const LIBRARY_ID = 'urn:sqlib:library:lib1';
const OTHER_LIBRARY_ID = 'urn:sqlib:library:lib2';
const RULE_SET_ID = 'urn:sqlib:ruleset:rs1';
const QUERY_ID = 'urn:sqlib:query:q1';

const W3C = 'urn:sqlib:tag:w3c';
const NEGATION = 'urn:sqlib:tag:negation';
/** A tag of the *other* library, which the subject somehow still carries. */
const FOREIGN = 'urn:sqlib:tag:foreign';
/** An IRI in the subject's `tags` that resolves to nothing. */
const DANGLING = 'urn:sqlib:tag:gone';

/** What `POST /tests` was asked to persist, tags included. */
function createdEntity(): Record<string, unknown> {
  expect(hoisted.test.create).toHaveBeenCalledTimes(1);
  return hoisted.test.create.mock.calls[0][0] as Record<string, unknown>;
}

describe('A new test inherits its subject’s tags (POST /tests)', () => {
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
    await app.register(testRoutes, { prefix: '/tests' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.test.create.mockImplementation(async (entity: Record<string, unknown>) => entity);
    hoisted.testCase.list.mockReturnValue([]);
    hoisted.coordinatorGet.mockImplementation((iri: string) => {
      switch (iri) {
        case LIBRARY_ID: return { $id: LIBRARY_ID, '@type': 'Library', name: 'Lib' };
        case OTHER_LIBRARY_ID: return { $id: OTHER_LIBRARY_ID, '@type': 'Library', name: 'Other' };
        case RULE_SET_ID: return {
          $id: RULE_SET_ID, '@type': 'RuleSet', name: 'RS', isPartOf: [LIBRARY_ID], tags: [W3C, NEGATION],
        };
        case QUERY_ID: return {
          $id: QUERY_ID, '@type': 'Query', name: 'Q', isPartOf: [LIBRARY_ID], tags: [],
        };
        case W3C: return { $id: W3C, '@type': 'Tag', name: 'w3c', isPartOf: LIBRARY_ID };
        case NEGATION: return { $id: NEGATION, '@type': 'Tag', name: 'negation', isPartOf: LIBRARY_ID };
        case FOREIGN: return { $id: FOREIGN, '@type': 'Tag', name: 'foreign', isPartOf: OTHER_LIBRARY_ID };
        default: return null;
      }
    });
  });

  async function create(payload: Record<string, unknown>) {
    return app.inject({
      method: 'POST',
      url: '/tests',
      payload: { name: 'Reaches b', subject: RULE_SET_ID, subjectKind: 'ruleSet', isPartOf: [LIBRARY_ID], ...payload },
    });
  }

  it('copies the subject’s tags when the body says nothing about tags', async () => {
    const res = await create({});

    expect(res.statusCode).toBe(201);
    expect(res.json().tags).toEqual([W3C, NEGATION]);
    expect(createdEntity().tags).toEqual([W3C, NEGATION]);
  });

  it('treats an explicit empty array as “no tags”, not as a request to seed', async () => {
    const res = await create({ tags: [] });

    expect(res.statusCode).toBe(201);
    expect(createdEntity().tags).toEqual([]);
  });

  it('honours the tags a caller does name, without adding the subject’s', async () => {
    const res = await create({ tags: [NEGATION] });

    expect(res.statusCode).toBe(201);
    expect(createdEntity().tags).toEqual([NEGATION]);
  });

  it('seeds nothing from a subject that carries no tags', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tests',
      payload: { name: 'Runs', subject: QUERY_ID, subjectKind: 'query', isPartOf: [LIBRARY_ID] },
    });

    expect(res.statusCode).toBe(201);
    expect(createdEntity().tags ?? []).toEqual([]);
  });

  /**
   * The one case that would otherwise 400 on tags nobody asked for: the test is
   * being created in a library the subject does not belong to, which the "make
   * a test from this" buttons do whenever the subject names no library of its
   * own. §4.5 forbids applying another library's tag, so the seed is filtered
   * rather than the write refused.
   */
  it('drops tags belonging to a library other than the test’s', async () => {
    hoisted.coordinatorGet.mockImplementation((iri: string) => {
      if (iri === OTHER_LIBRARY_ID) return { $id: OTHER_LIBRARY_ID, '@type': 'Library', name: 'Other' };
      if (iri === LIBRARY_ID) return { $id: LIBRARY_ID, '@type': 'Library', name: 'Lib' };
      if (iri === RULE_SET_ID) return {
        $id: RULE_SET_ID, '@type': 'RuleSet', name: 'RS', isPartOf: [OTHER_LIBRARY_ID], tags: [FOREIGN],
      };
      if (iri === FOREIGN) return { $id: FOREIGN, '@type': 'Tag', name: 'foreign', isPartOf: OTHER_LIBRARY_ID };
      return null;
    });

    const res = await create({});

    expect(res.statusCode).toBe(201);
    expect(createdEntity().tags ?? []).toEqual([]);
  });

  it('drops a tag IRI the subject carries that no longer resolves', async () => {
    hoisted.coordinatorGet.mockImplementation((iri: string) => {
      if (iri === LIBRARY_ID) return { $id: LIBRARY_ID, '@type': 'Library', name: 'Lib' };
      if (iri === RULE_SET_ID) return {
        $id: RULE_SET_ID, '@type': 'RuleSet', name: 'RS', isPartOf: [LIBRARY_ID], tags: [W3C, DANGLING],
      };
      if (iri === W3C) return { $id: W3C, '@type': 'Tag', name: 'w3c', isPartOf: LIBRARY_ID };
      return null;
    });

    const res = await create({});

    expect(res.statusCode).toBe(201);
    expect(createdEntity().tags).toEqual([W3C]);
  });

  it('still refuses a tag the caller names that belongs to another library', async () => {
    const res = await create({ tags: [FOREIGN] });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/different library/);
    expect(hoisted.test.create).not.toHaveBeenCalled();
  });
});
