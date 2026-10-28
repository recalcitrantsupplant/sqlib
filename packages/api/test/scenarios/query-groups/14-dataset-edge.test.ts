import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { QueryTypeIri } from '../../../src/constants/queryTypes.js';
import { oxigraphStoreManager } from '../../../src/lib/OxigraphStoreManager.js';
import { ScenarioTestBaseUnmocked, type ScenarioTestContext } from '../fixtures/scenario-test-base-unmocked.js';

/**
 * Scenario 14: dataset inputs.
 *
 * An upstream query selects graph IRIs from a catalog, and a `DATASET` edge
 * makes them the downstream query's dataset. The downstream text names no
 * graph: what it reads is chosen at run time. A caller may narrow it further
 * with `defaultGraphs` / `namedGraphs` on `/execute`, and the two restrictions
 * intersect rather than one replacing the other.
 */
describe('DATASET edge', () => {
  let context: ScenarioTestContext;

  const EX = 'http://example.org/';
  const data = `
    @prefix ex: <${EX}> .
    ex:catalog { ex:g1 a ex:Approved . ex:g3 a ex:Approved . }
    ex:g1 { ex:s1 ex:p "one" . }
    ex:g2 { ex:s2 ex:p "two" . }
    ex:g3 { ex:s3 ex:p "three" . }
  `;

  const upstreamQuery = `
    PREFIX ex: <${EX}>
    SELECT ?g WHERE { GRAPH ex:catalog { ?g a ex:Approved } }
  `;
  const emptyUpstreamQuery = `
    PREFIX ex: <${EX}>
    SELECT ?g WHERE { GRAPH ex:catalog { ?g a ex:Retired } }
  `;
  const downstreamQuery = `
    PREFIX ex: <${EX}>
    SELECT ?o WHERE { ?s ex:p ?o }
  `;

  beforeAll(async () => {
    context = await ScenarioTestBaseUnmocked.createTestContext('dataset-edge');
    const store = oxigraphStoreManager.createEphemeralStore(context.backendId);
    store.load(data, { format: 'application/trig' });
    await ScenarioTestBaseUnmocked.createOxigraphBackend(context, 'Dataset Backend');
    await ScenarioTestBaseUnmocked.createLibrary(context, 'Dataset Library');
  }, 30000);

  afterAll(async () => {
    await ScenarioTestBaseUnmocked.cleanupTestContext(context);
  });

  const createQuery = async (name: string, queryString: string) => {
    const query = await context.app.inject({
      method: 'POST',
      url: '/queries/',
      payload: { name, isPartOf: [context.libraryId], defaultBackend: context.backendId },
    });
    expect(query.statusCode).toBe(201);
    const version = await context.app.inject({
      method: 'POST',
      url: `/queries/${encodeURIComponent(query.json().id)}/versions`,
      payload: { queryVersion: { queryString, queryType: QueryTypeIri.select } },
    });
    expect(version.statusCode).toBe(201);
    return { queryId: query.json().id as string, version: version.json().queryVersion };
  };

  /** Create a group whose upstream feeds the downstream's dataset, and point the group at it. */
  const createGroup = async (label: string, edge: Record<string, unknown>, upstreamText = upstreamQuery) => {
    const group = await ScenarioTestBaseUnmocked.createQueryGroup(context, `Dataset ${label}`);
    const upstream = await createQuery(`Upstream ${label}`, upstreamText);
    const downstream = await createQuery(`Downstream ${label}`, downstreamQuery);
    const upstreamNode = 'urn:ui-temp:upstream';
    const downstreamNode = 'urn:ui-temp:downstream';

    const response = await context.app.inject({
      method: 'POST',
      url: `/query-groups/${encodeURIComponent(group.id)}/versions`,
      payload: {
        queryGroupVersion: {},
        endNode: { mediaType: 'application/sparql-results+json' },
        executionNodes: [
          {
            id: upstreamNode, nodeType: 'QueryNode',
            queryId: upstream.version.id, backendId: context.backendId,
            outputs: [upstream.version.inferredOutputs[0]],
          },
          {
            id: downstreamNode, nodeType: 'QueryNode',
            queryId: downstream.version.id, backendId: context.backendId,
            outputs: [downstream.version.inferredOutputs[0]],
          },
        ],
        edges: [
          {
            id: 'urn:ui-temp:edge-1', sourceNodeId: 'urn:__START__',
            targetNodeId: upstreamNode, dataFlowType: 'CONTROL_FLOW',
          },
          {
            id: 'urn:ui-temp:edge-2', sourceNodeId: upstreamNode, targetNodeId: downstreamNode,
            dataFlowType: 'DATASET',
            sourceOutputId: upstream.version.inferredOutputs[0],
            ...edge,
          },
          {
            id: 'urn:ui-temp:edge-3', sourceNodeId: downstreamNode, targetNodeId: 'urn:__END__',
            dataFlowType: 'VARIABLE_BINDINGS',
            sourceOutputId: downstream.version.inferredOutputs[0],
            targetInputId: downstream.version.inferredOutputs[0],
          },
        ],
      },
    });
    if (response.statusCode !== 201) return { response, groupId: group.id, downstream };

    await context.app.inject({
      method: 'PUT',
      url: `/query-groups/${encodeURIComponent(group.id)}`,
      payload: { name: group.name, isPartOf: group.isPartOf, currentVersion: response.json().queryGroupVersion.id },
    });
    return { response, groupId: group.id, downstream };
  };

  const execute = (payload: Record<string, unknown>) => context.app.inject({
    method: 'POST',
    url: '/execute/',
    headers: { accept: 'application/sparql-results+json' },
    payload,
  });

  const valuesOf = (execution: { statusCode: number; json: () => unknown; body: string }) => {
    expect(execution.statusCode, execution.body).toBe(200);
    const body = execution.json() as { results: { bindings: Array<{ o: { value: string } }> } };
    return body.results.bindings.map((row) => row.o.value).sort();
  };

  it('runs the downstream query over the graphs the upstream selected', async () => {
    const { response, groupId } = await createGroup('default part', { datasetPart: 'default' });
    expect(response.statusCode, response.body).toBe(201);
    expect(valuesOf(await execute({ targetId: groupId }))).toEqual(['one', 'three']);
  }, 20000);

  it('intersects a caller dataset with the edge, so a caller cannot widen it', async () => {
    const { response, groupId } = await createGroup('intersect', { datasetPart: 'default' });
    expect(response.statusCode, response.body).toBe(201);
    // g2 is not in the catalog, so asking for it adds nothing; g3 is in both.
    const execution = await execute({ targetId: groupId, defaultGraphs: [`${EX}g2`, `${EX}g3`] });
    expect(valuesOf(execution)).toEqual(['three']);
  }, 20000);

  it('propagates an empty selection as an empty dataset, not the whole store', async () => {
    const { response, groupId } = await createGroup('empty', { datasetPart: 'default' }, emptyUpstreamQuery);
    expect(response.statusCode, response.body).toBe(201);
    expect(valuesOf(await execute({ targetId: groupId }))).toEqual([]);
  }, 20000);

  it('fails the run when the edge is marked require and the selection is empty', async () => {
    const { response, groupId } = await createGroup('require', { datasetPart: 'default', whenEmpty: 'require' }, emptyUpstreamQuery);
    expect(response.statusCode, response.body).toBe(201);
    const execution = await execute({ targetId: groupId });
    expect(execution.statusCode).toBe(400);
  }, 20000);

  it('refuses whenEmpty unconstrained on a DATASET edge', async () => {
    const { response } = await createGroup('unconstrained', { whenEmpty: 'unconstrained' });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.statusCode).toBeLessThan(500);
  }, 20000);

  it('refuses an unknown datasetPart', async () => {
    const { response } = await createGroup('bad part', { datasetPart: 'everything' });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.statusCode).toBeLessThan(500);
  }, 20000);

  it('takes a caller dataset on a single query', async () => {
    const { queryId } = await createQuery('Single', downstreamQuery);
    expect(valuesOf(await execute({ targetId: queryId, defaultGraphs: [`${EX}g2`] }))).toEqual(['two']);
  }, 20000);

  it('refuses a graph that is not an IRI', async () => {
    const { queryId } = await createQuery('Single bad', downstreamQuery);
    const execution = await execute({ targetId: queryId, namedGraphs: ['not an iri'] });
    expect(execution.statusCode).toBe(400);
  }, 20000);
});
