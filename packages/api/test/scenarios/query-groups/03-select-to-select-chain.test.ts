import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { QueryTypeIri } from '../../../src/constants/queryTypes.js';
import { ScenarioTestBaseUnmocked, type ScenarioTestContext } from '../fixtures/scenario-test-base-unmocked.js';

/**
 * Scenario 3: SELECT → SELECT Chain (Variable Bindings)
 *
 * Complexity added from simple-ab-integration:
 * - Uses SELECT → SELECT instead of SELECT → CONSTRUCT
 * - Tests VARIABLE_BINDINGS flowing between two SELECT queries
 * - Demonstrates tuple-based query chaining with positional mapping
 *
 * Expected flow:
 * 1. First SELECT query outputs variables (?person, ?skill)
 * 2. Second SELECT query has VALUES (?p, ?s) UNDEF placeholders
 * 3. ExecutionEngine maps ?person → ?p and ?skill → ?s positionally
 * 4. Final result is SPARQL JSON from second SELECT
 */
describe('SELECT → SELECT Chain (Variable Bindings)', () => {
  let context: ScenarioTestContext;
  let backend: any;
  let library: any;
  let queryGroup: any;

  beforeAll(async () => {
    context = await ScenarioTestBaseUnmocked.createTestContext('select-to-select-chain');

    // Load people-skills data
    await ScenarioTestBaseUnmocked.loadTurtleDataIntoBackend(context, 'people-skills-projects.ttl');
    backend = await ScenarioTestBaseUnmocked.createOxigraphBackend(context, 'People Skills Backend');
    library = await ScenarioTestBaseUnmocked.createLibrary(context, 'Skills Library');
    queryGroup = await ScenarioTestBaseUnmocked.createQueryGroup(context, 'People Skills Chain');
  }, 30000);

  afterAll(async () => {
    await ScenarioTestBaseUnmocked.cleanupTestContext(context);
  });

  it('should create and execute SELECT → SELECT query chain', { timeout: 15000 }, async () => {
    // Query 1: SELECT people and their skills
    const query1String = `
      PREFIX ex: <http://example.org/>
      PREFIX foaf: <http://xmlns.com/foaf/0.1/>
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>

      SELECT ?person ?skill WHERE {
        ?person a foaf:Person ;
                ex:hasSkill ?skill .
      }
      ORDER BY ?person
      LIMIT 5
    `;

    // Query 2: SELECT skill details given person and skill inputs
    const query2String = `
      PREFIX ex: <http://example.org/>
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>

      SELECT ?p ?skillLabel ?category WHERE {
        # Input tuple with positional mapping from upstream
        VALUES (?p ?s) { (UNDEF UNDEF) }

        ?s rdfs:label ?skillLabel ;
           ex:category ?category .
      }
      ORDER BY ?p ?skillLabel
    `;

    // Create Query 1
    const query1Response = await context.app.inject({
      method: 'POST',
      url: '/queries/',
      payload: {
        name: 'Get People with Skills',
        description: 'First query in chain',
        isPartOf: [context.libraryId]
      }
    });
    expect(query1Response.statusCode).toBe(201);
    const query1Entity = query1Response.json();

    // Create Query 1 Version
    const query1VersionResponse = await context.app.inject({
      method: 'POST',
      url: `/queries/${encodeURIComponent(query1Entity.id)}/v`,
      payload: {
        queryVersion: {
          queryString: query1String,
          queryType: QueryTypeIri.select,
        }
      }
    });
    expect(query1VersionResponse.statusCode).toBe(201);
    const query1Version = query1VersionResponse.json();

    // Create Query 2
    const query2Response = await context.app.inject({
      method: 'POST',
      url: '/queries/',
      payload: {
        name: 'Get Skill Details',
        description: 'Second query in chain',
        isPartOf: [context.libraryId]
      }
    });
    expect(query2Response.statusCode).toBe(201);
    const query2Entity = query2Response.json();

    // Create Query 2 Version
    const query2VersionResponse = await context.app.inject({
      method: 'POST',
      url: `/queries/${encodeURIComponent(query2Entity.id)}/v`,
      payload: {
        queryVersion: {
          queryString: query2String,
          queryType: QueryTypeIri.select,
        }
      }
    });
    expect(query2VersionResponse.statusCode).toBe(201);
    const query2Version = query2VersionResponse.json();

    // Verify Query 1 has outputs
    expect(query1Version.queryVersion.inferredOutputs).toBeDefined();
    expect(query1Version.outputs.length).toBe(2); // ?person, ?skill

    // Verify Query 2 has inputs and outputs
    expect(query2Version.queryVersion.inferredInputs).toBeDefined();
    expect(query2Version.inputs.length).toBe(2); // ?p, ?s
    expect(query2Version.outputs.length).toBe(3); // ?p, ?skillLabel, ?category

    // Create Query Group Version with SELECT → SELECT chain
    const query1NodeId = 'urn:ui-temp:select-people-skills';
    const query2NodeId = 'urn:ui-temp:select-skill-details';

    const queryGroupVersionResponse = await context.app.inject({
      method: 'POST',
      url: `/query-groups/${encodeURIComponent(queryGroup.id)}/v`,
      payload: {
        queryGroupVersion: {},
        endNode: {
          mediaType: 'application/sparql-results+json'
        },
        executionNodes: [
          {
            id: query1NodeId,
            nodeType: 'QueryNode',
            queryId: query1Version.queryVersion.id,
            backendId: context.backendId,
            outputs: [query1Version.queryVersion.inferredOutputs[0]]
          },
          {
            id: query2NodeId,
            nodeType: 'QueryNode',
            queryId: query2Version.queryVersion.id,
            backendId: context.backendId,
            inputs: [query2Version.queryVersion.inferredInputs[0]],
            outputs: [query2Version.queryVersion.inferredOutputs[0]]
          }
        ],
        edges: [
          {
            id: 'urn:ui-temp:edge-1',
            sourceNodeId: 'urn:__START__',
            targetNodeId: query1NodeId,
            dataFlowType: 'CONTROL_FLOW',
          },
          {
            id: 'urn:ui-temp:edge-2',
            sourceNodeId: query1NodeId,
            targetNodeId: query2NodeId,
            dataFlowType: 'VARIABLE_BINDINGS',
            sourceOutputId: query1Version.queryVersion.inferredOutputs[0],
            targetInputId: query2Version.queryVersion.inferredInputs[0]
          },
          {
            id: 'urn:ui-temp:edge-3',
            sourceNodeId: query2NodeId,
            targetNodeId: 'urn:__END__',
            dataFlowType: 'VARIABLE_BINDINGS',
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
    expect(iriMap[query1NodeId]).toMatch(/^urn:sqlib:node:/);
    expect(iriMap[query2NodeId]).toMatch(/^urn:sqlib:node:/);
    expect(iriMap['urn:ui-temp:edge-1']).toMatch(/^urn:sqlib:edge:/);
    expect(iriMap['urn:ui-temp:edge-2']).toMatch(/^urn:sqlib:edge:/);
    expect(iriMap['urn:ui-temp:edge-3']).toMatch(/^urn:sqlib:edge:/);

    // Set currentVersion
    const setCurrentVersionResponse = await context.app.inject({
      method: 'PUT',
      url: `/query-groups/${encodeURIComponent(queryGroup.id)}`,
      payload: {
        name: queryGroup.name,
        isPartOf: queryGroup.isPartOf,
        currentVersion: queryGroupVersion.queryGroupVersion.id
      }
    });
    expect(setCurrentVersionResponse.statusCode).toBe(200);

    // Execute the query group
    const executeResponse = await context.app.inject({
      method: 'POST',
      url: '/execute/',
      headers: {
        'accept': 'application/sparql-results+json'
      },
      payload: {
        targetId: queryGroup.id
      }
    });

    console.log('Execute Response:', executeResponse.statusCode, executeResponse.body);
    expect(executeResponse.statusCode).toBe(200);
    const result = executeResponse.json();

    // Verify we get SPARQL JSON results
    expect(result.head).toBeDefined();
    expect(result.results).toBeDefined();
    expect(result.head.vars).toContain('p');
    expect(result.head.vars).toContain('skillLabel');
    expect(result.head.vars).toContain('category');
    expect(result.results.bindings.length).toBeGreaterThan(0);

    console.log('✅ SELECT → SELECT chain executed successfully');
    console.log(`📊 Result rows: ${result.results.bindings.length}`);
  });
});