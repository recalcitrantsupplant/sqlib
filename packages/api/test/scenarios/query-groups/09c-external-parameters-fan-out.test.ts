import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { QueryTypeIri } from '../../../src/constants/queryTypes.js';
import { ScenarioTestBaseUnmocked, type ScenarioTestContext } from '../fixtures/scenario-test-base-unmocked.js';

/**
 * Scenario 09c: External Parameters with Fan-Out (Complex Mode)
 *
 * Tests the FAN-OUT pattern with external parameters:
 * - StartNode defines custom QueryOutputTuple (independent entity)
 * - Multiple edges from StartNode reference the SAME sourceOutputId
 * - Same external parameter feeds multiple parallel queries
 *
 * Expected flow:
 * 1. StartNode.outputs = [shared-params] (independent QueryOutputTuple)
 * 2. Edge1: StartNode → Query1 (sourceOutputId: shared-params)
 * 3. Edge2: StartNode → Query2 (sourceOutputId: shared-params) - SAME source!
 * 4. Both queries execute in parallel with the same external parameter
 *
 * This demonstrates the fan-out pattern where one set of external parameters
 * feeds multiple parallel execution paths.
 *
 * IMPORTANT: Cannot use query's inferredInputs as StartNode output for fan-out!
 * Must create independent QueryOutputTuple on StartNode.
 */
describe('External Parameters with Fan-Out', () => {
  let context: ScenarioTestContext;
  let backend: any;
  let library: any;
  let queryGroup: any;

  beforeAll(async () => {
    context = await ScenarioTestBaseUnmocked.createTestContext('external-parameters-fan-out');

    await ScenarioTestBaseUnmocked.loadTurtleDataIntoBackend(context, 'people-skills-projects.ttl');
    backend = await ScenarioTestBaseUnmocked.createOxigraphBackend(context, 'FanOut Backend');
    library = await ScenarioTestBaseUnmocked.createLibrary(context, 'FanOut Library');
    queryGroup = await ScenarioTestBaseUnmocked.createQueryGroup(context, 'FanOut Workflow');
  }, 30000);

  afterAll(async () => {
    await ScenarioTestBaseUnmocked.cleanupTestContext(context);
  });

  it('should fan out external parameter to multiple parallel queries', { timeout: 15000 }, async () => {
    // Query 1: Filter people by experience level
    const query1String = `
      PREFIX ex: <http://example.org/>
      PREFIX foaf: <http://xmlns.com/foaf/0.1/>

      CONSTRUCT {
        ?person a foaf:Person ;
                foaf:name ?name ;
                ex:experienceLevel ?experienceLevel .
      }
      WHERE {
        VALUES (?experienceLevel) { (UNDEF) }

        ?person a foaf:Person ;
                foaf:name ?name ;
                ex:experienceLevel ?experienceLevel .
      }
    `;

    // Query 2: Count people by experience level
    const query2String = `
      PREFIX ex: <http://example.org/>
      PREFIX foaf: <http://xmlns.com/foaf/0.1/>

      CONSTRUCT { ex:result ex:count ?count . }
      WHERE {
        SELECT (COUNT(?person) AS ?count) WHERE {
          VALUES (?experienceLevel) { (UNDEF) }

          ?person a foaf:Person ;
                  ex:experienceLevel ?experienceLevel .
        }
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
            queryType: QueryTypeIri.construct,
          }
        }
      });
      return versionResponse.json();
    };

    const query1Version = await createQuery('Filter People', query1String);
    const query2Version = await createQuery('Count People', query2String);

    const node1Id = 'urn:ui-temp:filter-people';
    const node2Id = 'urn:ui-temp:count-people';

    // Create INDEPENDENT output tuple for StartNode (not tied to any query)
    // This is REQUIRED for fan-out pattern
    const queryGroupVersionResponse = await context.app.inject({
      method: 'POST',
      url: `/query-groups/${encodeURIComponent(queryGroup.id)}/v`,
      payload: {
        queryGroupVersion: {},
        // COMPLEX MODE: Create independent QueryOutputTuple for fan-out
        outputs: [
          {
            id: 'urn:ui-temp:shared-external-var',
            variableName: 'experienceLevel'
          }
        ],
        tupleMembers: [
          {
            id: 'urn:ui-temp:shared-external-member',
            position: 0,
            variable: 'urn:ui-temp:shared-external-var'
          }
        ],
        outputTuples: [
          {
            id: 'urn:ui-temp:shared-external-params',
            name: 'Shared Experience Parameter',
            memberEntries: ['urn:ui-temp:shared-external-member']
          }
        ],
        startNode: {
          outputs: ['urn:ui-temp:shared-external-params']  // Independent tuple (not query1 or query2's inputs)
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
            inputs: [query1Version.queryVersion.inferredInputs[0]],
            outputs: [query1Version.queryVersion.inferredOutputs[0]]
          },
          {
            id: node2Id,
            nodeType: 'QueryNode',
            queryId: query2Version.queryVersion.id,
            backendId: context.backendId,
            inputs: [query2Version.queryVersion.inferredInputs[0]],
            outputs: [query2Version.queryVersion.inferredOutputs[0]]
          }
        ],
        edges: [
          // FAN-OUT: Both edges use SAME sourceOutputId from StartNode
          {
            id: 'urn:ui-temp:edge-1',
            sourceNodeId: 'urn:__START__',
            targetNodeId: node1Id,
            dataFlowType: 'VARIABLE_BINDINGS',
            sourceOutputId: 'urn:ui-temp:shared-external-params',  // Shared source
            targetInputId: query1Version.queryVersion.inferredInputs[0]
          },
          {
            id: 'urn:ui-temp:edge-2',
            sourceNodeId: 'urn:__START__',
            targetNodeId: node2Id,
            dataFlowType: 'VARIABLE_BINDINGS',
            sourceOutputId: 'urn:ui-temp:shared-external-params',  // SAME shared source (fan-out!)
            targetInputId: query2Version.queryVersion.inferredInputs[0]
          },
          // Both results flow to EndNode (fan-in)
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

    console.log('Query Group Version Response:', queryGroupVersionResponse.statusCode);
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
    expect(iriMap['urn:ui-temp:shared-external-params']).toMatch(/^urn:sqlib:output-tuple:/);
    expect(iriMap['urn:ui-temp:shared-external-member']).toMatch(/^urn:sqlib:tuple-member:/);
    expect(iriMap['urn:ui-temp:shared-external-var']).toMatch(/^urn:sqlib:output:/);

    await context.app.inject({
      method: 'PUT',
      url: `/query-groups/${encodeURIComponent(queryGroup.id)}`,
      payload: {
        name: queryGroup.name,
        isPartOf: queryGroup.isPartOf,
        currentVersion: queryGroupVersion.queryGroupVersion.id
      }
    });

    // Execute with shared parameter: experienceLevel = "senior"
    const executeResponse = await context.app.inject({
      method: 'POST',
      url: '/execute/',
      headers: { 'accept': 'application/n-triples' },
      payload: {
        targetId: queryGroup.id,
        arguments: [
          {
            head: { vars: ['experienceLevel'] },
            arguments: {
              bindings: [
                { experienceLevel: { type: 'literal', value: 'senior' } }
              ]
            }
          }
        ]
      }
    });

    console.log('Execute Response:', executeResponse.statusCode);
    expect(executeResponse.statusCode).toBe(200);
    const result = executeResponse.payload;

    // Both queries should have executed with the same parameter
    // and the results merged into a single RDF graph
    expect(typeof result).toBe('string');
    expect(result).toContain('<http://example.org/alice> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://xmlns.com/foaf/0.1/Person>');
    expect(result).toContain('<http://example.org/result> <http://example.org/count> "3"^^<http://www.w3.org/2001/XMLSchema#integer>');

    console.log('✅ Fan-out pattern executed successfully');
    console.log('📊 Result:', result);
  });
});