import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { QueryTypeIri } from '../../../src/constants/queryTypes.js';
import { ScenarioTestBaseUnmocked, type ScenarioTestContext } from '../fixtures/scenario-test-base-unmocked.js';

/**
 * Scenario 12: per-edge `whenEmpty` policy.
 *
 * When an upstream node produces zero rows, the default is faithful substitution:
 * a zero-row VALUES clause, so the downstream query returns nothing. That is the
 * behaviour that makes "find users named X, then fetch their orders" return no
 * orders rather than every order in the store.
 *
 * An author who wants optional enrichment instead - "run open if upstream found
 * nothing" - flips the edge to `unconstrained`. This asserts both directions,
 * because the whole point of the flag is that it changes the result.
 */
describe('whenEmpty policy on a chained edge', () => {
  let context: ScenarioTestContext;
  let library: any;

  beforeAll(async () => {
    context = await ScenarioTestBaseUnmocked.createTestContext('when-empty-policy');
    await ScenarioTestBaseUnmocked.loadTurtleDataIntoBackend(context, 'people-skills-projects.ttl');
    await ScenarioTestBaseUnmocked.createOxigraphBackend(context, 'WhenEmpty Backend');
    library = await ScenarioTestBaseUnmocked.createLibrary(context, 'WhenEmpty Library');
  }, 30000);

  afterAll(async () => {
    await ScenarioTestBaseUnmocked.cleanupTestContext(context);
  });

  // Upstream deliberately matches nothing, so the downstream input arrives empty.
  const upstreamQuery = `
    PREFIX ex: <http://example.org/>
    PREFIX foaf: <http://xmlns.com/foaf/0.1/>

    SELECT ?person WHERE {
      ?person a foaf:Person ;
              ex:experienceLevel "no-such-level" .
    }
  `;

  const downstreamQuery = `
    PREFIX foaf: <http://xmlns.com/foaf/0.1/>

    SELECT ?p ?name WHERE {
      VALUES (?p) { (UNDEF) }
      ?p foaf:name ?name .
    }
    ORDER BY ?name
  `;

  const createQueryVersion = async (name: string, queryString: string) => {
    const query = await context.app.inject({
      method: 'POST',
      url: '/queries/',
      payload: { name, isPartOf: [context.libraryId] },
    });
    expect(query.statusCode).toBe(201);
    const version = await context.app.inject({
      method: 'POST',
      url: `/queries/${encodeURIComponent(query.json().id)}/v`,
      payload: { queryVersion: { queryString, queryType: QueryTypeIri.select } },
    });
    expect(version.statusCode).toBe(201);
    return version.json();
  };

  /** Build a group whose chained edge carries the given policy, and execute it. */
  const runWithPolicy = async (label: string, whenEmpty?: string) => {
    const group = await ScenarioTestBaseUnmocked.createQueryGroup(context, `WhenEmpty ${label}`);
    const upstream = await createQueryVersion(`Upstream ${label}`, upstreamQuery);
    const downstream = await createQueryVersion(`Downstream ${label}`, downstreamQuery);

    const upstreamNode = 'urn:ui-temp:upstream';
    const downstreamNode = 'urn:ui-temp:downstream';

    const versionResponse = await context.app.inject({
      method: 'POST',
      url: `/query-groups/${encodeURIComponent(group.id)}/v`,
      payload: {
        queryGroupVersion: {},
        endNode: { mediaType: 'application/sparql-results+json' },
        executionNodes: [
          {
            id: upstreamNode, nodeType: 'QueryNode',
            queryId: upstream.queryVersion.id, backendId: context.backendId,
            outputs: [upstream.queryVersion.inferredOutputs[0]],
          },
          {
            id: downstreamNode, nodeType: 'QueryNode',
            queryId: downstream.queryVersion.id, backendId: context.backendId,
            inputs: [downstream.queryVersion.inferredInputs[0]],
            outputs: [downstream.queryVersion.inferredOutputs[0]],
          },
        ],
        edges: [
          {
            id: 'urn:ui-temp:edge-1', sourceNodeId: 'urn:__START__',
            targetNodeId: upstreamNode, dataFlowType: 'CONTROL_FLOW',
          },
          {
            id: 'urn:ui-temp:edge-2', sourceNodeId: upstreamNode, targetNodeId: downstreamNode,
            dataFlowType: 'VARIABLE_BINDINGS',
            sourceOutputId: upstream.queryVersion.inferredOutputs[0],
            targetInputId: downstream.queryVersion.inferredInputs[0],
            ...(whenEmpty ? { whenEmpty } : {}),
          },
          {
            id: 'urn:ui-temp:edge-3', sourceNodeId: downstreamNode, targetNodeId: 'urn:__END__',
            dataFlowType: 'VARIABLE_BINDINGS',
            sourceOutputId: downstream.queryVersion.inferredOutputs[0],
            targetInputId: downstream.queryVersion.inferredOutputs[0],
          },
        ],
      },
    });
    expect(versionResponse.statusCode).toBe(201);
    const created = versionResponse.json();

    await context.app.inject({
      method: 'PUT',
      url: `/query-groups/${encodeURIComponent(group.id)}`,
      payload: {
        name: group.name, isPartOf: group.isPartOf,
        currentVersion: created.queryGroupVersion.id,
      },
    });

    const execution = await context.app.inject({
      method: 'POST',
      url: '/execute/',
      headers: { accept: 'application/sparql-results+json' },
      payload: { targetId: group.id },
    });
    return { execution, groupId: group.id, versionId: created.queryGroupVersion.id };
  };

  const rowsOf = (execution: { statusCode: number; json: () => any }) => {
    expect(execution.statusCode).toBe(200);
    return execution.json().results.bindings as any[];
  };

  it('defaults to propagating the empty set, so an empty upstream yields no rows', async () => {
    const { execution } = await runWithPolicy('default');
    expect(rowsOf(execution)).toEqual([]);
  }, 20000);

  it('runs the downstream query unconstrained when the edge opts in', async () => {
    // Same graph, same data, one persisted flag different: the filter is dropped
    // and every person comes back.
    const { execution } = await runWithPolicy('unconstrained', 'unconstrained');
    const names = rowsOf(execution).map(row => row.name.value).sort();
    expect(names).toEqual(['Alice Johnson', 'Bob Smith', 'Charlie Brown', 'Diana Prince', 'Eve Taylor']);
  }, 20000);

  it('fails the run with a named error when the edge is marked require', async () => {
    const { execution } = await runWithPolicy('require', 'require');
    expect(execution.statusCode).toBe(400);
    const body = execution.json();
    expect(body.error).toContain('received no bindings');
    // The failure is attributed to the node that could not be parameterised.
    expect(body.failedNodeId).toBeDefined();
  }, 20000);

  it('rejects an unknown policy value', async () => {
    const group = await ScenarioTestBaseUnmocked.createQueryGroup(context, 'WhenEmpty invalid');
    const upstream = await createQueryVersion('Upstream invalid', upstreamQuery);

    const response = await context.app.inject({
      method: 'POST',
      url: `/query-groups/${encodeURIComponent(group.id)}/v`,
      payload: {
        queryGroupVersion: {},
        executionNodes: [{
          id: 'urn:ui-temp:only', nodeType: 'QueryNode',
          queryId: upstream.queryVersion.id, backendId: context.backendId,
          outputs: [upstream.queryVersion.inferredOutputs[0]],
        }],
        edges: [{
          id: 'urn:ui-temp:edge-1', sourceNodeId: 'urn:__START__',
          targetNodeId: 'urn:ui-temp:only', dataFlowType: 'CONTROL_FLOW',
          whenEmpty: 'sometimes',
        }],
      },
    });

    expect(response.statusCode).toBeGreaterThanOrEqual(400);
  }, 20000);
});
