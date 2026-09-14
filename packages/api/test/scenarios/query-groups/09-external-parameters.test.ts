import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ScenarioTestBaseUnmocked, type ScenarioTestContext } from '../fixtures/scenario-test-base-unmocked.js';

/**
 * Scenario 9: External Parameters via StartNode (Simple Mode)
 *
 * Tests the SIMPLE mode of external parameters:
 * - StartNode.outputs directly references query's inferredInputs (1:1 passthrough)
 * - No custom output tuples needed
 * - Single consumer pattern (StartNode feeds only ONE query)
 *
 * Expected flow:
 * 1. StartNode outputs = [query1.inferredInputs[0]]
 * 2. Edge: StartNode → Query1 uses same tuple for source and target (passthrough)
 * 3. Results flow through remaining queries in the chain
 *
 * This demonstrates the simplest way to parameterize a query group
 * when you don't need variable renaming or fan-out.
 */
describe('External Parameters via StartNode', () => {
  let context: ScenarioTestContext;
  let backend: any;
  let library: any;
  let queryGroup: any;

  beforeAll(async () => {
    context = await ScenarioTestBaseUnmocked.createTestContext('external-parameters');

    await ScenarioTestBaseUnmocked.loadTurtleDataIntoBackend(context, 'people-skills-projects.ttl');
    backend = await ScenarioTestBaseUnmocked.createOxigraphBackend(context, 'Params Backend');
    library = await ScenarioTestBaseUnmocked.createLibrary(context, 'Params Library');
    queryGroup = await ScenarioTestBaseUnmocked.createQueryGroup(context, 'Parameterized Workflow');
  }, 30000);

  afterAll(async () => {
    await ScenarioTestBaseUnmocked.cleanupTestContext(context);
  });

  it('should accept and use external parameters from StartNode', { timeout: 15000 }, async () => {
    // Query 1: Filter people by experience level (parameter comes from StartNode)
    const query1String = `
      PREFIX ex: <http://example.org/>
      PREFIX foaf: <http://xmlns.com/foaf/0.1/>

      SELECT ?person ?name WHERE {
        # This VALUES clause will be populated by StartNode parameters
        VALUES (?targetExperience) { (UNDEF) }

        ?person a foaf:Person ;
                foaf:name ?name ;
                ex:experienceLevel ?targetExperience .
      }
    `;

    // Query 2: Get their skills
    const query2String = `
      PREFIX ex: <http://example.org/>
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>

      SELECT ?p ?skillLabel WHERE {
        VALUES (?p ?n) { (UNDEF UNDEF) }

        ?p ex:hasSkill ?skill .
        ?skill rdfs:label ?skillLabel .
      }
    `;

    // Query 3: Generate report
    const query3String = `
      PREFIX ex: <http://example.org/>

      CONSTRUCT {
        ?report ex:person ?person ;
               ex:hasSkill ?skill ;
               ex:generatedAt ?timestamp .
      }
      WHERE {
        VALUES (?person ?skill) { (UNDEF UNDEF) }

        BIND(IRI(CONCAT("http://example.org/report/", ENCODE_FOR_URI(STR(?person)), "-", ENCODE_FOR_URI(STR(?skill)))) AS ?report)
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

    const query1Version = await createQuery('Filter by Experience', query1String);
    const query2Version = await createQuery('Get Skills', query2String);
    const query3Version = await createQuery('Generate Report', query3String);

    // Query 1 has input tuple for ?targetExperience
    expect(query1Version.queryVersion.inferredInputs).toBeDefined();
    expect(query1Version.queryVersion.inferredInputs.length).toBeGreaterThan(0);
    const query1InputTuple = query1Version.queryVersion.inferredInputs[0];

    const node1Id = 'urn:ui-temp:filter-people';
    const node2Id = 'urn:ui-temp:get-skills';
    const node3Id = 'urn:ui-temp:generate-report';

    const queryGroupVersionResponse = await context.app.inject({
      method: 'POST',
      url: `/query-groups/${encodeURIComponent(queryGroup.id)}/v`,
      payload: {
        queryGroupVersion: {},
        // SIMPLE MODE: StartNode.outputs directly references query1's inferredInputs
        // No custom output tuples needed - just passthrough to the single consumer
        startNode: {
          outputs: [query1InputTuple]  // Direct reference to query1's input
        },
        endNode: {
          mediaType: 'application/n-triples'
        },
        executionNodes: [
          {
            id: node1Id,
            nodeType: 'QueryNode',
            queryId: query1Version.queryVersion.id,
            backendId: context.backendId,
            inputs: [query1InputTuple],
            outputs: [query1Version.queryVersion.inferredOutputs[0]]
          },
          {
            id: node2Id,
            nodeType: 'QueryNode',
            queryId: query2Version.queryVersion.id,
            backendId: context.backendId,
            inputs: [query2Version.queryVersion.inferredInputs[0]],
            outputs: [query2Version.queryVersion.inferredOutputs[0]]
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
          // StartNode → Query1: Simple passthrough (same tuple for source and target)
          {
            id: 'urn:ui-temp:edge-1',
            sourceNodeId: 'urn:__START__',
            targetNodeId: node1Id,
            dataFlowType: 'VARIABLE_BINDINGS',
            sourceOutputId: query1InputTuple,  // Same as targetInputId (passthrough)
            targetInputId: query1InputTuple
          },
          {
            id: 'urn:ui-temp:edge-2',
            sourceNodeId: node1Id,
            targetNodeId: node2Id,
            dataFlowType: 'VARIABLE_BINDINGS',
            sourceOutputId: query1Version.queryVersion.inferredOutputs[0],
            targetInputId: query2Version.queryVersion.inferredInputs[0]
          },
          {
            id: 'urn:ui-temp:edge-3',
            sourceNodeId: node2Id,
            targetNodeId: node3Id,
            dataFlowType: 'VARIABLE_BINDINGS',
            sourceOutputId: query2Version.queryVersion.inferredOutputs[0],
            targetInputId: query3Version.queryVersion.inferredInputs[0]
          },
          {
            id: 'urn:ui-temp:edge-4',
            sourceNodeId: node3Id,
            targetNodeId: 'urn:__END__',
            dataFlowType: 'RDF_GRAPH',
            sourceOutputId: query3Version.queryVersion.inferredOutputs[0],
            targetInputId: query3Version.queryVersion.inferredOutputs[0]
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

    await context.app.inject({
      method: 'PUT',
      url: `/query-groups/${encodeURIComponent(queryGroup.id)}`,
      payload: {
        name: queryGroup.name,
        isPartOf: queryGroup.isPartOf,
        currentVersion: queryGroupVersion.queryGroupVersion.id
      }
    });

    // Execute with external parameter: experienceLevel = "senior"
    const executeResponse = await context.app.inject({
      method: 'POST',
      url: '/execute/',
      headers: { 'accept': 'application/n-triples' },
      payload: {
        targetId: queryGroup.id,
        arguments: [
          {
            head: { vars: ['targetExperience'] },
            arguments: {
              bindings: [
                { targetExperience: { type: 'literal', value: 'senior' } }
              ]
            }
          }
        ]
      }
    });

    console.log('Execute Response:', executeResponse.statusCode, executeResponse.body);
    expect(executeResponse.statusCode).toBe(200);
    const rdfResult = executeResponse.body;

    expect(rdfResult).toContain('person');
    expect(rdfResult).toContain('hasSkill');
    expect(rdfResult).toContain('generatedAt');

    console.log('✅ External parameters via StartNode executed successfully');
    console.log(`📊 RDF output length: ${rdfResult.length} characters`);
  });
});
