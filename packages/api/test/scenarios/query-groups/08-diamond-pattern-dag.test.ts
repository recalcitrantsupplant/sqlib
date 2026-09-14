import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ScenarioTestBaseUnmocked, type ScenarioTestContext } from '../fixtures/scenario-test-base-unmocked.js';
import { SparqlQueryParser } from '../../../src/lib/parser.js';
import { deriveQueryVersionMetadata } from '../../../src/lib/QueryVersionDeriver.js';

/**
 * Scenario 8: Diamond Pattern DAG
 *
 * Complexity added from mixed output types:
 * - Classic diamond DAG pattern (split then merge)
 * - Tests execution ordering and data flow convergence
 * - Single source splits to two paths that reconverge
 *
 * Expected flow:
 *         Q1 (root)
 *        /         \
 *      Q2a         Q2b
 *        \         /
 *         Q3 (merge)
 *
 * This pattern tests:
 * - Proper execution ordering (Q2a/Q2b can run in parallel)
 * - Q3 waits for both Q2a and Q2b to complete
 * - Multiple edges converging on same target input tuple
 */
describe('Diamond Pattern DAG', () => {
  let context: ScenarioTestContext;
  let backend: any;
  let library: any;
  let queryGroup: any;

  beforeAll(async () => {
    context = await ScenarioTestBaseUnmocked.createTestContext('diamond-pattern');

    await ScenarioTestBaseUnmocked.loadTurtleDataIntoBackend(context, 'people-skills-projects.ttl');
    backend = await ScenarioTestBaseUnmocked.createOxigraphBackend(context, 'Diamond Backend');
    library = await ScenarioTestBaseUnmocked.createLibrary(context, 'Diamond Library');
    queryGroup = await ScenarioTestBaseUnmocked.createQueryGroup(context, 'Diamond Pattern');
  }, 30000);

  afterAll(async () => {
    await ScenarioTestBaseUnmocked.cleanupTestContext(context);
  });

  it('should execute diamond pattern DAG correctly', { timeout: 15000 }, async () => {
    // Root query: Get people
    const rootQuery = `
      PREFIX foaf: <http://xmlns.com/foaf/0.1/>
      PREFIX ex: <http://example.org/>

      SELECT ?person ?experience WHERE {
        ?person a foaf:Person ;
                ex:experienceLevel ?experience .
      }
      LIMIT 3
    `;

    // Left branch: Filter seniors (pass through person + experience)
    const leftBranchQuery = `
      SELECT ?person ?experience WHERE {
        VALUES (?person ?experience) { (UNDEF UNDEF) }

        FILTER(?experience = "senior")
      }
    `;

    // Right branch: Get all (pass-through with enrichment)
    const rightBranchQuery = `
      PREFIX foaf: <http://xmlns.com/foaf/0.1/>

      SELECT ?person ?name WHERE {
        VALUES (?person ?experience) { (UNDEF UNDEF) }

        ?person foaf:name ?name .
      }
    `;

    // Merge query: Combine results from both branches
    // This should receive people from BOTH the left branch (seniors) and right branch (all)
    const mergeQuery = `
      PREFIX ex: <http://example.org/>
      PREFIX foaf: <http://xmlns.com/foaf/0.1/>

      CONSTRUCT {
        ?person ex:inDiamond true ;
               ex:mergedAt ?timestamp ;
               ex:experienceLevel ?experience ;
               foaf:name ?name .
      }
      WHERE {
        VALUES (?person ?experience) { (UNDEF UNDEF) }
        VALUES (?person ?name) { (UNDEF UNDEF) }

        BIND("2026-01-01T00:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime> AS ?timestamp)
      }
    `;

    const parser = new SparqlQueryParser();

    const createQuery = async (name: string, queryString: string) => {
      const queryResponse = await context.app.inject({
        method: 'POST',
        url: '/queries/',
        payload: { name, isPartOf: [context.libraryId] }
      });
      const queryEntity = queryResponse.json();

      const derived = deriveQueryVersionMetadata(parser, queryString);
      const versionPayload: any = {
        queryVersion: {
          queryString,
        }
      };

      if (derived.outputs.length) versionPayload.outputs = derived.outputs;
      if (derived.inputs.length) versionPayload.inputs = derived.inputs;
      if (derived.tupleMembers.length) versionPayload.tupleMembers = derived.tupleMembers;
      if (derived.inputTuples.length) versionPayload.inputTuples = derived.inputTuples;

      const versionResponse = await context.app.inject({
        method: 'POST',
        url: `/queries/${encodeURIComponent(queryEntity.id)}/v`,
        payload: versionPayload
      });
      if (versionResponse.statusCode !== 201) {
        throw new Error(`Failed to create query version for ${name}: ${versionResponse.statusCode} ${versionResponse.body}`);
      }
      return versionResponse.json();
    };

    const rootVersion = await createQuery('Root Query', rootQuery);
    const leftVersion = await createQuery('Left Branch', leftBranchQuery);
    const rightVersion = await createQuery('Right Branch', rightBranchQuery);
    const mergeVersion = await createQuery('Merge Results', mergeQuery);

    expect(mergeVersion.inputTuples).toBeDefined();
    expect(mergeVersion.inputTuples.length).toBe(2);
    const [experienceTuple, nameTuple] = mergeVersion.inputTuples;

    // Create diamond pattern
    const rootNodeId = 'urn:ui-temp:root';
    const leftNodeId = 'urn:ui-temp:left-branch';
    const rightNodeId = 'urn:ui-temp:right-branch';
    const mergeNodeId = 'urn:ui-temp:merge';

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
            id: rootNodeId,
            nodeType: 'QueryNode',
            queryId: rootVersion.queryVersion.id,
            backendId: context.backendId,
            outputs: [rootVersion.queryVersion.inferredOutputs[0]]
          },
          {
            id: leftNodeId,
            nodeType: 'QueryNode',
            queryId: leftVersion.queryVersion.id,
            backendId: context.backendId,
            inputs: [leftVersion.queryVersion.inferredInputs[0]],
            outputs: [leftVersion.queryVersion.inferredOutputs[0]]
          },
          {
            id: rightNodeId,
            nodeType: 'QueryNode',
            queryId: rightVersion.queryVersion.id,
            backendId: context.backendId,
            inputs: [rightVersion.queryVersion.inferredInputs[0]],
            outputs: [rightVersion.queryVersion.inferredOutputs[0]]
          },
          {
            id: mergeNodeId,
            nodeType: 'QueryNode',
            queryId: mergeVersion.queryVersion.id,
            backendId: context.backendId,
            inputs: [experienceTuple.id, nameTuple.id],
            outputs: [mergeVersion.queryVersion.inferredOutputs[0]]
          }
        ],
        edges: [
          // START → root
          {
            id: 'urn:ui-temp:edge-1',
            sourceNodeId: 'urn:__START__',
            targetNodeId: rootNodeId,
            dataFlowType: 'CONTROL_FLOW'
          },
          // Root splits to left and right
          {
            id: 'urn:ui-temp:edge-2',
            sourceNodeId: rootNodeId,
            targetNodeId: leftNodeId,
            dataFlowType: 'VARIABLE_BINDINGS',
            sourceOutputId: rootVersion.queryVersion.inferredOutputs[0],
            targetInputId: leftVersion.queryVersion.inferredInputs[0]
          },
          {
            id: 'urn:ui-temp:edge-3',
            sourceNodeId: rootNodeId,
            targetNodeId: rightNodeId,
            dataFlowType: 'VARIABLE_BINDINGS',
            sourceOutputId: rootVersion.queryVersion.inferredOutputs[0],
            targetInputId: rightVersion.queryVersion.inferredInputs[0]
          },
          // Left and right merge into single node
          {
            id: 'urn:ui-temp:edge-4',
            sourceNodeId: leftNodeId,
            targetNodeId: mergeNodeId,
            dataFlowType: 'VARIABLE_BINDINGS',
            sourceOutputId: leftVersion.queryVersion.inferredOutputs[0],
            targetInputId: experienceTuple.id
          },
          {
            id: 'urn:ui-temp:edge-5',
            sourceNodeId: rightNodeId,
            targetNodeId: mergeNodeId,
            dataFlowType: 'VARIABLE_BINDINGS',
            sourceOutputId: rightVersion.queryVersion.inferredOutputs[0],
            targetInputId: nameTuple.id
          },
          // Merge → END
          {
            id: 'urn:ui-temp:edge-6',
            sourceNodeId: mergeNodeId,
            targetNodeId: 'urn:__END__',
            dataFlowType: 'RDF_GRAPH',
            sourceOutputId: mergeVersion.queryVersion.inferredOutputs[0],
            targetInputId: mergeVersion.queryVersion.inferredOutputs[0]
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
    expect(iriMap[rootNodeId]).toMatch(/^urn:sqlib:node:/);
    expect(iriMap[leftNodeId]).toMatch(/^urn:sqlib:node:/);
    expect(iriMap[rightNodeId]).toMatch(/^urn:sqlib:node:/);
    expect(iriMap[mergeNodeId]).toMatch(/^urn:sqlib:node:/);
    expect(iriMap['urn:ui-temp:edge-1']).toMatch(/^urn:sqlib:edge:/);
    expect(iriMap['urn:ui-temp:edge-2']).toMatch(/^urn:sqlib:edge:/);
    expect(iriMap['urn:ui-temp:edge-3']).toMatch(/^urn:sqlib:edge:/);
    expect(iriMap['urn:ui-temp:edge-4']).toMatch(/^urn:sqlib:edge:/);
    expect(iriMap['urn:ui-temp:edge-5']).toMatch(/^urn:sqlib:edge:/);
    expect(iriMap['urn:ui-temp:edge-6']).toMatch(/^urn:sqlib:edge:/);

    // Verify diamond structure
    expect(queryGroupVersion.queryGroupVersion.executionNodes.length).toBe(4);
    expect(queryGroupVersion.queryGroupVersion.edges.length).toBe(6);

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

    expect(rdfResult).toContain('inDiamond');
    expect(rdfResult).toContain('mergedAt');
    expect(rdfResult).toContain('http://example.org/experienceLevel');
    expect(rdfResult).toContain('http://xmlns.com/foaf/0.1/name');

    console.log('✅ Diamond pattern DAG executed successfully');
    console.log(`📊 RDF output length: ${rdfResult.length} characters`);
  });
});
