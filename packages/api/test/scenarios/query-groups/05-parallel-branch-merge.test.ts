import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ScenarioTestBaseUnmocked, type ScenarioTestContext } from '../fixtures/scenario-test-base-unmocked.js';

/**
 * Scenario 5: Parallel Branch and Merge
 *
 * Complexity added from three-node linear chain:
 * - DAG structure instead of linear chain
 * - One source node branches to two parallel nodes
 * - Two parallel nodes merge into single output node
 * - Tests ExecutionEngine's handling of multiple inbound edges
 *
 * Expected flow:
 * 1. Query 1: SELECT people → outputs (?person)
 * 2a. Query 2a: SELECT skills for person → outputs (?person, ?skillCount)
 * 2b. Query 2b: SELECT experience for person → outputs (?person, ?experience)
 * 3. Query 3: Takes BOTH inputs and constructs combined profile
 *
 * Graph structure:
 *        Q1 (people)
 *       /           \
 *     Q2a (skills)  Q2b (experience)
 *       \           /
 *        Q3 (profile)
 */
describe('Parallel Branch and Merge', () => {
  let context: ScenarioTestContext;
  let backend: any;
  let library: any;
  let queryGroup: any;

  beforeAll(async () => {
    context = await ScenarioTestBaseUnmocked.createTestContext('parallel-branch-merge');

    await ScenarioTestBaseUnmocked.loadTurtleDataIntoBackend(context, 'people-skills-projects.ttl');
    backend = await ScenarioTestBaseUnmocked.createOxigraphBackend(context, 'Parallel Backend');
    library = await ScenarioTestBaseUnmocked.createLibrary(context, 'Parallel Library');
    queryGroup = await ScenarioTestBaseUnmocked.createQueryGroup(context, 'Parallel Analysis');
  }, 30000);

  afterAll(async () => {
    await ScenarioTestBaseUnmocked.cleanupTestContext(context);
  });

  it('should execute parallel branch and merge', { timeout: 15000 }, async () => {
    // Query 1: Get people
    const query1String = `
      PREFIX foaf: <http://xmlns.com/foaf/0.1/>

      SELECT ?person WHERE {
        ?person a foaf:Person .
      }
      LIMIT 5
    `;

    // Query 2a: Count skills for each person (parallel branch A)
    const query2aString = `
      PREFIX ex: <http://example.org/>

      SELECT ?p (COUNT(?skill) AS ?skillCount) WHERE {
        VALUES (?p) { (UNDEF) }

        ?p ex:hasSkill ?skill .
      }
      GROUP BY ?p
    `;

    // Query 2b: Get experience level for each person (parallel branch B)
    const query2bString = `
      PREFIX ex: <http://example.org/>

      SELECT ?p ?experience WHERE {
        VALUES (?p) { (UNDEF) }

        ?p ex:experienceLevel ?experience .
      }
    `;

    // Query 3: Merge results and construct profile
    // Uses two separate VALUES clauses that naturally join on shared ?p variable
    // SPARQL's graph pattern matching performs the join automatically
    const query3String = `
      PREFIX ex: <http://example.org/>

      CONSTRUCT {
        ?p ex:hasProfile ?profile ;
           ex:skillCount ?skillCount ;
           ex:experience ?experience ;
           ex:analyzed ?timestamp .
        ?profile ex:person ?p ;
                ex:metrics "computed" .
      }
      WHERE {
        # Input from Q2a: (?p, ?skillCount) - binds to same ?p values
        VALUES (?p ?skillCount) { (UNDEF UNDEF) }

        # Input from Q2b: (?p, ?experience) - binds to same ?p values
        VALUES (?p ?experience) { (UNDEF UNDEF) }

        # SPARQL joins these on shared ?p variable automatically
        # No need for explicit join - graph pattern matching handles it

        BIND(IRI(CONCAT("http://example.org/profile/", ENCODE_FOR_URI(STR(?p)))) AS ?profile)
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
    const query2aVersion = await createQuery('Count Skills', query2aString);
    const query2bVersion = await createQuery('Get Experience', query2bString);
    const query3Version = await createQuery('Build Profile', query3String);

    // Create Query Group Version with parallel structure
    const node1Id = 'urn:ui-temp:source-people';
    const node2aId = 'urn:ui-temp:branch-a-skills';
    const node2bId = 'urn:ui-temp:branch-b-experience';
    const node3Id = 'urn:ui-temp:merge-profile';

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
            id: node2aId,
            nodeType: 'QueryNode',
            queryId: query2aVersion.queryVersion.id,
            backendId: context.backendId,
            inputs: [query2aVersion.queryVersion.inferredInputs[0]],
            outputs: [query2aVersion.queryVersion.inferredOutputs[0]]
          },
          {
            id: node2bId,
            nodeType: 'QueryNode',
            queryId: query2bVersion.queryVersion.id,
            backendId: context.backendId,
            inputs: [query2bVersion.queryVersion.inferredInputs[0]],
            outputs: [query2bVersion.queryVersion.inferredOutputs[0]]
          },
          {
            id: node3Id,
            nodeType: 'QueryNode',
            queryId: query3Version.queryVersion.id,
            backendId: context.backendId,
            inputs: [
              query3Version.queryVersion.inferredInputs[0],  // (?p ?skillCount) from Q2a
              query3Version.queryVersion.inferredInputs[1]   // (?p ?experience) from Q2b
            ],
            outputs: [query3Version.queryVersion.inferredOutputs[0]]
          }
        ],
        edges: [
          // START to source
          {
            id: 'urn:ui-temp:edge-1',
            sourceNodeId: 'urn:__START__',
            targetNodeId: node1Id,
            dataFlowType: 'CONTROL_FLOW'
          },
          // Source branches to both parallel nodes
          {
            id: 'urn:ui-temp:edge-2',
            sourceNodeId: node1Id,
            targetNodeId: node2aId,
            dataFlowType: 'VARIABLE_BINDINGS',
            sourceOutputId: query1Version.queryVersion.inferredOutputs[0],
            targetInputId: query2aVersion.queryVersion.inferredInputs[0]
          },
          {
            id: 'urn:ui-temp:edge-3',
            sourceNodeId: node1Id,
            targetNodeId: node2bId,
            dataFlowType: 'VARIABLE_BINDINGS',
            sourceOutputId: query1Version.queryVersion.inferredOutputs[0],
            targetInputId: query2bVersion.queryVersion.inferredInputs[0]
          },
          // Both branches merge to final node with separate input tuples
          // Q2a → Q3 input[0] (skillCount data)
          {
            id: 'urn:ui-temp:edge-4',
            sourceNodeId: node2aId,
            targetNodeId: node3Id,
            dataFlowType: 'VARIABLE_BINDINGS',
            sourceOutputId: query2aVersion.queryVersion.inferredOutputs[0],
            targetInputId: query3Version.queryVersion.inferredInputs[0]
          },
          // Q2b → Q3 input[1] (experience data)
          {
            id: 'urn:ui-temp:edge-5',
            sourceNodeId: node2bId,
            targetNodeId: node3Id,
            dataFlowType: 'VARIABLE_BINDINGS',
            sourceOutputId: query2bVersion.queryVersion.inferredOutputs[0],
            targetInputId: query3Version.queryVersion.inferredInputs[1]
          },
          // Final node to END
          {
            id: 'urn:ui-temp:edge-6',
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
    expect(iriMap[node2aId]).toMatch(/^urn:sqlib:node:/);
    expect(iriMap[node2bId]).toMatch(/^urn:sqlib:node:/);
    expect(iriMap[node3Id]).toMatch(/^urn:sqlib:node:/);
    expect(iriMap['urn:ui-temp:edge-1']).toMatch(/^urn:sqlib:edge:/);
    expect(iriMap['urn:ui-temp:edge-2']).toMatch(/^urn:sqlib:edge:/);
    expect(iriMap['urn:ui-temp:edge-3']).toMatch(/^urn:sqlib:edge:/);
    expect(iriMap['urn:ui-temp:edge-4']).toMatch(/^urn:sqlib:edge:/);
    expect(iriMap['urn:ui-temp:edge-5']).toMatch(/^urn:sqlib:edge:/);
    expect(iriMap['urn:ui-temp:edge-6']).toMatch(/^urn:sqlib:edge:/);

    // Verify DAG structure
    expect(queryGroupVersion.queryGroupVersion.executionNodes.length).toBe(4);
    expect(queryGroupVersion.queryGroupVersion.edges.length).toBe(6); // START→1, 1→2a, 1→2b, 2a→3, 2b→3, 3→END

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

    expect(rdfResult).toContain('hasProfile');
    expect(rdfResult).toContain('analyzed');

    console.log('✅ Parallel branch and merge executed successfully');
    console.log(`📊 RDF output length: ${rdfResult.length} characters`);
  });
});
