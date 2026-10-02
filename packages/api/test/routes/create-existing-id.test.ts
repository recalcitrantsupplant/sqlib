/**
 * A create that names an id already in use is a conflict, on every create route.
 *
 * `CacheCoordinator.create` used to insert without looking: the store insert is
 * additive and the cache entry was replaced, re-typing the id. `POST
 * /libraries` had its own 409 for exactly that reason and its siblings did not,
 * so `POST /queries {id: <library IRI>}` re-typed the library in the cache and
 * the entity guard stopped resolving anything in it as belonging to a library.
 * The refusal now lives in the coordinator, and this suite asks each route in
 * turn, against the real coordinator rather than a stub of it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  ScenarioTestBaseUnmocked,
  type ScenarioTestContext,
} from '../scenarios/fixtures/scenario-test-base-unmocked.js';
import { getCacheCoordinator } from '../../src/lib/CacheCoordinatorProvider.js';

describe('create with an existing id', () => {
  let context: ScenarioTestContext;
  let queryId: string;
  let groupId: string;
  let tagId: string;
  let tupleSetId: string;

  const post = (url: string, payload: Record<string, unknown>) =>
    context.app.inject({ method: 'POST', url, payload });

  beforeAll(async () => {
    context = await ScenarioTestBaseUnmocked.createTestContext('create-existing-id');
    await ScenarioTestBaseUnmocked.createOxigraphBackend(context, 'backend');
    await ScenarioTestBaseUnmocked.createLibrary(context, 'library');

    const query = await post('/queries/', { name: 'q', isPartOf: [context.libraryId] });
    expect(query.statusCode, query.payload).toBe(201);
    queryId = query.json().id;

    const group = await post('/query-groups/', { name: 'g', isPartOf: context.libraryId });
    expect(group.statusCode, group.payload).toBe(201);
    groupId = group.json().id;

    const tag = await post('/tags/', { name: 't', isPartOf: context.libraryId });
    expect(tag.statusCode, tag.payload).toBe(201);
    tagId = tag.json().id;

    const tupleSet = await post('/tuple-sets/', { name: 'ts', isPartOf: [context.libraryId] });
    expect(tupleSet.statusCode, tupleSet.payload).toBe(201);
    tupleSetId = tupleSet.json().id;
  }, 60000);

  afterAll(async () => {
    await ScenarioTestBaseUnmocked.cleanupTestContext(context);
  });

  it.each([
    ['libraries', () => ['/libraries/', { id: context.libraryId, name: 'again' }]],
    ['backends', () => ['/backends/', { id: context.backendId, name: 'again', backendType: 'oxigraphEphemeral' }]],
    ['queries', () => ['/queries/', { id: queryId, name: 'again', isPartOf: [context.libraryId] }]],
    ['query-groups', () => ['/query-groups/', { id: groupId, name: 'again', isPartOf: context.libraryId }]],
    ['tags', () => ['/tags/', { id: tagId, name: 'again', isPartOf: context.libraryId }]],
    ['tuple-sets', () => ['/tuple-sets/', { id: tupleSetId, name: 'again', isPartOf: [context.libraryId] }]],
  ] as const)('POST /%s refuses an id of its own type with 409', async (_route, request) => {
    const [url, payload] = request() as [string, Record<string, unknown>];
    const before = getCacheCoordinator().get(payload.id as string);

    const response = await post(url, payload);

    expect(response.statusCode, response.payload).toBe(409);
    expect(getCacheCoordinator().get(payload.id as string)).toEqual(before);
  });

  it('refuses a query minted at a library IRI, and the library stays a library', async () => {
    const response = await post('/queries/', {
      id: context.libraryId,
      name: 'takeover',
      isPartOf: [context.libraryId],
    });

    expect(response.statusCode, response.payload).toBe(409);
    expect(getCacheCoordinator().get(context.libraryId)?.['@type']).toBe('Library');
  });

  it('refuses a tag minted at a query IRI', async () => {
    const response = await post('/tags/', { id: queryId, name: 'takeover', isPartOf: context.libraryId });

    expect(response.statusCode, response.payload).toBe(409);
    expect(getCacheCoordinator().get(queryId)?.['@type']).toBe('Query');
  });

  it('still creates at a caller-chosen id nothing holds', async () => {
    const id = 'urn:sqlib:query:caller-chosen-create-existing-id';
    const response = await post('/queries/', { id, name: 'fresh', isPartOf: [context.libraryId] });

    expect(response.statusCode, response.payload).toBe(201);
    expect(response.json().id).toBe(id);
  });

  it('re-saving a query version with the ids it was loaded with mints new parts', async () => {
    const first = await post(`/queries/${encodeURIComponent(queryId)}/v`, {
      queryVersion: { queryString: 'SELECT ?s WHERE { ?s ?p ?o } LIMIT 0001' },
    });
    expect(first.statusCode, first.payload).toBe(201);

    const loaded = await context.app.inject({
      method: 'GET',
      url: `/queries/${encodeURIComponent(queryId)}/v/1`,
    });
    expect(loaded.statusCode, loaded.payload).toBe(200);
    const body = loaded.json();
    const partIds = (version: Record<string, Array<{ id: string }>>) =>
      [...version.limitParameters, ...version.outputs, ...version.outputTuples, ...version.tupleMembers]
        .map(part => part.id);
    const firstIds = partIds(body);
    expect(firstIds.length).toBeGreaterThan(0);

    // What an editor sends back: the loaded version's parts, ids and all.
    const second = await post(`/queries/${encodeURIComponent(queryId)}/v`, {
      queryVersion: { queryString: body.queryVersion.queryString },
      limitParameters: body.limitParameters,
      outputs: body.outputs,
      outputTuples: body.outputTuples,
      tupleMembers: body.tupleMembers,
    });
    expect(second.statusCode, second.payload).toBe(201);

    const reloaded = await context.app.inject({
      method: 'GET',
      url: `/queries/${encodeURIComponent(queryId)}/v/2`,
    });
    const secondIds = partIds(reloaded.json());
    expect(secondIds.length).toBe(firstIds.length);
    expect(secondIds.filter(id => firstIds.includes(id))).toEqual([]);
    // And the first version's parts are as they were.
    const again = await context.app.inject({
      method: 'GET',
      url: `/queries/${encodeURIComponent(queryId)}/v/1`,
    });
    expect(again.json()).toEqual(body);
  });

  it('re-saving a group version with the node IRIs it was loaded with mints new nodes and keeps the layout', async () => {
    const version = await post(`/queries/${encodeURIComponent(queryId)}/v`, {
      queryVersion: { queryString: 'SELECT ?s WHERE { ?s ?p ?o }' },
    });
    expect(version.statusCode, version.payload).toBe(201);
    const { id: versionId, inferredOutputs } = version.json().queryVersion;
    const output = inferredOutputs[0];

    const payloadFor = (nodeId: string) => ({
      queryGroupVersion: {
        canvasData: JSON.stringify({ nodes: [{ id: nodeId, position: { x: 10, y: 20 }, label: 'Only' }] }),
      },
      endNode: { mediaType: 'application/sparql-results+json' },
      executionNodes: [
        { id: nodeId, nodeType: 'QueryNode', queryId: versionId, backendId: context.backendId, outputs: [output] },
      ],
      edges: [
        { id: 'urn:ui-temp:edge-start', sourceNodeId: 'urn:__START__', targetNodeId: nodeId, dataFlowType: 'CONTROL_FLOW' },
        {
          id: 'urn:ui-temp:edge-end', sourceNodeId: nodeId, targetNodeId: 'urn:__END__',
          dataFlowType: 'VARIABLE_BINDINGS', sourceOutputId: output, targetInputId: output,
        },
      ],
    });

    const first = await post(`/query-groups/${encodeURIComponent(groupId)}/v`, payloadFor('urn:ui-temp:node-1'));
    expect(first.statusCode, first.payload).toBe(201);
    const firstNode = first.json().queryGroupVersion.executionNodes[0];
    const firstBefore = getCacheCoordinator().get(firstNode);

    const second = await post(`/query-groups/${encodeURIComponent(groupId)}/v`, payloadFor(firstNode));
    expect(second.statusCode, second.payload).toBe(201);
    const secondVersion = second.json().queryGroupVersion;
    const secondNode = secondVersion.executionNodes[0];

    expect(secondNode).not.toBe(firstNode);
    expect(getCacheCoordinator().get(firstNode)).toEqual(firstBefore);
    // The layout follows the nodes to their new IRIs, on both saves.
    expect(JSON.parse(first.json().queryGroupVersion.canvasData).nodes[0].id).toBe(firstNode);
    expect(JSON.parse(secondVersion.canvasData).nodes[0].id).toBe(secondNode);
  });
});
