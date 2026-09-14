import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { QueryTypeIri } from '../../../src/constants/queryTypes.js';
import { ScenarioTestBaseUnmocked, type ScenarioTestContext } from '../fixtures/scenario-test-base-unmocked.js';

/**
 * Scenario 13: Data graphs as start node inputs
 *
 * A start node declares two independent kinds of external input: tuples, filled
 * by the run's `arguments`, and data graphs, filled by its `dataGraphs`. This
 * exercises both in one run — the group's answer contains rows the argument
 * chose *and* triples the caller handed in — because the pair being additive
 * rather than exclusive is the whole point of the feature.
 *
 * Expected flow:
 * 1. The start node declares an input tuple (?targetExperience) and an RDF
 *    input port ("supplied data").
 * 2. The tuple feeds a CONSTRUCT node running against the backend.
 * 3. The RDF port goes straight to the EndNode, which merges it with the
 *    node's output.
 */
describe('Data graph inputs on the StartNode', () => {
  let context: ScenarioTestContext;
  let queryGroup: { id: string; name: string; isPartOf: string[] };

  const SUPPLIED_GRAPH = `
    @prefix ex: <http://example.org/> .
    ex:supplied ex:category "handed-in" .
  `;

  beforeAll(async () => {
    context = await ScenarioTestBaseUnmocked.createTestContext('start-node-data-graph');

    await ScenarioTestBaseUnmocked.loadTurtleDataIntoBackend(context, 'people-skills-projects.ttl');
    await ScenarioTestBaseUnmocked.createOxigraphBackend(context, 'Data Graph Backend');
    await ScenarioTestBaseUnmocked.createLibrary(context, 'Data Graph Library');
    queryGroup = await ScenarioTestBaseUnmocked.createQueryGroup(context, 'Data Graph Workflow');
  }, 30000);

  afterAll(async () => {
    await ScenarioTestBaseUnmocked.cleanupTestContext(context);
  });

  it('runs a group whose start node takes both a tuple and a data graph', { timeout: 15000 }, async () => {
    const constructString = `
      PREFIX ex: <http://example.org/>
      PREFIX foaf: <http://xmlns.com/foaf/0.1/>

      CONSTRUCT {
        ?person ex:category "queried" .
      }
      WHERE {
        VALUES (?targetExperience) { (UNDEF) }

        ?person a foaf:Person ;
                ex:experienceLevel ?targetExperience .
      }
    `;

    const queryResponse = await context.app.inject({
      method: 'POST',
      url: '/queries/',
      payload: { name: 'People by experience', isPartOf: [context.libraryId] },
    });
    const queryEntity = queryResponse.json();
    const versionResponse = await context.app.inject({
      method: 'POST',
      url: `/queries/${encodeURIComponent(queryEntity.id)}/v`,
      payload: { queryVersion: { queryString: constructString, queryType: QueryTypeIri.construct } },
    });
    const queryVersion = versionResponse.json().queryVersion;

    const inputTuple = queryVersion.inferredInputs[0];
    const rdfOutput = queryVersion.inferredOutputs[0];
    const dataPortId = 'urn:ui-temp:supplied-data';
    const nodeId = 'urn:ui-temp:construct-people';

    const groupVersionResponse = await context.app.inject({
      method: 'POST',
      url: `/query-groups/${encodeURIComponent(queryGroup.id)}/v`,
      payload: {
        queryGroupVersion: {},
        // The group's own declared RDF input, owned by the start node the way
        // its input tuples are.
        rdfOutputs: [{ id: dataPortId, name: 'supplied data' }],
        startNode: {
          outputs: [inputTuple, dataPortId],
        },
        endNode: { mediaType: 'application/n-triples' },
        executionNodes: [
          {
            id: nodeId,
            nodeType: 'QueryNode',
            queryId: queryVersion.id,
            backendId: context.backendId,
            inputs: [inputTuple],
            outputs: [rdfOutput],
          },
        ],
        edges: [
          {
            id: 'urn:ui-temp:edge-args',
            sourceNodeId: 'urn:__START__',
            targetNodeId: nodeId,
            dataFlowType: 'VARIABLE_BINDINGS',
            sourceOutputId: inputTuple,
            targetInputId: inputTuple,
          },
          {
            id: 'urn:ui-temp:edge-data',
            sourceNodeId: 'urn:__START__',
            targetNodeId: 'urn:__END__',
            dataFlowType: 'RDF_GRAPH',
            sourceOutputId: dataPortId,
            targetInputId: dataPortId,
          },
          {
            id: 'urn:ui-temp:edge-out',
            sourceNodeId: nodeId,
            targetNodeId: 'urn:__END__',
            dataFlowType: 'RDF_GRAPH',
            sourceOutputId: rdfOutput,
            targetInputId: rdfOutput,
          },
        ],
      },
    });

    expect(groupVersionResponse.statusCode).toBe(201);
    const groupVersion = groupVersionResponse.json();

    await context.app.inject({
      method: 'PUT',
      url: `/query-groups/${encodeURIComponent(queryGroup.id)}`,
      payload: {
        name: queryGroup.name,
        isPartOf: queryGroup.isPartOf,
        currentVersion: groupVersion.queryGroupVersion.id,
      },
    });

    const executeResponse = await context.app.inject({
      method: 'POST',
      url: '/execute/',
      headers: { accept: 'application/n-triples' },
      payload: {
        targetId: queryGroup.id,
        arguments: [
          {
            head: { vars: ['targetExperience'] },
            arguments: { bindings: [{ targetExperience: { type: 'literal', value: 'senior' } }] },
          },
        ],
        // One graph for the one declared input: routing is by position, so the
        // run states what it supplies and the group says where it goes.
        dataGraphs: [
          { dataGraphInline: SUPPLIED_GRAPH, dataGraphInlineFormat: 'text/turtle' },
        ],
      },
    });

    expect(executeResponse.statusCode).toBe(200);
    // Both inputs are visible in the answer: the graph the caller handed in and
    // the rows the argument selected.
    expect(executeResponse.body).toContain('handed-in');
    expect(executeResponse.body).toContain('queried');
  });

  it('refuses more data graphs than the start node has inputs for', { timeout: 15000 }, async () => {
    const executeResponse = await context.app.inject({
      method: 'POST',
      url: '/execute/',
      headers: { accept: 'application/n-triples' },
      payload: {
        targetId: queryGroup.id,
        arguments: [
          {
            head: { vars: ['targetExperience'] },
            arguments: { bindings: [{ targetExperience: { type: 'literal', value: 'senior' } }] },
          },
        ],
        dataGraphs: [
          { dataGraphInline: SUPPLIED_GRAPH, dataGraphInlineFormat: 'text/turtle' },
          { dataGraphInline: SUPPLIED_GRAPH, dataGraphInlineFormat: 'text/turtle' },
        ],
      },
    });

    expect(executeResponse.statusCode).toBeGreaterThanOrEqual(400);
    expect(executeResponse.body).toContain('declares 1');
  });
});
