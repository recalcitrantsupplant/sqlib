/**
 * Stratification regressions, pinned on the path that computes it.
 *
 * A rule set version is composed once, when it is created: `hasRule` is part of
 * the snapshot, so the stratification report derived from it stays true for the
 * life of the version (issue #192). This case used to run through PATCH, which
 * no longer recomposes anything — the rule body that once crashed the
 * stratifier is now met on create.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import ruleSetRoutes from '../../src/routes/rule-sets.js';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';

const RULE_SET_ID = 'urn:sqlib:rule-set:empty';
const RULE_VERSION_ID = 'urn:sqlib:rule-version:empty';

const hoisted = vi.hoisted(() => ({
  ruleSet: { get: vi.fn() },
  ruleSetVersion: {
    list: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
  },
  ruleVersion: {
    get: vi.fn(),
  },
  coordinator: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  mockExpand: vi.fn(),
}));

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getEntityRepositories: () => ({
    RuleSet: hoisted.ruleSet,
    RuleSetVersion: hoisted.ruleSetVersion,
    RuleVersion: hoisted.ruleVersion,
  }),
  getCacheCoordinator: () => hoisted.coordinator,
}));

vi.mock('../../src/lib/RuleSetVersionResolver.js', () => ({
  expandRuleSetVersion: hoisted.mockExpand,
}));

describe('RuleSets Routes - Stratification regressions', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    setupValidator(app);

    for (const schema of Object.values(schemas)) {
      if (schema && typeof schema === 'object' && '$id' in schema) {
        app.addSchema(schema);
      }
    }

    await app.register(ruleSetRoutes, { prefix: '/rule-sets' });
    await app.ready();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /rule-sets/:id/versions handles empty SRL rule bodies', async () => {
    const ruleVersion = {
      $id: RULE_VERSION_ID,
      '@type': 'RuleVersion',
      isPartOf: RULE_SET_ID,
      version: 1,
      grammarType: 'shacl-rules',
      grammarValid: true,
      ruleString: 'RULE {} WHERE {}',
    };

    hoisted.ruleSet.get.mockReturnValue({ $id: RULE_SET_ID, '@type': 'RuleSet' });
    hoisted.ruleSetVersion.list.mockReturnValue([]);
    hoisted.coordinator.list.mockReturnValue([]);
    hoisted.coordinator.get.mockImplementation((id: string) => (id === RULE_VERSION_ID ? ruleVersion : null));
    hoisted.coordinator.create.mockImplementation(async (_type: string, entity: Record<string, unknown>) => entity);
    hoisted.coordinator.update.mockImplementation(async (_type: string, id: string, updates: Record<string, unknown>) => ({ $id: id, ...updates }));

    hoisted.mockExpand.mockImplementation((version: Record<string, any>) => ({
      ruleSetVersion: {
        id: version.$id,
        isPartOf: version.isPartOf,
        version: version.version,
        hasRule: version.hasRule,
        hasDataBlock: version.hasDataBlock ?? [],
        stratificationReport: version.stratificationReport,
      },
      rules: [],
      dataBlocks: [],
    }));

    const res = await app.inject({
      method: 'POST',
      url: `/rule-sets/${encodeURIComponent(RULE_SET_ID)}/versions`,
      payload: { hasRule: [RULE_VERSION_ID] },
    });

    expect(res.statusCode, res.body).toBe(201);
    const created = hoisted.coordinator.create.mock.calls.at(-1)?.[1] as Record<string, any>;
    expect(typeof created?.stratificationReport).toBe('string');
    // Frozen on create: the composition the report describes cannot move under it.
    expect(created?.immutable).toBe(true);
    expect(res.json()).toMatchObject({
      ruleSetVersion: { hasRule: [RULE_VERSION_ID] },
    });
  });
});
