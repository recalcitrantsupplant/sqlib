import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AuthStore, setAuthStore } from '../../../src/auth/AuthStore.js';
import { principalIri } from '../../../src/auth/principals.js';
import { PRINCIPAL_AUTHENTICATED } from '../../../src/auth/types.js';
import {
  DEMO_GRAPHS,
  GRAPH_ACCESS_DEMO_DATA_BACKEND_ID,
  GRAPH_ACCESS_DEMO_LIBRARY_ID,
  seedGraphAccessDemo,
} from '../../../src/lib/graphAccessDemo/seed.js';
import { ScenarioTestBaseUnmocked, type ScenarioTestContext } from '../fixtures/scenario-test-base-unmocked.js';

/**
 * Scenario 16: the graph access demo that `just demo-graph-access` seeds.
 *
 * The seeded policy is evaluated for real, through `Test as`, so the demo
 * shows what it says it shows: each group reads its own graphs and everyone
 * reads the public one.
 */
describe('graph access demo seed', () => {
  let context: ScenarioTestContext;
  let store: AuthStore;
  const ISSUER = 'http://localhost:8080/auth/v1/';
  const group = (name: string) => principalIri('group', ISSUER, name);

  const testAs = async (groups: string[]) => {
    const response = await context.app.inject({
      method: 'POST',
      url: `/backends/${encodeURIComponent(GRAPH_ACCESS_DEMO_DATA_BACKEND_ID)}/graph-policy/test`,
      payload: { groups },
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json() as { defaultGraphs: string[]; namedGraphs: string[]; error: string | null };
  };

  beforeAll(async () => {
    context = await ScenarioTestBaseUnmocked.createTestContext('graph-access-demo');
    store = new AuthStore();
    setAuthStore(store);
  }, 30000);

  afterAll(async () => {
    setAuthStore(null);
    await ScenarioTestBaseUnmocked.cleanupTestContext(context);
  });

  it('seeds the library, the policy and the grants, once', async () => {
    const first = await seedGraphAccessDemo();
    expect(first).toMatchObject({ libraryId: GRAPH_ACCESS_DEMO_LIBRARY_ID, issuer: ISSUER, queriesCreated: 3, grantsCreated: 3 });
    const again = await seedGraphAccessDemo();
    expect(again).toMatchObject({ queriesCreated: 0, grantsCreated: 0 });

    expect(store.listGrants({ principal: PRINCIPAL_AUTHENTICATED }).map((g) => [...g.modes].sort())).toEqual(
      expect.arrayContaining([['execute', 'read'], ['query:saved']]),
    );
    expect(store.listPrincipals().map((p) => p.rawClaim)).toEqual(expect.arrayContaining(['analysts', 'hr']));
  });

  it('gives each group its graphs, and everyone the public graph', async () => {
    const nobody = await testAs([]);
    expect(nobody.error).toBeNull();
    expect(nobody.namedGraphs).toEqual([DEMO_GRAPHS.public]);

    const analyst = await testAs([group('analysts')]);
    expect(analyst.namedGraphs.sort()).toEqual([DEMO_GRAPHS.finance, DEMO_GRAPHS.public]);

    const hr = await testAs([group('hr')]);
    expect(hr.namedGraphs.sort()).toEqual([DEMO_GRAPHS.finance, DEMO_GRAPHS.hr, DEMO_GRAPHS.public]);
  });
});
