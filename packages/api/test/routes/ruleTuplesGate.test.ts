/**
 * The deployment gate on the SRL rule-tuples extension.
 *
 * Two switches govern this feature and they answer different questions. A rule
 * set version's `tuplesEnabled` is the document's own setting, chosen by its
 * author. The `ruleTuples` feature flag is the deployment's, and it sits above
 * the toggle: with the flag off no request may turn the extension on, send seed
 * rows for it, or have a `TUPLE( … )` parsed.
 *
 * The rest of the suite runs with the flag on (see `test/setup-vitest.ts`),
 * because those specs test the extension. This file tests the gate, so it turns
 * the flag off and asserts every entry point refuses by name rather than
 * failing as a bare syntax error — a caller that is told "TUPLE is not valid
 * here" learns nothing about why.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import ruleSetRoutes from '../../src/routes/rule-sets.js';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';
import { overrideFeatureFlags, resetFeatureFlags, getFeatureFlags } from '../../src/config/featureFlags.js';
import { RULE_TUPLES_DISABLED_MESSAGE } from '../../src/lib/ruleTuples.js';

const hoisted = vi.hoisted(() => ({
  ruleSet: { get: vi.fn() },
  ruleSetVersion: { list: vi.fn(), get: vi.fn(), update: vi.fn() },
  ruleVersion: { get: vi.fn() },
  rule: { create: vi.fn() },
  dataBlock: { create: vi.fn() },
  dataBlockVersion: { get: vi.fn() },
  createRuleVersion: vi.fn(),
  createRuleSetVersion: vi.fn(),
  createDataBlockVersion: vi.fn(),
  mockExpand: vi.fn(),
}));

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getEntityRepositories: () => ({
    RuleSet: hoisted.ruleSet,
    RuleSetVersion: hoisted.ruleSetVersion,
    RuleVersion: hoisted.ruleVersion,
    Rule: hoisted.rule,
    DataBlock: hoisted.dataBlock,
    DataBlockVersion: hoisted.dataBlockVersion,
  }),
  getCacheCoordinator: () => ({ get: vi.fn() }),
}));
vi.mock('../../src/lib/RuleSetVersionResolver.js', () => ({ expandRuleSetVersion: hoisted.mockExpand }));
vi.mock('../../src/lib/RuleVersionWriter.js', () => ({ createRuleVersion: hoisted.createRuleVersion }));
vi.mock('../../src/lib/RuleSetVersionWriter.js', () => ({ createRuleSetVersion: hoisted.createRuleSetVersion }));
vi.mock('../../src/lib/DataBlockVersionWriter.js', () => ({
  createDataBlockVersion: hoisted.createDataBlockVersion,
}));

const RULESET_ID = 'urn:sqlib:ruleset:rs1';
const TUPLE_DOC = 'PREFIX ex: <http://example/>\nRULE { TUPLE(ex:r, ?a) } WHERE { ?a ex:p ex:o }';
const PLAIN_DOC = 'PREFIX ex: <http://example/>\nRULE { ?s ex:q ?o } WHERE { ?s ex:p ?o }';
const SEEDS = 'PREFIX ex: <http://example/>\nTUPLE(ex:r, ex:a)';

describe('the rule-tuples deployment gate', () => {
  let app: FastifyInstance;
  const registeredRoutes: Array<{ schema?: unknown }> = [];

  beforeAll(async () => {
    app = Fastify({ logger: false });
    app.addHook('onRoute', (route) => { registeredRoutes.push(route); });
    setupValidator(app);
    for (const schema of Object.values(schemas)) {
      if (schema && typeof schema === 'object' && '$id' in schema) app.addSchema(schema);
    }
    /*
     * Registered while the flag is off, which is also what a default
     * deployment does. Route schemas are built at registration, so this app is
     * the one whose documented surface should omit the extension's fields.
     */
    overrideFeatureFlags({ ruleTuples: false });
    await app.register(ruleSetRoutes, { prefix: '/rule-sets' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    resetFeatureFlags();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    overrideFeatureFlags({ ruleTuples: false });
    hoisted.ruleSet.get.mockReturnValue({
      $id: RULESET_ID,
      '@type': 'RuleSet',
      name: 'rs',
      currentVersion: `${RULESET_ID}:v1`,
    });
    hoisted.ruleSetVersion.get.mockReturnValue({
      $id: `${RULESET_ID}:v1`,
      '@type': 'RuleSetVersion',
      versionNumber: 1,
      hasRule: [],
      hasDataBlock: [],
    });
    hoisted.ruleSetVersion.list.mockReturnValue([]);
  });

  it('defaults to off, so a build that says nothing withholds the extension', () => {
    resetFeatureFlags({});
    expect(getFeatureFlags().ruleTuples).toBe(false);
    overrideFeatureFlags({ ruleTuples: false });
  });

  it('refuses a preview that asks for the extension, and names it', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/rule-sets/${encodeURIComponent(RULESET_ID)}/srl/preview`,
      payload: { srl: TUPLE_DOC, tuples: true },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe(RULE_TUPLES_DISABLED_MESSAGE);
  });

  it('refuses seed rows even when the extension switch is absent', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/rule-sets/${encodeURIComponent(RULESET_ID)}/srl/preview`,
      payload: { srl: PLAIN_DOC, tupleSeeds: SEEDS },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe(RULE_TUPLES_DISABLED_MESSAGE);
  });

  it('refuses an import that asks for the extension', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/rule-sets/${encodeURIComponent(RULESET_ID)}/srl`,
      payload: { srl: TUPLE_DOC, tuples: true },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe(RULE_TUPLES_DISABLED_MESSAGE);
    expect(hoisted.createRuleSetVersion).not.toHaveBeenCalled();
  });

  it('refuses a tuple seed input on execute', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/rule-sets/${encodeURIComponent(RULESET_ID)}/execute`,
      payload: { tuples: { inline: { head: { vars: [] }, results: { bindings: [] } } } },
    });
    /*
     * Refused by the body schema rather than by the handler, because the
     * execute body is the one that sets `additionalProperties: false` and the
     * field is no longer in its properties. The message is the validator's
     * rather than ours; what matters is that the run does not start.
     */
    expect(res.statusCode).toBe(400);
    expect(hoisted.mockExpand).not.toHaveBeenCalled();
  });

  it('refuses the document analyzer that asks for the extension', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/rule-sets/srl/analyze',
      payload: { srl: TUPLE_DOC, tuples: true },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe(RULE_TUPLES_DISABLED_MESSAGE);
  });

  it('treats TUPLE as a plain syntax error when nothing asked for the extension', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/rule-sets/srl/analyze',
      payload: { srl: TUPLE_DOC },
    });
    // Not a refusal: the request never claimed the extension, so the document
    // is read as conformant SRL and TUPLE( … ) is simply not in the grammar.
    expect(res.statusCode).toBe(200);
    expect(res.json().valid).toBe(false);
  });

  it('leaves a document that does not use the extension working', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/rule-sets/srl/analyze',
      payload: { srl: PLAIN_DOC },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().valid).toBe(true);
  });

  it('keeps the extension fields out of the documented request surface', () => {
    /*
     * The handlers refuse the fields regardless; stripping them from the body
     * schema is what stops /docs advertising a field that can only ever answer
     * 400. Read off the registered routes rather than a rendered spec, so the
     * assertion does not depend on swagger being registered here.
     */
    const seen: Array<Record<string, unknown>> = [];
    for (const route of registeredRoutes) {
      const body = (route.schema as { body?: { properties?: Record<string, unknown> } } | undefined)?.body;
      if (body?.properties) seen.push(body.properties);
    }
    expect(seen.length).toBeGreaterThan(0);
    for (const properties of seen) {
      expect(properties).not.toHaveProperty('tuples');
      expect(properties).not.toHaveProperty('tupleSeeds');
    }
  });
});
