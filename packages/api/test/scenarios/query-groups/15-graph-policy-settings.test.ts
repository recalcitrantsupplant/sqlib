import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { QueryTypeIri } from '../../../src/constants/queryTypes.js';
import { oxigraphStoreManager } from '../../../src/lib/OxigraphStoreManager.js';
import { ScenarioTestBaseUnmocked, type ScenarioTestContext } from '../fixtures/scenario-test-base-unmocked.js';

/**
 * Scenario 15: a backend's graph policy, set and tested through the API.
 *
 * The settings are checked when they are saved, so a policy that could never
 * run is refused once. `Test as` then answers what a user or a set of groups
 * may read, with the policy evaluated for real on the auth backend.
 */
describe('graph policy settings and Test as', () => {
  let context: ScenarioTestContext;
  const EX = 'http://example.org/';
  const TEAM_A = 'urn:sqlib:principal:group:team-a';
  const authBackendId = 'urn:sqlib:backend:scenario-15-auth';

  const policyText = `
    PREFIX acl: <${EX}acl#>
    SELECT ?graph WHERE { VALUES ?authGroup { UNDEF } ?grant acl:group ?authGroup ; acl:graph ?graph }
  `;

  const saveQuery = async (name: string, queryString: string) => {
    const query = await context.app.inject({
      method: 'POST',
      url: '/queries/',
      payload: { name, isPartOf: [context.libraryId], defaultBackend: authBackendId },
    });
    expect(query.statusCode, query.body).toBe(201);
    const version = await context.app.inject({
      method: 'POST',
      url: `/queries/${encodeURIComponent(query.json().id)}/versions`,
      payload: { queryVersion: { queryString, queryType: QueryTypeIri.select } },
    });
    expect(version.statusCode, version.body).toBe(201);
    return version.json().queryVersion.id as string;
  };

  const putBackend = (id: string, payload: Record<string, unknown>) => context.app.inject({
    method: 'PUT',
    url: `/backends/${encodeURIComponent(id)}`,
    payload,
  });

  beforeAll(async () => {
    context = await ScenarioTestBaseUnmocked.createTestContext('graph-policy');
    await ScenarioTestBaseUnmocked.createOxigraphBackend(context, 'Data');
    const authStore = oxigraphStoreManager.createEphemeralStore(authBackendId);
    authStore.load(`
      @prefix acl: <${EX}acl#> .
      [] acl:group <${TEAM_A}> ; acl:graph <${EX}g1> .
    `, { format: 'text/turtle' });
    const created = await context.app.inject({
      method: 'POST',
      url: '/backends/',
      payload: { id: authBackendId, name: 'Auth', backendType: 'oxigraphEphemeral', authBackend: true },
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json().authBackend).toBe(true);
    await ScenarioTestBaseUnmocked.createLibrary(context, 'Policies');
  }, 30000);

  afterAll(async () => {
    oxigraphStoreManager.destroyEphemeralStore(authBackendId);
    await ScenarioTestBaseUnmocked.cleanupTestContext(context);
  });

  it('refuses a policy that projects other variables', async () => {
    const bad = await saveQuery('Bad policy', 'SELECT ?g WHERE { GRAPH ?g {} }');
    const response = await putBackend(context.backendId, { graphPolicyQueryVersion: bad, graphPolicyBackend: authBackendId });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/only \?graph/);
  });

  it('refuses a policy backend that is not marked as an auth backend', async () => {
    const policy = await saveQuery('Policy on data', policyText);
    const response = await putBackend(authBackendId, { authBackend: false });
    expect(response.statusCode, response.body).toBe(200);
    const refused = await putBackend(context.backendId, { graphPolicyQueryVersion: policy, graphPolicyBackend: authBackendId });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error).toMatch(/not marked as an auth backend/);
    expect((await putBackend(authBackendId, { authBackend: true })).statusCode).toBe(200);
  });

  it('refuses half a policy', async () => {
    const policy = await saveQuery('Half', policyText);
    const response = await putBackend(context.backendId, { graphPolicyQueryVersion: policy });
    expect(response.statusCode).toBe(400);
  });

  it('saves a sound policy, and Test as evaluates it for given groups', async () => {
    const policy = await saveQuery('Team policy', policyText);
    const saved = await putBackend(context.backendId, { graphPolicyQueryVersion: policy, graphPolicyBackend: authBackendId });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json().graphPolicyQueryVersion).toBe(policy);

    const test = await context.app.inject({
      method: 'POST',
      url: `/backends/${encodeURIComponent(context.backendId)}/graph-policy/test`,
      payload: { user: 'urn:sqlib:principal:user:alice', groups: [TEAM_A] },
    });
    expect(test.statusCode, test.body).toBe(200);
    expect(test.json()).toMatchObject({
      groupsSource: 'given',
      policy: { queryVersion: policy, backend: authBackendId },
      defaultGraphs: [`${EX}g1`],
      namedGraphs: [`${EX}g1`],
      error: null,
    });

    const noGroups = await context.app.inject({
      method: 'POST',
      url: `/backends/${encodeURIComponent(context.backendId)}/graph-policy/test`,
      payload: { user: 'urn:sqlib:principal:user:nobody' },
    });
    expect(noGroups.json()).toMatchObject({ groupsSource: 'none', defaultGraphs: [], namedGraphs: [] });
  });
});
