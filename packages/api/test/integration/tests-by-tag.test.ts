/**
 * Seed the W3C suite, then run one of its tags through the real route.
 *
 * The unit tests either side of this one mock the half they are not about: the
 * route tests mock the store, the seeder test never builds a route. What is
 * left unproven between them is the thing the feature *is* — that the tags the
 * seeder writes are the tags a run selects by — so this wires the two together
 * over a real store and asserts it once.
 *
 * `worked-example` is the tag under test because it is small (five entries) and
 * every one of them evaluates, so a green run here is five rule sets actually
 * executed rather than five documents inspected.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import * as schemas from '@sparql-query-lib/contracts/schema';
import testRoutes from '../../src/routes/tests.js';
import { setupValidator } from '../../src/lib/validator-setup.js';
import { memoryCacheManager } from '../../src/lib/MemoryCacheManager.js';
import { oxigraphStoreManager } from '../../src/lib/OxigraphStoreManager.js';
import { overrideFeatureFlags, resetFeatureFlags } from '../../src/config/featureFlags.js';
import { seedW3cRulesSuite, tagIdFor, W3C_RULES_SUITE_LIBRARY_ID } from '../../src/lib/w3cRulesSuite/seed.js';
import { getEntityRepositories } from '../../src/lib/CacheCoordinatorProvider.js';

let app: FastifyInstance;
let tempDir: string;

beforeAll(async () => {
  process.env.CACHE_WRITE_THROUGH = 'false';
  process.env.CACHE_PRELOAD = 'false';
  // A third of the suite is deliberately unparseable and needs the override to
  // be stored at all — the same reason the harness sets it.
  overrideFeatureFlags({ rulesAllowInvalidSave: true });
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tests-by-tag-'));
  await oxigraphStoreManager.initialize(tempDir);
  await memoryCacheManager.loadAll();
  await seedW3cRulesSuite();

  app = Fastify({ logger: false });
  setupValidator(app);
  app.setErrorHandler((error, request, reply) => {
    reply.status(error.statusCode || 500).send({ error: error.message });
  });
  for (const schema of Object.values(schemas)) {
    if (schema && typeof schema === 'object' && '$id' in schema) app.addSchema(schema);
  }
  await app.register(testRoutes, { prefix: '/tests' });
  await app.ready();
}, 300_000);

afterAll(async () => {
  await app?.close();
  resetFeatureFlags();
  await oxigraphStoreManager.shutdown();
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
});

describe('running a seeded tag', () => {
  it('lists the tests a tag holds', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/tests?tags=${encodeURIComponent(tagIdFor('worked-example'))}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().map((test: { name: string }) => test.name).sort()).toEqual([
      'Example 1', 'Example 2', 'Example 3', 'Example 4', 'Example 5',
    ]);
  });

  it('intersects two tags, and unions them by default', async () => {
    const both = [tagIdFor('worked-example'), tagIdFor('stratification')];

    const any = await app.inject({ method: 'GET', url: `/tests?tags=${both.map(encodeURIComponent).join(',')}` });
    expect(any.json()).toHaveLength(15);

    // Nothing is both a worked example and a stratification check.
    const all = await app.inject({
      method: 'GET',
      url: `/tests?tags=${both.map(encodeURIComponent).join(',')}&match=all`,
    });
    expect(all.json()).toHaveLength(0);
  });

  it('runs the tag and reports a verdict for each of its tests', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tests/run',
      payload: { tags: [tagIdFor('worked-example')] },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.requested).toBe(5);
    expect(body.results).toHaveLength(5);
    expect(body.passed + body.failed).toBe(5);
    // Every verdict names the test it belongs to and the version it ran, which
    // is what lets a caller write them straight into a per-test map.
    for (const result of body.results) {
      expect(result.testId).toMatch(/^urn:sqlib:test:w3c-examples-/);
      expect(result.testVersionId).not.toBe('');
    }
  }, 60_000);
});

/**
 * The copy a new test starts with, over the real store rather than a mock.
 *
 * The route tests either side of this one stand a mock in for the entity cache,
 * and a mock is exactly where an assumption about the *shape* of a cached
 * entity's `tags` cannot fail. So this asserts the same rule against real
 * entities: tag a rule set, create a test against it, and the tag is on the
 * test — which is what makes a tag a suite that stays complete as tests are
 * added to it.
 *
 * A tag of its own rather than one the cases above count: those assert exactly
 * how many tests `worked-example` holds, and a suite that grows by one whenever
 * this file runs is a fixture that breaks its neighbours.
 */
describe('a new test starts with its subject’s tags', () => {
  const OWN_TAG = tagIdFor('inheritance-fixture');
  let ruleSetId: string;

  beforeAll(async () => {
    const repos = getEntityRepositories();

    await repos.Tag.create({
      $id: OWN_TAG,
      name: 'inheritance fixture',
      color: '#6f42c1',
      isPartOf: W3C_RULES_SUITE_LIBRARY_ID,
    } as never);

    const ruleSet = (repos.RuleSet.list() as Array<{ $id: string; isPartOf?: string[] }>)
      .find(candidate => candidate.isPartOf?.includes(W3C_RULES_SUITE_LIBRARY_ID));
    if (!ruleSet) throw new Error('the seeded suite has no rule set to tag');
    ruleSetId = ruleSet.$id;

    await repos.RuleSet.update(ruleSetId, { tags: [OWN_TAG] } as never);
  });

  it('carries the subject’s tag onto a test created without any', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tests',
      payload: {
        name: 'Inherits the rule set’s tag',
        subject: ruleSetId,
        subjectKind: 'ruleSet',
        isPartOf: [W3C_RULES_SUITE_LIBRARY_ID],
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().tags).toEqual([OWN_TAG]);

    // And the copy is real: the tag now selects the new test the same way it
    // would select one tagged by hand.
    const listed = await app.inject({ method: 'GET', url: `/tests?tags=${encodeURIComponent(OWN_TAG)}` });
    expect(listed.json().map((test: { name: string }) => test.name)).toContain('Inherits the rule set’s tag');
  });

  it('creates an untagged test when the caller says so', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tests',
      payload: {
        name: 'Declines the rule set’s tag',
        subject: ruleSetId,
        subjectKind: 'ruleSet',
        isPartOf: [W3C_RULES_SUITE_LIBRARY_ID],
        tags: [],
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().tags ?? []).toEqual([]);
  });
});
