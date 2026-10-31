import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { QueryTypeIri } from '../../../src/constants/queryTypes.js';
import { ScenarioTestBaseUnmocked, type ScenarioTestContext } from '../fixtures/scenario-test-base-unmocked.js';

/**
 * Scenario 15: a query's own `whenEmpty` per parameter slot.
 *
 * The query author marks a slot `require` on its input tuple, through
 * `inputPolicies` when saving a version. A run that leaves the slot open is
 * then refused wherever it comes from: `/execute` on the query, or a group
 * node that nothing fills. See `docs/proposals/required-arguments.md`.
 */
describe('a required argument on a query slot', () => {
  let context: ScenarioTestContext;

  beforeAll(async () => {
    context = await ScenarioTestBaseUnmocked.createTestContext('required-argument');
    await ScenarioTestBaseUnmocked.loadTurtleDataIntoBackend(context, 'people-skills-projects.ttl');
    await ScenarioTestBaseUnmocked.createOxigraphBackend(context, 'Required Backend');
    await ScenarioTestBaseUnmocked.createLibrary(context, 'Required Library');
  }, 30000);

  afterAll(async () => {
    await ScenarioTestBaseUnmocked.cleanupTestContext(context);
  });

  const namesQuery = `
    PREFIX foaf: <http://xmlns.com/foaf/0.1/>

    SELECT ?p ?name WHERE {
      VALUES (?p) { (UNDEF) }
      ?p foaf:name ?name .
    }
    ORDER BY ?name
  `;

  const upstreamQuery = `
    PREFIX ex: <http://example.org/>
    PREFIX foaf: <http://xmlns.com/foaf/0.1/>

    SELECT ?person WHERE {
      ?person a foaf:Person ;
              ex:experienceLevel "no-such-level" .
    }
  `;

  const createQuery = async (name: string) => {
    const query = await context.app.inject({
      method: 'POST',
      url: '/queries/',
      payload: { name, isPartOf: [context.libraryId], defaultBackend: context.backendId },
    });
    expect(query.statusCode).toBe(201);
    return query.json().id as string;
  };

  const saveVersion = (queryId: string, queryString: string, extra: Record<string, unknown> = {}) =>
    context.app.inject({
      method: 'POST',
      url: `/queries/${encodeURIComponent(queryId)}/versions`,
      payload: { queryVersion: { queryString, queryType: QueryTypeIri.select }, ...extra },
    });

  /** A query run names its backend; a group's nodes name their own. */
  const execute = (targetId: string, payload: Record<string, unknown> = {}, backend = true) =>
    context.app.inject({
      method: 'POST',
      url: '/execute/',
      headers: { accept: 'application/sparql-results+json' },
      payload: { targetId, ...(backend ? { backendId: context.backendId } : {}), ...payload },
    });

  const modes = (version: { json: () => unknown }) =>
    (version.json() as { inputTuples: Array<{ whenEmpty?: string | null }> }).inputTuples
      .map((tuple) => tuple.whenEmpty ?? null);

  const ALICE = {
    head: { vars: ['p'] },
    results: { bindings: [{ p: { type: 'uri', value: 'http://example.org/alice' } }] },
  };

  it('refuses a run that leaves a required slot open, and runs one that fills it', async () => {
    const queryId = await createQuery('Required names');
    const saved = await saveVersion(queryId, namesQuery, { inputPolicies: [{ vars: ['p'], whenEmpty: 'require' }] });
    expect(saved.statusCode).toBe(201);
    expect(modes(saved)).toEqual(['require']);

    const open = await execute(queryId);
    expect(open.statusCode).toBe(400);
    expect(open.json().error).toContain('Required input for VALUES clause 1 (?p) received no bindings');

    const wildcard = await execute(queryId, { arguments: [{ head: { vars: ['p'] }, results: { bindings: [{}] } }] });
    expect(wildcard.statusCode).toBe(400);

    const filled = await execute(queryId, { arguments: [ALICE] });
    expect(filled.statusCode).toBe(200);
    const rows = filled.json().results.bindings as Array<{ name: { value: string } }>;
    expect(rows.map((row) => row.name.value)).toEqual(['Alice Johnson']);
  }, 20000);

  it('carries the mode to the next version, and clears it on request', async () => {
    const queryId = await createQuery('Carried names');
    await saveVersion(queryId, namesQuery, { inputPolicies: [{ vars: ['p'], whenEmpty: 'require' }] });

    const edited = await saveVersion(queryId, `${namesQuery}\nLIMIT 10`);
    expect(edited.statusCode).toBe(201);
    expect(modes(edited)).toEqual(['require']);
    expect((await execute(queryId)).statusCode).toBe(400);

    const cleared = await saveVersion(queryId, namesQuery, { inputPolicies: [{ vars: ['p'], whenEmpty: null }] });
    expect(modes(cleared)).toEqual([null]);
    const open = await execute(queryId);
    expect(open.statusCode).toBe(200);
    expect(open.json().results.bindings.length).toBe(5);
  }, 20000);

  it('matches nothing for an omitted propagateEmpty slot', async () => {
    const queryId = await createQuery('Quiet names');
    await saveVersion(queryId, namesQuery, { inputPolicies: [{ vars: ['p'], whenEmpty: 'propagateEmpty' }] });
    const run = await execute(queryId);
    expect(run.statusCode).toBe(200);
    expect(run.json().results.bindings).toEqual([]);
  }, 20000);

  it('refuses a policy for a slot the query does not declare', async () => {
    const queryId = await createQuery('Misnamed names');
    const saved = await saveVersion(queryId, namesQuery, { inputPolicies: [{ vars: ['person'], whenEmpty: 'require' }] });
    expect(saved.statusCode).toBe(400);
    expect(saved.json().error).toContain('[person]');
  }, 20000);

  /** One edge from an empty upstream into the required slot, with the edge's own policy. */
  const runGroup = async (label: string, edgeWhenEmpty?: string) => {
    const group = await ScenarioTestBaseUnmocked.createQueryGroup(context, `Required ${label}`);
    const upstreamId = await createQuery(`Upstream ${label}`);
    const upstream = (await saveVersion(upstreamId, upstreamQuery)).json();
    const downstreamId = await createQuery(`Downstream ${label}`);
    const downstream = (await saveVersion(downstreamId, namesQuery, {
      inputPolicies: [{ vars: ['p'], whenEmpty: 'require' }],
    })).json();

    const created = await context.app.inject({
      method: 'POST',
      url: `/query-groups/${encodeURIComponent(group.id)}/versions`,
      payload: {
        queryGroupVersion: {},
        endNode: { mediaType: 'application/sparql-results+json' },
        executionNodes: [
          {
            id: 'urn:ui-temp:upstream', nodeType: 'QueryNode',
            queryId: upstream.queryVersion.id, backendId: context.backendId,
            outputs: [upstream.queryVersion.inferredOutputs[0]],
          },
          {
            id: 'urn:ui-temp:downstream', nodeType: 'QueryNode',
            queryId: downstream.queryVersion.id, backendId: context.backendId,
            inputs: [downstream.queryVersion.inferredInputs[0]],
            outputs: [downstream.queryVersion.inferredOutputs[0]],
          },
        ],
        edges: [
          {
            id: 'urn:ui-temp:edge-1', sourceNodeId: 'urn:__START__',
            targetNodeId: 'urn:ui-temp:upstream', dataFlowType: 'CONTROL_FLOW',
          },
          {
            id: 'urn:ui-temp:edge-2', sourceNodeId: 'urn:ui-temp:upstream', targetNodeId: 'urn:ui-temp:downstream',
            dataFlowType: 'VARIABLE_BINDINGS',
            sourceOutputId: upstream.queryVersion.inferredOutputs[0],
            targetInputId: downstream.queryVersion.inferredInputs[0],
            ...(edgeWhenEmpty ? { whenEmpty: edgeWhenEmpty } : {}),
          },
          {
            id: 'urn:ui-temp:edge-3', sourceNodeId: 'urn:ui-temp:downstream', targetNodeId: 'urn:__END__',
            dataFlowType: 'VARIABLE_BINDINGS',
            sourceOutputId: downstream.queryVersion.inferredOutputs[0],
            targetInputId: downstream.queryVersion.inferredOutputs[0],
          },
        ],
      },
    });
    expect(created.statusCode).toBe(201);
    await context.app.inject({
      method: 'PUT',
      url: `/query-groups/${encodeURIComponent(group.id)}`,
      payload: { name: group.name, isPartOf: group.isPartOf, currentVersion: created.json().queryGroupVersion.id },
    });
    return execute(group.id, {}, false);
  };

  it('refuses an empty upstream into a required slot when the edge says nothing', async () => {
    const run = await runGroup('unset');
    expect(run.statusCode).toBe(400);
    expect(run.json().error).toContain('(?p) received no bindings');
  }, 20000);

  it('lets the edge choose to return no rows, but not to run open', async () => {
    const quiet = await runGroup('propagate', 'propagateEmpty');
    expect(quiet.statusCode).toBe(200);
    expect(quiet.json().results.bindings).toEqual([]);

    const open = await runGroup('open', 'unconstrained');
    expect(open.statusCode).toBe(400);
    expect(open.json().error).toContain("marked 'require' by its query and cannot be run unconstrained");
  }, 30000);
});
