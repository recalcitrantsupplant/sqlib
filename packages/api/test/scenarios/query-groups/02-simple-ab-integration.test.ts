import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { QueryTypeIri } from '../../../src/constants/queryTypes.js';
import { ScenarioTestBaseUnmocked, type ScenarioTestContext } from '../fixtures/scenario-test-base-unmocked.js';

/**
 * Simple A-B Integration Test (UNMOCKED VERSION)
 *
 * This is the simplest possible integration test that:
 * - Loads simple turtle data with A and B values
 * - Creates a SELECT query that returns A and B variables
 * - Creates a CONSTRUCT query that takes A and B as input parameters
 * - Tests the basic SELECT → CONSTRUCT query group chain
 */
describe('Simple A-B Integration Test (Unmocked)', () => {
  let context: ScenarioTestContext;
  let backend: any;
  let library: any;
  let queryGroup: any;
  let selectQuery: string;
  let constructQuery: string;

  // Shared setup for all tests
  beforeAll(async () => {
    context = await ScenarioTestBaseUnmocked.createTestContext('simple-ab-integration');

    // Load data and create infrastructure once per test context
    await ScenarioTestBaseUnmocked.loadTurtleDataIntoBackend(context, 'simple-ab-data.ttl');
    backend = await ScenarioTestBaseUnmocked.createOxigraphBackend(context, 'Simple A-B Backend');
    library = await ScenarioTestBaseUnmocked.createLibrary(context, 'Simple A-B Library');
    queryGroup = await ScenarioTestBaseUnmocked.createQueryGroup(context, 'Simple A-B Chain');

    // Load query files
    selectQuery = await ScenarioTestBaseUnmocked.readQueryFile('simple-ab-query.sparql');
    constructQuery = await ScenarioTestBaseUnmocked.readQueryFile('simple-ab-construct.sparql');
  }, 30000);

  afterAll(async () => {
    await ScenarioTestBaseUnmocked.cleanupTestContext(context);
  });

  it('should setup infrastructure correctly', async () => {
    expect(backend.id).toBe(context.backendId);
    expect(backend.backendType).toBe('oxigraphEphemeral');
    expect(library.id).toBe(context.libraryId);
    expect(queryGroup.name).toBe('Simple A-B Chain');
  });

  it('should create SELECT query with A and B outputs', async () => {
    // Create SELECT query
    const selectQueryResponse = await context.app.inject({
      method: 'POST',
      url: '/queries/',
      payload: {
        name: 'Simple A-B SELECT',
        description: 'Selects A and B values from simple data',
        isPartOf: [context.libraryId]
      }
    });
    expect(selectQueryResponse.statusCode).toBe(201);
    const selectQueryEntity = selectQueryResponse.json();

    // Create SELECT query version
    const selectVersionResponse = await context.app.inject({
      method: 'POST',
      url: `/queries/${encodeURIComponent(selectQueryEntity.id)}/v`,
      payload: {
        queryVersion: {
          queryString: selectQuery,
          queryType: QueryTypeIri.select,
        }
      }
    });
    expect(selectVersionResponse.statusCode).toBe(201);
    const selectVersion = selectVersionResponse.json();

    // Verify SELECT query structure
    expect(selectVersion.queryVersion.inferredOutputs).toBeDefined();
    expect(Array.isArray(selectVersion.queryVersion.inferredOutputs)).toBe(true);
    expect(selectVersion.queryVersion.inferredOutputs[0]).toMatch(/^urn:sqlib:output-tuple:/);

    expect(selectVersion.outputs).toBeDefined();
    expect(Array.isArray(selectVersion.outputs)).toBe(true);
    expect(selectVersion.outputs.length).toBe(2); // A and B

    const selectOutputVariableNames = selectVersion.outputs.map((output: any) => output.variableName).sort();
    expect(selectOutputVariableNames).toEqual(['A', 'B']);
  });

  it('should create CONSTRUCT query with a and b inputs', async () => {
    // Create CONSTRUCT query
    const constructQueryResponse = await context.app.inject({
      method: 'POST',
      url: '/queries/',
      payload: {
        name: 'Simple A-B CONSTRUCT',
        description: 'Creates RDF from A and B input parameters',
        isPartOf: [context.libraryId]
      }
    });
    expect(constructQueryResponse.statusCode).toBe(201);
    const constructQueryEntity = constructQueryResponse.json();

    // Create CONSTRUCT query version
    const constructVersionResponse = await context.app.inject({
      method: 'POST',
      url: `/queries/${encodeURIComponent(constructQueryEntity.id)}/v`,
      payload: {
        queryVersion: {
          queryString: constructQuery,
          queryType: QueryTypeIri.construct,
        }
      }
    });
    expect(constructVersionResponse.statusCode).toBe(201);
    const constructVersion = constructVersionResponse.json();

    // Verify CONSTRUCT query structure
    expect(constructVersion.inputs).toBeDefined();
    expect(Array.isArray(constructVersion.inputs)).toBe(true);
    expect(constructVersion.inputs.length).toBe(2); // a and b

    const constructInputVariableNames = constructVersion.inputs.map((input: any) => input.variableName).sort();
    expect(constructInputVariableNames).toEqual(['a', 'b']);

    expect(constructVersion.inputTuples).toBeDefined();
    expect(Array.isArray(constructVersion.inputTuples)).toBe(true);
    expect(constructVersion.inputTuples.length).toBe(1); // One input tuple for a-b pair
  });

  it('should create query group version with SELECT → CONSTRUCT chain', { timeout: 10000 }, async () => {
    // Create SELECT query and version
    const selectQueryResponse = await context.app.inject({
      method: 'POST',
      url: '/queries/',
      payload: {
        name: 'Simple A-B SELECT',
        description: 'Selects A and B values from simple data',
        isPartOf: [context.libraryId]
      }
    });
    expect(selectQueryResponse.statusCode).toBe(201);
    const selectQueryEntity = selectQueryResponse.json();

    const selectVersionResponse = await context.app.inject({
      method: 'POST',
      url: `/queries/${encodeURIComponent(selectQueryEntity.id)}/v`,
      payload: {
        queryVersion: {
          queryString: selectQuery,
          queryType: QueryTypeIri.select,
        }
      }
    });
    expect(selectVersionResponse.statusCode).toBe(201);
    const selectVersion = selectVersionResponse.json();

    // Create CONSTRUCT query and version
    const constructQueryResponse = await context.app.inject({
      method: 'POST',
      url: '/queries/',
      payload: {
        name: 'Simple A-B CONSTRUCT',
        description: 'Creates RDF from A and B input parameters',
        isPartOf: [context.libraryId]
      }
    });
    expect(constructQueryResponse.statusCode).toBe(201);
    const constructQueryEntity = constructQueryResponse.json();

    const constructVersionResponse = await context.app.inject({
      method: 'POST',
      url: `/queries/${encodeURIComponent(constructQueryEntity.id)}/v`,
      payload: {
        queryVersion: {
          queryString: constructQuery,
          queryType: QueryTypeIri.construct,
        }
      }
    });
    expect(constructVersionResponse.statusCode).toBe(201);
    const constructVersion = constructVersionResponse.json();

    // Create Query Group Version with chained queries
    // Note: StartNode and EndNode are auto-created, reference them with __START__ and __END__
    const selectNodeId = 'urn:ui-temp:select-node-1';
    const constructNodeId = 'urn:ui-temp:construct-node-1';

    const queryGroupVersionResponse = await context.app.inject({
      method: 'POST',
      url: `/query-groups/${encodeURIComponent(queryGroup.id)}/v`,
      payload: {
        queryGroupVersion: {},
        endNode: {
          mediaType: 'application/n-triples'  // Output format for RDF result
        },
        executionNodes: [
          {
            id: selectNodeId,
            nodeType: 'QueryNode',
            queryId: selectVersion.queryVersion.id,
            backendId: context.backendId,
            inputs: [],
            outputs: [selectVersion.queryVersion.inferredOutputs[0]]
          },
          {
            id: constructNodeId,
            nodeType: 'QueryNode',
            queryId: constructVersion.queryVersion.id,
            backendId: context.backendId,
            inputs: [constructVersion.queryVersion.inferredInputs[0]],
            outputs: [constructVersion.queryVersion.inferredOutputs[0]]
          }
        ],
        edges: [
          {
            id: 'urn:ui-temp:edge-1',
            sourceNodeId: 'urn:__START__',
            targetNodeId: selectNodeId,
            dataFlowType: 'CONTROL_FLOW',
          },
          {
            id: 'urn:ui-temp:edge-2',
            sourceNodeId: selectNodeId,
            targetNodeId: constructNodeId,
            dataFlowType: 'VARIABLE_BINDINGS',
            sourceOutputId: selectVersion.queryVersion.inferredOutputs[0],
            targetInputId: constructVersion.queryVersion.inferredInputs[0]
          },
          {
            id: 'urn:ui-temp:edge-3',
            sourceNodeId: constructNodeId,
            targetNodeId: 'urn:__END__',
            dataFlowType: 'RDF_GRAPH',
            sourceOutputId: constructVersion.queryVersion.inferredOutputs[0],
            targetInputId: constructVersion.queryVersion.inferredOutputs[0]
          }
        ]
      }
    });

    if (queryGroupVersionResponse.statusCode !== 201) {
      console.error('Query Group Version creation failed:', queryGroupVersionResponse.statusCode);
      console.error('Response headers:', queryGroupVersionResponse.headers);
      console.error('Response body:', queryGroupVersionResponse.body);
      console.error('Response JSON:', queryGroupVersionResponse.json());
    }
    expect(queryGroupVersionResponse.statusCode).toBe(201);
    const queryGroupVersion = queryGroupVersionResponse.json();

    const iriMap = queryGroupVersion.iriMap;
    expect(iriMap).toBeDefined();
    expect(iriMap['urn:__START__']).toMatch(/^urn:sqlib:start-node:/);
    expect(iriMap['urn:__END__']).toMatch(/^urn:sqlib:end-node:/);
    expect(iriMap[selectNodeId]).toMatch(/^urn:sqlib:node:/);
    expect(iriMap[constructNodeId]).toMatch(/^urn:sqlib:node:/);
    expect(iriMap['urn:ui-temp:edge-1']).toMatch(/^urn:sqlib:edge:/);
    expect(iriMap['urn:ui-temp:edge-2']).toMatch(/^urn:sqlib:edge:/);
    expect(iriMap['urn:ui-temp:edge-3']).toMatch(/^urn:sqlib:edge:/);

    // Verify Query Group Version structure
    expect(queryGroupVersion.queryGroupVersion).toBeDefined();
    expect(queryGroupVersion.queryGroupVersion.version).toBe(1);
    expect(queryGroupVersion.queryGroupVersion.startNode).toBeDefined();
    expect(queryGroupVersion.queryGroupVersion.endNode).toBeDefined();
    expect(queryGroupVersion.queryGroupVersion.executionNodes).toBeDefined();
    expect(Array.isArray(queryGroupVersion.queryGroupVersion.executionNodes)).toBe(true);
    expect(queryGroupVersion.queryGroupVersion.executionNodes.length).toBe(2); // 2 intermediate executionNodes
    expect(queryGroupVersion.queryGroupVersion.edges).toBeDefined();
    expect(Array.isArray(queryGroupVersion.queryGroupVersion.edges)).toBe(true);
    expect(queryGroupVersion.queryGroupVersion.edges.length).toBe(3); // 3 connections: Start→SELECT, SELECT→CONSTRUCT, CONSTRUCT→End

    console.log('✅ SELECT → CONSTRUCT query group version created successfully');
    console.log(`📊 SELECT outputs: ${selectVersion.outputs.length} (A, B)`);
    console.log(`📥 CONSTRUCT inputs: ${constructVersion.inputs.length} (a, b)`);
    console.log(`🔗 Query group version executionNodes: ${queryGroupVersion.executionNodes.length}`);
    console.log(`📋 Query group version edges: ${queryGroupVersion.edges.length}`);

    // Set currentVersion on QueryGroup to enable execution
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
    console.log('✅ QueryGroup currentVersion set successfully');
  });

  it('should execute query group version and return RDF results', { timeout: 15000 }, async () => {
    // Create all entities like in previous test
    const selectQueryResponse = await context.app.inject({
      method: 'POST',
      url: '/queries/',
      payload: {
        name: 'Simple A-B SELECT',
        description: 'Selects A and B values from simple data',
        isPartOf: [context.libraryId]
      }
    });
    expect(selectQueryResponse.statusCode).toBe(201);
    const selectQueryEntity = selectQueryResponse.json();

    const selectVersionResponse = await context.app.inject({
      method: 'POST',
      url: `/queries/${encodeURIComponent(selectQueryEntity.id)}/v`,
      payload: {
        queryVersion: {
          queryString: selectQuery,
          queryType: QueryTypeIri.select,
        }
      }
    });
    expect(selectVersionResponse.statusCode).toBe(201);
    const selectVersion = selectVersionResponse.json();

    const constructQueryResponse = await context.app.inject({
      method: 'POST',
      url: '/queries/',
      payload: {
        name: 'Simple A-B CONSTRUCT',
        description: 'Creates RDF from A and B input parameters',
        isPartOf: [context.libraryId]
      }
    });
    expect(constructQueryResponse.statusCode).toBe(201);
    const constructQueryEntity = constructQueryResponse.json();

    const constructVersionResponse = await context.app.inject({
      method: 'POST',
      url: `/queries/${encodeURIComponent(constructQueryEntity.id)}/v`,
      payload: {
        queryVersion: {
          queryString: constructQuery,
          queryType: QueryTypeIri.construct,
        }
      }
    });
    expect(constructVersionResponse.statusCode).toBe(201);
    const constructVersion = constructVersionResponse.json();

    // Debug: Check what QueryVersion IDs we're working with
    console.log('🆔 QueryVersion IDs:');
    console.log(`  SELECT QueryVersion ID: ${selectVersion.queryVersion.id}`);
    console.log(`  CONSTRUCT QueryVersion ID: ${constructVersion.queryVersion.id}`);
    console.log(`  SELECT in cache: ${context.cacheManager.get(selectVersion.queryVersion.id) ? 'FOUND' : 'MISSING'}`);
    console.log(`  CONSTRUCT in cache: ${context.cacheManager.get(constructVersion.queryVersion.id) ? 'FOUND' : 'MISSING'}`);

    // Create Query Group Version
    // Note: StartNode and EndNode are auto-created
    const selectNodeId = 'urn:ui-temp:select-node-1';
    const constructNodeId = 'urn:ui-temp:construct-node-1';

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
            id: selectNodeId,
            nodeType: 'QueryNode',
            queryId: selectVersion.queryVersion.id,
            backendId: context.backendId,
            outputs: [selectVersion.queryVersion.inferredOutputs[0]]
          },
          {
            id: constructNodeId,
            nodeType: 'QueryNode',
            queryId: constructVersion.queryVersion.id,
            backendId: context.backendId,
            inputs: [constructVersion.queryVersion.inferredInputs[0]],
            outputs: [constructVersion.queryVersion.inferredOutputs[0]]
          }
        ],
        edges: [
          {
            id: 'urn:ui-temp:edge-4',
            sourceNodeId: 'urn:__START__',
            targetNodeId: selectNodeId,
            dataFlowType: 'CONTROL_FLOW',
          },
          {
            id: 'urn:ui-temp:edge-5',
            sourceNodeId: selectNodeId,
            targetNodeId: constructNodeId,
            dataFlowType: 'VARIABLE_BINDINGS',
            sourceOutputId: selectVersion.queryVersion.inferredOutputs[0],
            targetInputId: constructVersion.queryVersion.inferredInputs[0]
          },
          {
            id: 'urn:ui-temp:edge-6',
            sourceNodeId: constructNodeId,
            targetNodeId: 'urn:__END__',
            dataFlowType: 'RDF_GRAPH',
            sourceOutputId: constructVersion.queryVersion.inferredOutputs[0],
            targetInputId: constructVersion.queryVersion.inferredOutputs[0]
          }
        ]
      }
    });
    expect(queryGroupVersionResponse.statusCode).toBe(201);
    const queryGroupVersion = queryGroupVersionResponse.json();

    const iriMap = queryGroupVersion.iriMap;
    expect(iriMap).toBeDefined();
    expect(iriMap['urn:__START__']).toMatch(/^urn:sqlib:start-node:/);
    expect(iriMap['urn:__END__']).toMatch(/^urn:sqlib:end-node:/);
    expect(iriMap[selectNodeId]).toMatch(/^urn:sqlib:node:/);
    expect(iriMap[constructNodeId]).toMatch(/^urn:sqlib:node:/);
    expect(iriMap['urn:ui-temp:edge-4']).toMatch(/^urn:sqlib:edge:/);
    expect(iriMap['urn:ui-temp:edge-5']).toMatch(/^urn:sqlib:edge:/);
    expect(iriMap['urn:ui-temp:edge-6']).toMatch(/^urn:sqlib:edge:/);

    // Set currentVersion on QueryGroup
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

    // All entities should now be properly cached by GroupVersionWriter
    console.log('✅ QueryGroupVersion creation completed with cache-aware entity management');

    // Verify QueryGroupVersion structure
    expect(queryGroupVersion.queryGroupVersion.executionNodes).toBeDefined();
    expect(Array.isArray(queryGroupVersion.queryGroupVersion.executionNodes)).toBe(true);
    expect(queryGroupVersion.queryGroupVersion.executionNodes.length).toBe(2);

    console.log('✅ QueryGroupVersion structure verified');

    // Execute the QueryGroup
    const executeResponse = await context.app.inject({
      method: 'POST',
      url: '/execute/',
      headers: {
        'accept': 'application/n-triples'
      },
      payload: {
        targetId: queryGroup.id,  // Use stable QueryGroup ID
        // No arguments needed - SELECT query has no parameters
      }
    });

    if (executeResponse.statusCode !== 200) {
      console.error('Execute failed:', executeResponse.statusCode);
      console.error('Response Body:', executeResponse.body);
      console.error('Response JSON:', executeResponse.json());
      console.error('Headers:', executeResponse.headers);
    }
    expect(executeResponse.statusCode).toBe(200);

    // Verify the RDF result
    const rdfResult = executeResponse.body;
    expect(typeof rdfResult).toBe('string');
    expect(rdfResult.length).toBeGreaterThan(0);

    // Verify RDF contains expected patterns from our CONSTRUCT query
    expect(rdfResult).toContain('http://example.org/derivedFrom');
    expect(rdfResult).toContain('http://example.org/processedValue');
    expect(rdfResult).toContain('http://example.org/timestamp');

    // Verify we have results for our test data (value1-value4, alpha-delta)
    expect(rdfResult).toContain('value1');
    expect(rdfResult).toContain('alpha');

    console.log('✅ Query Group execution completed successfully');
    console.log(`📋 RDF output length: ${rdfResult.length} characters`);
    console.log('🔍 RDF sample:', rdfResult.substring(0, 200) + '...');

    // The nodeDetail envelope is JSON even when it wraps an RDF string result:
    // sending an object under an RDF media type makes Fastify reject the payload.
    const detailedResponse = await context.app.inject({
      method: 'POST',
      url: '/execute/',
      headers: { accept: 'application/n-triples' },
      payload: { targetId: queryGroup.id, nodeDetail: 'timings' },
    });

    expect(detailedResponse.statusCode).toBe(200);
    expect(detailedResponse.headers['content-type']).toContain('application/json');
    const detailed = detailedResponse.json();
    // Byte-identical to the plain response: the scenario queries are deterministic,
    // so re-executing the group must reproduce exactly the same RDF.
    expect(detailed.result).toBe(rdfResult);
    expect(detailed.nodes.length).toBeGreaterThan(0);
    for (const node of detailed.nodes) {
      expect(node.status).toBe('ok');
      expect(typeof node.durationMs).toBe('number');
    }
    // A CONSTRUCT node reports triples, not rows.
    expect(detailed.nodes.some((node: { tripleCount?: number }) => typeof node.tripleCount === 'number')).toBe(true);
  });
});
