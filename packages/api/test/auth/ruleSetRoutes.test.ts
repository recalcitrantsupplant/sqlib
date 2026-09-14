/**
 * Two routes of the real `/rule-sets` plugin that nothing was checking.
 *
 * Both were found by asking the sweep's question of every route in the plugin
 * — *who may call this* — while writing its manifest into
 * `route-coverage.test.ts`.
 *
 * 1. **`POST /:id/srl/preview` was exempt from the guard.** The plugin
 *    registered `exemptSuffixes: ['/preview', '/preview/normalize']`, which is
 *    right for a stateless helper that parses caller-supplied input — and this
 *    plugin has none. The list matches path *suffixes*, so the only route it
 *    reached was the entity-scoped one, which loads the rule set, resolves its
 *    current version and reports that version's composition. A principal
 *    holding nothing on the library was answered 200 with every rule version
 *    id in the set, the rule each belongs to, how many other rule sets use it
 *    and whether it is orphaned, while `GET /:id` and `GET /:id/srl` refused
 *    the same caller.
 *
 * 2. **`PATCH /:id/versions/:version` matched on `isPartOf` alone.** Its
 *    sibling GET and DELETE fetch the rule set first and 404 on a miss, which
 *    is what makes the guard's abstain-on-miss safe for them. This one did
 *    not, so a version whose rule set no longer resolves was annotatable with
 *    no check at all — the `queries.ts` shape.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';
import type { AuthContext } from '../../src/auth/types.js';

const LIBRARY = 'urn:sqlib:library:hydrology';
const RULE_SET = 'urn:sqlib:ruleset:private';
const RULE_SET_V1 = 'urn:sqlib:ruleset:private:v1';
const RULE = 'urn:sqlib:rule:classified';
const RULE_V1 = 'urn:sqlib:rule:classified:v1';
/** A rule set that is gone; its versions are still stored. */
const GHOST_SET = 'urn:sqlib:ruleset:deleted';
const GHOST_SET_V1 = 'urn:sqlib:ruleset:deleted:v1';

const store = vi.hoisted(() => ({
  entities: new Map<string, Record<string, unknown>>(),
  updates: [] as Array<{ id: string; patch: Record<string, unknown> }>,
}));

const byType = (type: string) =>
  [...store.entities.values()].filter(entity => entity['@type'] === type);

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => {
  const repo = (type: string) => ({
    get: (id: string) => {
      const entity = store.entities.get(id);
      return entity && entity['@type'] === type ? entity : null;
    },
    list: () => byType(type),
    update: async (id: string, patch: Record<string, unknown>) => {
      store.updates.push({ id, patch });
      const existing = store.entities.get(id);
      return existing ? { ...existing, ...patch } : null;
    },
  });
  return {
    getCacheCoordinator: () => ({ get: (id: string) => store.entities.get(id) ?? null }),
    getEntityRepositories: () => ({
      RuleSet: repo('RuleSet'),
      RuleSetVersion: repo('RuleSetVersion'),
      Rule: repo('Rule'),
      RuleVersion: repo('RuleVersion'),
      DataBlock: repo('DataBlock'),
      DataBlockVersion: repo('DataBlockVersion'),
    }),
  };
});

function libraryMode(...modes: Array<'read' | 'write' | 'execute' | 'delete' | 'control'>): AuthContext {
  return {
    subject: 'urn:sqlib:principal:user:caller',
    principals: ['urn:sqlib:principal:user:caller', 'urn:sqlib:principal:authenticated'],
    issuer: 'https://issuer.test/',
    tokenType: 'user',
    grants: {
      admin: false,
      backends: new Map(),
      libraries: modes.length ? new Map([[LIBRARY, new Set(modes)]]) : new Map(),
    },
    claims: {},
    fullAccess: false,
    mode: 'required',
  };
}

const stranger = libraryMode();
const reader = libraryMode('read');
const writer = libraryMode('read', 'write');

const authDisabled: AuthContext = {
  ...stranger,
  subject: 'urn:sqlib:principal:anonymous',
  principals: [],
  issuer: null,
  fullAccess: true,
  mode: 'disabled',
};

/** A document naming one rule, which is not the one the set holds. */
const SRL_DOCUMENT = 'PREFIX : <http://example/>\nRULE { ?s :q ?o } WHERE { ?s :p ?o }';

async function appAs(context: AuthContext): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  setupValidator(app);
  for (const schema of Object.values(schemas)) {
    if (schema && typeof schema === 'object' && '$id' in schema) app.addSchema(schema);
  }
  app.setErrorHandler((error, _request, reply) => {
    reply.status((error as { statusCode?: number }).statusCode ?? 500).send({ error: error.message });
  });
  app.decorateRequest('authContext', undefined);
  app.addHook('onRequest', async request => {
    request.authContext = context;
  });

  const plugin = (await import('../../src/routes/rule-sets.js')).default;
  await app.register(plugin as never, { prefix: '/rule-sets' });
  await app.ready();
  return app;
}

async function inject(
  context: AuthContext,
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  payload?: object,
) {
  const app = await appAs(context);
  try {
    return await app.inject({ method, url, payload });
  } finally {
    await app.close();
  }
}

beforeEach(() => {
  store.entities = new Map<string, Record<string, unknown>>([
    [LIBRARY, { '@type': 'Library', $id: LIBRARY, name: 'Hydrology' }],
    [RULE_SET, {
      '@type': 'RuleSet', $id: RULE_SET, name: 'Private', isPartOf: [LIBRARY],
      currentVersion: RULE_SET_V1,
    }],
    [RULE_SET_V1, {
      '@type': 'RuleSetVersion', $id: RULE_SET_V1, isPartOf: RULE_SET, version: 1,
      hasRule: [RULE_V1], hasDataBlock: [],
    }],
    [RULE, { '@type': 'Rule', $id: RULE, name: 'Classified', isPartOf: [LIBRARY] }],
    [RULE_V1, {
      '@type': 'RuleVersion', $id: RULE_V1, isPartOf: RULE, version: 1, grammarType: 'srl',
      ruleString: 'PREFIX : <http://example/>\nRULE { ?s :classified ?o } WHERE { ?s :secret ?o }',
    }],
    // The deleted set is absent while its version stays stored.
    [GHOST_SET_V1, {
      '@type': 'RuleSetVersion', $id: GHOST_SET_V1, isPartOf: GHOST_SET, version: 1,
      hasRule: [], hasDataBlock: [],
    }],
  ]);
  store.updates = [];
});

describe('POST /rule-sets/:id/srl/preview', () => {
  it('refuses a principal holding nothing, and says nothing about the set', async () => {
    const response = await inject(stranger, 'POST', `/rule-sets/${RULE_SET}/srl/preview`, {
      srl: SRL_DOCUMENT,
    });

    expect(response.statusCode).toBe(403);
    // The composition this used to hand out: which rule versions are in the
    // set, and whether removing one would orphan it.
    expect(response.body).not.toContain(RULE_V1);
    expect(response.body).not.toContain('orphaned');
  });

  it('takes write, like the import it is the first half of', async () => {
    expect(
      (await inject(reader, 'POST', `/rule-sets/${RULE_SET}/srl/preview`, { srl: SRL_DOCUMENT })).statusCode,
    ).toBe(403);

    const allowed = await inject(writer, 'POST', `/rule-sets/${RULE_SET}/srl/preview`, {
      srl: SRL_DOCUMENT,
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().detached).toEqual([
      { ruleVersionId: RULE_V1, ruleId: RULE, otherRuleSets: 0, orphaned: true },
    ]);
  });

  it('is what the sibling read routes already said about this caller', async () => {
    // The control: both of these refused the stranger before this change, and
    // the preview answered 200 — which is what made it a hole rather than a
    // deployment that simply lets everybody in.
    expect((await inject(stranger, 'GET', `/rule-sets/${RULE_SET}`)).statusCode).toBe(403);
    expect((await inject(stranger, 'GET', `/rule-sets/${RULE_SET}/srl`)).statusCode).toBe(403);
  });

  it('is unaffected in disabled mode', async () => {
    const response = await inject(authDisabled, 'POST', `/rule-sets/${RULE_SET}/srl/preview`, {
      srl: SRL_DOCUMENT,
    });

    expect(response.statusCode).toBe(200);
  });
});

describe('PATCH /rule-sets/:id/versions/:version', () => {
  it('annotates a version of a live rule set for a writer, and refuses a reader', async () => {
    const refused = await inject(reader, 'PATCH', `/rule-sets/${RULE_SET}/versions/1`, {
      comment: 'a reader may not write',
    });
    expect(refused.statusCode).toBe(403);
    expect(store.updates).toEqual([]);

    const allowed = await inject(writer, 'PATCH', `/rule-sets/${RULE_SET}/versions/1`, {
      comment: 'annotated by a writer',
    });
    expect(allowed.statusCode).toBe(200);
    expect(store.updates).toHaveLength(1);
  });

  it('refuses a version whose rule set no longer resolves', async () => {
    const response = await inject(writer, 'PATCH', `/rule-sets/${GHOST_SET}/versions/1`, {
      comment: 'written by someone with no grant on it',
    });

    expect(response.statusCode).toBe(403);
    expect(store.updates).toEqual([]);
  });

  it('leaves the sibling routes answering 404 on the same version', async () => {
    // They fetch the rule set and 404, which is why the guard's abstain was
    // safe for them and not for the annotation.
    expect((await inject(writer, 'GET', `/rule-sets/${GHOST_SET}/versions/1`)).statusCode).toBe(404);
  });
});
