import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ScenarioTestBaseUnmocked, type ScenarioTestContext } from '../fixtures/scenario-test-base-unmocked.js';

/**
 * Scenario 4: Three-Node Linear Chain
 *
 * Complexity added from SELECT → SELECT chain:
 * - Three queries in sequence: SELECT → SELECT → CONSTRUCT
 * - Tests multiple VARIABLE_BINDINGS edges in series
 * - Demonstrates data flowing through intermediate transformation
 *
 * Expected flow:
 * 1. Query 1: SELECT people with skills → outputs (?person, ?skill)
 * 2. Query 2: SELECT skill categories → outputs (?person, ?category)
 * 3. Query 3: CONSTRUCT assignments RDF → outputs RDF graph
 */
describe('Three-Node Linear Chain', () => {
  let context: ScenarioTestContext;
  let backend: any;
  let library: any;
  let queryGroup: any;

  beforeAll(async () => {
    context = await ScenarioTestBaseUnmocked.createTestContext('three-node-linear');

    await ScenarioTestBaseUnmocked.loadTurtleDataIntoBackend(context, 'people-skills-projects.ttl');
    backend = await ScenarioTestBaseUnmocked.createOxigraphBackend(context, 'Projects Backend');
    library = await ScenarioTestBaseUnmocked.createLibrary(context, 'Project Library');
    queryGroup = await ScenarioTestBaseUnmocked.createQueryGroup(context, 'Three-Step Analysis');
  }, 30000);

  afterAll(async () => {
    await ScenarioTestBaseUnmocked.cleanupTestContext(context);
  });

  it('should execute three-node linear chain', { timeout: 15000 }, async () => {
    // Query 1: Get people with skills
    const query1String = `
      PREFIX ex: <http://example.org/>
      PREFIX foaf: <http://xmlns.com/foaf/0.1/>

      SELECT ?person ?skill WHERE {
        ?person a foaf:Person ;
                ex:hasSkill ?skill .
      }
      LIMIT 3
    `;

    // Query 2: Get skill categories (takes person, skill as input)
    const query2String = `
      PREFIX ex: <http://example.org/>

      SELECT ?p ?category WHERE {
        VALUES (?p ?s) { (UNDEF UNDEF) }

        ?s ex:category ?category .
      }
    `;

    // Query 3: Generate assignment RDF (takes person, category as input)
    const query3String = `
      PREFIX ex: <http://example.org/>
      PREFIX foaf: <http://xmlns.com/foaf/0.1/>

      CONSTRUCT {
        ?assignment ex:assignedTo ?person ;
                   ex:forCategory ?cat ;
                   ex:assignedAt ?timestamp .
      }
      WHERE {
        VALUES (?person ?cat) { (UNDEF UNDEF) }

        BIND(IRI(CONCAT("http://example.org/assignment/", ENCODE_FOR_URI(STR(?person)), "-", ENCODE_FOR_URI(STR(?cat)))) AS ?assignment)
        BIND("2026-01-01T00:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime> AS ?timestamp)
      }
    `;

    // Create all three queries and versions
    const createQuery = async (name: string, queryString: string) => {
      const queryResponse = await context.app.inject({
        method: 'POST',
        url: '/queries/',
        payload: { name, isPartOf: [context.libraryId] }
      });
      expect(queryResponse.statusCode).toBe(201);
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
      expect(versionResponse.statusCode).toBe(201);
      return versionResponse.json();
    };

    const query1Version = await createQuery('Get People Skills', query1String);
    const query2Version = await createQuery('Get Skill Categories', query2String);
    const query3Version = await createQuery('Generate Assignments', query3String);

    // Create Query Group Version with three nodes
    const node1Id = 'urn:ui-temp:node-1-people-skills';
    const node2Id = 'urn:ui-temp:node-2-categories';
    const node3Id = 'urn:ui-temp:node-3-assignments';

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
          {
            id: 'urn:ui-temp:edge-1',
            sourceNodeId: 'urn:__START__',
            targetNodeId: node1Id,
            dataFlowType: 'CONTROL_FLOW'
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

    // Verify graph structure
    expect(queryGroupVersion.queryGroupVersion.executionNodes.length).toBe(3);
    expect(queryGroupVersion.queryGroupVersion.edges.length).toBe(4); // START→1, 1→2, 2→3, 3→END

    // Set current version and execute
    await context.app.inject({
      method: 'PUT',
      url: `/query-groups/${encodeURIComponent(queryGroup.id)}`,
      payload: {
        ...queryGroup,
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

    // Verify RDF output contains expected patterns
    expect(rdfResult).toContain('assignedTo');
    expect(rdfResult).toContain('forCategory');
    expect(rdfResult).toContain('assignedAt');

    console.log('✅ Three-node linear chain executed successfully');
    console.log(`📊 RDF output length: ${rdfResult.length} characters`);
  });
});
