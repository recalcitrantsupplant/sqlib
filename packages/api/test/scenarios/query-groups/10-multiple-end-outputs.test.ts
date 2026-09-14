import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { QueryTypeIri } from '../../../src/constants/queryTypes.js';
import { ScenarioTestBaseUnmocked, type ScenarioTestContext } from '../fixtures/scenario-test-base-unmocked.js';

/**
 * Scenario 10: Multiple EndNode Outputs
 *
 * Complexity added from external parameters:
 * - Multiple predecessor nodes feed EndNode
 * - Each produces different output types
 * - Tests EndNode's multi-predecessor handling
 *
 * Expected flow:
 * 1. Query 1 produces SPARQL JSON results
 * 2. Query 2 produces RDF graph
 * 3. Both flow to EndNode
 * 4. EndNode should merge/select appropriate output based on mediaType
 *
 * According to docs:
 * - Single predecessor: Returns that node's result
 * - Multiple predecessors with RDF: Concatenates RDF
 * - Multiple predecessors with mixed types: Should error (not yet supported)
 *
 * This test explores the documented multi-predecessor behavior.
 */
describe('Multiple EndNode Outputs', () => {
  let context: ScenarioTestContext;
  let backend: any;
  let library: any;
  let queryGroup: any;

  beforeAll(async () => {
    context = await ScenarioTestBaseUnmocked.createTestContext('multiple-end-outputs');

    await ScenarioTestBaseUnmocked.loadTurtleDataIntoBackend(context, 'people-skills-projects.ttl');
    backend = await ScenarioTestBaseUnmocked.createOxigraphBackend(context, 'Multi-End Backend');
    library = await ScenarioTestBaseUnmocked.createLibrary(context, 'Multi-End Library');
    queryGroup = await ScenarioTestBaseUnmocked.createQueryGroup(context, 'Multi-End Workflow');
  }, 30000);

  afterAll(async () => {
    await ScenarioTestBaseUnmocked.cleanupTestContext(context);
  });

  it('should handle multiple RDF outputs to EndNode', { timeout: 15000 }, async () => {
    // Query 1: CONSTRUCT person metadata
    const query1String = `
      PREFIX ex: <http://example.org/>
      PREFIX foaf: <http://xmlns.com/foaf/0.1/>

      CONSTRUCT {
        ?person ex:category "person" ;
               ex:indexed ?timestamp .
      }
      WHERE {
        ?person a foaf:Person .

        BIND("2026-01-01T00:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime> AS ?timestamp)
      }
      LIMIT 2
    `;

    // Query 2: CONSTRUCT project metadata (independent, parallel)
    const query2String = `
      PREFIX ex: <http://example.org/>

      CONSTRUCT {
        ?project ex:category "project" ;
                ex:indexed ?timestamp .
      }
      WHERE {
        ?project a ex:Project .

        BIND("2026-01-01T00:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime> AS ?timestamp)
      }
      LIMIT 2
    `;

    const createQuery = async (name: string, queryString: string) => {
      const queryResponse = await context.app.inject({
        method: 'POST',
        url: '/queries/',
        payload: { name, isPartOf: [context.libraryId] }
      });
      const queryEntity = queryResponse.json();

      const versionResponse = await context.app.inject({
        method: 'POST',
        url: `/queries/${encodeURIComponent(queryEntity.id)}/v`,
        payload: {
          queryVersion: {
            queryString,
            queryType: QueryTypeIri.construct,
          }
        }
      });
      return versionResponse.json();
    };

    const query1Version = await createQuery('Person Metadata', query1String);
    const query2Version = await createQuery('Project Metadata', query2String);

    const node1Id = 'urn:ui-temp:person-construct';
    const node2Id = 'urn:ui-temp:project-construct';

    const queryGroupVersionResponse = await context.app.inject({
      method: 'POST',
      url: `/query-groups/${encodeURIComponent(queryGroup.id)}/v`,
      payload: {
        queryGroupVersion: {},
        endNode: {
          mediaType: 'application/n-triples'
        },
        executionNodes: [
          {
            id: node1Id,
            nodeType: 'QueryNode',
            queryId: query1Version.queryVersion.id,
            backendId: context.backendId,
            outputs: [query1Version.queryVersion.inferredOutputs[0]]
          },
          {
            id: node2Id,
            nodeType: 'QueryNode',
            queryId: query2Version.queryVersion.id,
            backendId: context.backendId,
            outputs: [query2Version.queryVersion.inferredOutputs[0]]
          }
        ],
        edges: [
          // Both queries start independently
          {
            id: 'urn:ui-temp:edge-1',
            sourceNodeId: 'urn:__START__',
            targetNodeId: node1Id,
            dataFlowType: 'CONTROL_FLOW'
          },
          {
            id: 'urn:ui-temp:edge-2',
            sourceNodeId: 'urn:__START__',
            targetNodeId: node2Id,
            dataFlowType: 'CONTROL_FLOW'
          },
          // Both feed their RDF outputs to EndNode
          {
            id: 'urn:ui-temp:edge-3',
            sourceNodeId: node1Id,
            targetNodeId: 'urn:__END__',
            dataFlowType: 'RDF_GRAPH',
            sourceOutputId: query1Version.queryVersion.inferredOutputs[0],
            targetInputId: query1Version.queryVersion.inferredOutputs[0]
          },
          {
            id: 'urn:ui-temp:edge-4',
            sourceNodeId: node2Id,
            targetNodeId: 'urn:__END__',
            dataFlowType: 'RDF_GRAPH',
            sourceOutputId: query2Version.queryVersion.inferredOutputs[0],
            targetInputId: query2Version.queryVersion.inferredOutputs[0]
          }
        ]
      }
    });

    console.log('Query Group Version Response:', queryGroupVersionResponse.statusCode, queryGroupVersionResponse.body);
    expect(queryGroupVersionResponse.statusCode).toBe(201);
    const queryGroupVersion = queryGroupVersionResponse.json();

    const iriMap = queryGroupVersion.iriMap;
    expect(iriMap).toBeDefined();
    expect(iriMap['urn:__START__']).toMatch(/^urn:sqlib:start-node:/);
    expect(iriMap['urn:__END__']).toMatch(/^urn:sqlib:end-node:/);
    expect(iriMap[node1Id]).toMatch(/^urn:sqlib:node:/);
    expect(iriMap[node2Id]).toMatch(/^urn:sqlib:node:/);
    expect(iriMap['urn:ui-temp:edge-1']).toMatch(/^urn:sqlib:edge:/);
    expect(iriMap['urn:ui-temp:edge-2']).toMatch(/^urn:sqlib:edge:/);
    expect(iriMap['urn:ui-temp:edge-3']).toMatch(/^urn:sqlib:edge:/);
    expect(iriMap['urn:ui-temp:edge-4']).toMatch(/^urn:sqlib:edge:/);

    // Verify multiple predecessors to END
    expect(queryGroupVersion.queryGroupVersion.executionNodes.length).toBe(2);
    expect(queryGroupVersion.queryGroupVersion.edges.length).toBe(4); // 2 from START, 2 to END

    await context.app.inject({
      method: 'PUT',
      url: `/query-groups/${encodeURIComponent(queryGroup.id)}`,
      payload: {
        name: queryGroup.name,
        isPartOf: queryGroup.isPartOf,
        currentVersion: queryGroupVersion.queryGroupVersion.id
      }
    });

    const executeResponse = await context.app.inject({
      method: 'POST',
      url: '/execute/',
      headers: { 'accept': 'application/n-triples' },
      payload: {
        targetId: queryGroup.id
      }
    });

    console.log('Execute Response:', executeResponse.statusCode, executeResponse.body);
    expect(executeResponse.statusCode).toBe(200);
    const rdfResult = executeResponse.body;

    // Should contain data from BOTH queries (RDF concatenation)
    expect(rdfResult).toContain('category');
    expect(rdfResult).toContain('indexed');
    // Verify both "person" and "project" categories are present
    expect(rdfResult).toContain('"person"');
    expect(rdfResult).toContain('"project"');

    console.log('✅ Multiple RDF outputs to EndNode executed successfully');
    console.log(`📊 RDF output length: ${rdfResult.length} characters`);
    console.log('🔍 Merged RDF from both CONSTRUCT queries');
  });
});