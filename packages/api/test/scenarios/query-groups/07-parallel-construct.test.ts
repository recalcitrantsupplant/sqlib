import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ScenarioTestBaseUnmocked, type ScenarioTestContext } from '../fixtures/scenario-test-base-unmocked.js';

/**
 * Scenario 7: Parallel CONSTRUCT Outputs from Shared Source
 *
 * Complexity added from multiple input tuples:
 * - Multiple CONSTRUCT queries consuming same upstream source
 * - Both produce RDF_GRAPH outputs to EndNode
 * - Tests parallel RDF generation from shared variable bindings
 * - Streaming N-Triples results from multiple CONSTRUCT queries
 *
 * Expected flow:
 * 1. Query 1: SELECT people → tuple output
 * 2. Query 2: CONSTRUCT enriched person RDF (consumes Query 1)
 *    - RDF output goes to EndNode
 * 3. Query 3: CONSTRUCT person metadata RDF (also consumes Query 1)
 *    - RDF output also goes to EndNode
 *
 * Note: This tests parallel RDF construction from shared upstream data,
 * with EndNode merging/concatenating both RDF outputs.
 */
describe('Parallel CONSTRUCT Outputs from Shared Source', () => {
  let context: ScenarioTestContext;
  let backend: any;
  let library: any;
  let queryGroup: any;

  beforeAll(async () => {
    context = await ScenarioTestBaseUnmocked.createTestContext('mixed-output-types');

    await ScenarioTestBaseUnmocked.loadTurtleDataIntoBackend(context, 'people-skills-projects.ttl');
    backend = await ScenarioTestBaseUnmocked.createOxigraphBackend(context, 'Mixed Output Backend');
    library = await ScenarioTestBaseUnmocked.createLibrary(context, 'Mixed Output Library');
    queryGroup = await ScenarioTestBaseUnmocked.createQueryGroup(context, 'Mixed Output Workflow');
  }, 30000);

  afterAll(async () => {
    await ScenarioTestBaseUnmocked.cleanupTestContext(context);
  });

  it('should stream N-Triples from parallel CONSTRUCT queries consuming same source', { timeout: 15000 }, async () => {
    // Query 1: SELECT people
    const query1String = `
      PREFIX foaf: <http://xmlns.com/foaf/0.1/>

      SELECT ?person WHERE {
        ?person a foaf:Person .
      }
      LIMIT 2
    `;

    // Query 2: CONSTRUCT enriched RDF
    // This query has input tuple AND produces RDF output
    const query2String = `
      PREFIX ex: <http://example.org/>
      PREFIX foaf: <http://xmlns.com/foaf/0.1/>

      CONSTRUCT {
        ?p ex:enriched true ;
           ex:processedAt ?timestamp ;
           ex:status "active" .
      }
      WHERE {
        VALUES (?p) { (UNDEF) }

        BIND("2026-01-01T00:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime> AS ?timestamp)
      }
    `;

    // Query 3: CONSTRUCT person metadata (parallel to Query 2)
    // This demonstrates parallel RDF construction from the same source
    const query3String = `
      PREFIX ex: <http://example.org/>
      PREFIX foaf: <http://xmlns.com/foaf/0.1/>

      CONSTRUCT {
        ?p ex:category "person" ;
           ex:indexed ?timestamp ;
           ex:hasName ?name .
      }
      WHERE {
        VALUES (?p) { (UNDEF) }

        ?p foaf:name ?name .
        BIND("2026-01-01T00:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime> AS ?timestamp)
      }
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
          }
        }
      });
      return versionResponse.json();
    };

    const query1Version = await createQuery('Get People', query1String);
    const query2Version = await createQuery('Enrich RDF', query2String);
    const query3Version = await createQuery('Person Metadata', query3String);

    // Verify Query 2 (CONSTRUCT) has both input tuple AND RDF output
    expect(query2Version.queryVersion.inferredInputs).toBeDefined();
    expect(query2Version.queryVersion.inferredInputs.length).toBeGreaterThan(0);
    expect(query2Version.queryVersion.inferredOutputs).toBeDefined();
    const rdfOutput2 = query2Version.queryVersion.inferredOutputs.find((outputId: string) =>
      outputId.includes('triples-quads')
    );
    expect(rdfOutput2).toBeDefined();

    // Verify Query 3 (CONSTRUCT) also has input tuple AND RDF output
    expect(query3Version.queryVersion.inferredInputs).toBeDefined();
    expect(query3Version.queryVersion.inferredInputs.length).toBeGreaterThan(0);
    expect(query3Version.queryVersion.inferredOutputs).toBeDefined();
    const rdfOutput3 = query3Version.queryVersion.inferredOutputs.find((outputId: string) =>
      outputId.includes('triples-quads')
    );
    expect(rdfOutput3).toBeDefined();

    // Create Query Group Version
    const node1Id = 'urn:ui-temp:source-people';
    const node2Id = 'urn:ui-temp:enrich-rdf';
    const node3Id = 'urn:ui-temp:person-metadata';

    const queryGroupVersionResponse = await context.app.inject({
      method: 'POST',
      url: `/query-groups/${encodeURIComponent(queryGroup.id)}/v`,
      payload: {
        queryGroupVersion: {},
        endNode: {
          // Final output is RDF from the CONSTRUCT query
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
            inputs: [query2Version.queryVersion.inferredInputs[0]],
            outputs: query2Version.queryVersion.inferredOutputs // All outputs
          },
          {
            id: node3Id,
            nodeType: 'QueryNode',
            queryId: query3Version.queryVersion.id,
            backendId: context.backendId,
            inputs: [query3Version.queryVersion.inferredInputs[0]],
            outputs: [query3Version.queryVersion.inferredOutputs[0]]
          }
        ],
        edges: [
          {
            id: 'urn:ui-temp:edge-1',
            sourceNodeId: 'urn:__START__',
            targetNodeId: node1Id,
            dataFlowType: 'CONTROL_FLOW'
          },
          // Query 1 feeds Query 2 (CONSTRUCT)
          {
            id: 'urn:ui-temp:edge-2',
            sourceNodeId: node1Id,
            targetNodeId: node2Id,
            dataFlowType: 'VARIABLE_BINDINGS',
            sourceOutputId: query1Version.queryVersion.inferredOutputs[0],
            targetInputId: query2Version.queryVersion.inferredInputs[0]
          },
          // Query 1 ALSO feeds Query 3 (parallel consumption)
          {
            id: 'urn:ui-temp:edge-3',
            sourceNodeId: node1Id,
            targetNodeId: node3Id,
            dataFlowType: 'VARIABLE_BINDINGS',
            sourceOutputId: query1Version.queryVersion.inferredOutputs[0],
            targetInputId: query3Version.queryVersion.inferredInputs[0]
          },
          // Query 2 RDF output goes to END
          {
            id: 'urn:ui-temp:edge-4',
            sourceNodeId: node2Id,
            targetNodeId: 'urn:__END__',
            dataFlowType: 'RDF_GRAPH',
            sourceOutputId: rdfOutput2,
            targetInputId: rdfOutput2
          },
          // Query 3 RDF output ALSO goes to END (parallel outputs)
          {
            id: 'urn:ui-temp:edge-5',
            sourceNodeId: node3Id,
            targetNodeId: 'urn:__END__',
            dataFlowType: 'RDF_GRAPH',
            sourceOutputId: rdfOutput3,
            targetInputId: rdfOutput3
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
    expect(iriMap[node3Id]).toMatch(/^urn:sqlib:node:/);
    expect(iriMap['urn:ui-temp:edge-1']).toMatch(/^urn:sqlib:edge:/);
    expect(iriMap['urn:ui-temp:edge-2']).toMatch(/^urn:sqlib:edge:/);
    expect(iriMap['urn:ui-temp:edge-3']).toMatch(/^urn:sqlib:edge:/);
    expect(iriMap['urn:ui-temp:edge-4']).toMatch(/^urn:sqlib:edge:/);
    expect(iriMap['urn:ui-temp:edge-5']).toMatch(/^urn:sqlib:edge:/);

    expect(queryGroupVersion.queryGroupVersion.executionNodes.length).toBe(3);

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

    // Should contain data from BOTH CONSTRUCT queries
    // From Query 2:
    expect(rdfResult).toContain('enriched');
    expect(rdfResult).toContain('status');
    // From Query 3:
    expect(rdfResult).toContain('category');
    expect(rdfResult).toContain('indexed');
    expect(rdfResult).toContain('hasName');

    console.log('✅ Parallel CONSTRUCT outputs from shared source executed successfully');
    console.log(`📊 RDF output length: ${rdfResult.length} characters`);
    console.log('🔍 Merged RDF from both parallel CONSTRUCT queries');
  });
});
