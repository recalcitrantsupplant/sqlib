import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { QueryTypeIri } from '../../../src/constants/queryTypes.js';
import { ScenarioTestBaseUnmocked, type ScenarioTestContext } from '../fixtures/scenario-test-base-unmocked.js';

/**
 * Scenario 0: Single Node Query Group (Start → SELECT → End)
 *
 * This covers the minimal happy path for query group creation and execution.
 * We create a single SELECT query, wire it between the auto-generated start/end nodes,
 * execute the group, and assert that SPARQL JSON results flow back.
 */
describe('Single Node Query Group', () => {
  let context: ScenarioTestContext;
  let queryGroup: any;

  beforeAll(async () => {
    context = await ScenarioTestBaseUnmocked.createTestContext('single-node-basic');

    await ScenarioTestBaseUnmocked.loadTurtleDataIntoBackend(context, 'people-skills-projects.ttl');
    await ScenarioTestBaseUnmocked.createOxigraphBackend(context, 'Single Node Backend');
    await ScenarioTestBaseUnmocked.createLibrary(context, 'Single Node Library');
    queryGroup = await ScenarioTestBaseUnmocked.createQueryGroup(context, 'Single Node Flow');
  }, 30000);

  afterAll(async () => {
    await ScenarioTestBaseUnmocked.cleanupTestContext(context);
  });

  it('creates and executes a single execution node chain', { timeout: 15000 }, async () => {
    const selectQueryString = `
      PREFIX foaf: <http://xmlns.com/foaf/0.1/>
      PREFIX ex: <http://example.org/>

      SELECT ?person ?skill WHERE {
        ?person a foaf:Person ;
                ex:hasSkill ?skill .
      }
      ORDER BY ?person
      LIMIT 5
    `;

    // Create the SELECT query shell
    const queryResponse = await context.app.inject({
      method: 'POST',
      url: '/queries/',
      payload: {
        name: 'Single Node SELECT',
        description: 'Baseline SELECT query for single node scenario',
        isPartOf: [context.libraryId]
      }
    });
    expect(queryResponse.statusCode).toBe(201);
    const queryEntity = queryResponse.json();

    // Create the SELECT query version
    const versionResponse = await context.app.inject({
      method: 'POST',
      url: `/queries/${encodeURIComponent(queryEntity.id)}/v`,
      payload: {
        queryVersion: {
          queryString: selectQueryString,
          queryType: QueryTypeIri.select
        }
      }
    });
    expect(versionResponse.statusCode).toBe(201);
    const selectVersion = versionResponse.json();

    const singleNodeId = 'urn:ui-temp:single-node-select';

    // Create a query group version with a single execution node
    const queryGroupVersionResponse = await context.app.inject({
      method: 'POST',
      url: `/query-groups/${encodeURIComponent(queryGroup.id)}/v`,
      payload: {
        queryGroupVersion: { comment: 'Single node baseline' },
        endNode: {
          mediaType: 'application/sparql-results+json'
        },
        executionNodes: [
          {
            id: singleNodeId,
            nodeType: 'QueryNode',
            queryId: selectVersion.queryVersion.id,
            backendId: context.backendId,
            outputs: [selectVersion.queryVersion.inferredOutputs[0]]
          }
        ],
        edges: [
          {
            id: 'urn:ui-temp:edge-start',
            sourceNodeId: 'urn:__START__',
            targetNodeId: singleNodeId,
            dataFlowType: 'CONTROL_FLOW'
          },
          {
            id: 'urn:ui-temp:edge-end',
            sourceNodeId: singleNodeId,
            targetNodeId: 'urn:__END__',
            dataFlowType: 'VARIABLE_BINDINGS',
            sourceOutputId: selectVersion.queryVersion.inferredOutputs[0],
            targetInputId: selectVersion.queryVersion.inferredOutputs[0]
          }
        ]
      }
    });

    if (queryGroupVersionResponse.statusCode !== 201) {
      console.error('Query group version creation failed:', queryGroupVersionResponse.json());
    }
    expect(queryGroupVersionResponse.statusCode).toBe(201);

    const createdVersion = queryGroupVersionResponse.json();

    expect(createdVersion.queryGroupVersion.executionNodes.length).toBe(1);
    expect(createdVersion.queryGroupVersion.edges.length).toBe(2);

    const iriMap = createdVersion.iriMap;
    expect(iriMap['urn:__START__']).toMatch(/^urn:sqlib:start-node:/);
    expect(iriMap['urn:__END__']).toMatch(/^urn:sqlib:end-node:/);
    expect(iriMap[singleNodeId]).toMatch(/^urn:sqlib:node:/);

    // Make this version the current version
    const updateGroupResponse = await context.app.inject({
      method: 'PUT',
      url: `/query-groups/${encodeURIComponent(queryGroup.id)}`,
      payload: {
        name: queryGroup.name,
        isPartOf: queryGroup.isPartOf,
        currentVersion: createdVersion.queryGroupVersion.id
      }
    });
    expect(updateGroupResponse.statusCode).toBe(200);

    // Execute the query group
    const executeResponse = await context.app.inject({
      method: 'POST',
      url: '/execute/',
      headers: {
        accept: 'application/sparql-results+json'
      },
      payload: {
        targetId: queryGroup.id
      }
    });

    if (executeResponse.statusCode !== 200) {
      console.error('Execute failed:', executeResponse.json());
    }
    expect(executeResponse.statusCode).toBe(200);

    const result = executeResponse.json();
    expect(result.head).toBeDefined();
    expect(result.head.vars).toContain('person');
    expect(result.head.vars).toContain('skill');
    expect(result.results.bindings.length).toBeGreaterThan(0);

    const detailedResponse = await context.app.inject({
      method: 'POST',
      url: '/execute/',
      headers: { accept: 'application/sparql-results+json' },
      payload: { targetId: queryGroup.id, nodeDetail: 'results' },
    });

    expect(detailedResponse.statusCode).toBe(200);
    const detailed = detailedResponse.json();
    expect(detailed.result).toEqual(result);
    expect(detailed.nodes).toEqual([
      expect.objectContaining({
        nodeId: iriMap[singleNodeId],
        status: 'ok',
        rowCount: result.results.bindings.length,
        result: expect.objectContaining({ results: expect.any(Object) }),
      }),
    ]);
    expect(detailedResponse.headers['server-timing']).toContain('db;dur=');
    expect(detailedResponse.headers['server-timing']).toContain('app;dur=');
    expect(detailedResponse.headers['server-timing']).toContain('node0;dur=');
  });
});
