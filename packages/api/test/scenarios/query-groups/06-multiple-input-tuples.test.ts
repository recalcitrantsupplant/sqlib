import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { QueryTypeIri } from '../../../src/constants/queryTypes.js';
import { ScenarioTestBaseUnmocked, type ScenarioTestContext } from '../fixtures/scenario-test-base-unmocked.js';

/**
 * Scenario 6: Multiple Input Tuples
 *
 * Complexity added from parallel branch-merge:
 * - Query with multiple distinct VALUES clauses (multiple input tuples)
 * - Different upstream queries feed different input tuples
 * - Tests tuple-specific edge targeting
 *
 * Expected flow:
 * 1. Query 1a: SELECT people → outputs (?person)
 * 2. Query 1b: SELECT projects → outputs (?project)
 * 3. Query 2: Has TWO input tuples:
 *    - VALUES (?p) { (UNDEF) } for people
 *    - VALUES (?proj) { (UNDEF) } for projects
 *    Then matches them to create assignments
 *
 * This tests the ability to wire different edges to different input tuples
 * on the same target node.
 */
describe('Multiple Input Tuples', () => {
  let context: ScenarioTestContext;
  let backend: any;
  let library: any;
  let queryGroup: any;

  beforeAll(async () => {
    context = await ScenarioTestBaseUnmocked.createTestContext('multiple-input-tuples');

    await ScenarioTestBaseUnmocked.loadTurtleDataIntoBackend(context, 'people-skills-projects.ttl');
    backend = await ScenarioTestBaseUnmocked.createOxigraphBackend(context, 'Multi-Input Backend');
    library = await ScenarioTestBaseUnmocked.createLibrary(context, 'Multi-Input Library');
    queryGroup = await ScenarioTestBaseUnmocked.createQueryGroup(context, 'Multi-Input Workflow');
  }, 30000);

  afterAll(async () => {
    await ScenarioTestBaseUnmocked.cleanupTestContext(context);
  });

  it('should execute query with multiple input tuples from different sources', { timeout: 15000 }, async () => {
    // Query 1a: Get people URIs
    const query1aString = `
      PREFIX foaf: <http://xmlns.com/foaf/0.1/>

      SELECT ?person WHERE {
        ?person a foaf:Person .
      }
      LIMIT 2
    `;

    // Query 1b: Get project URIs
    const query1bString = `
      PREFIX ex: <http://example.org/>

      SELECT ?project WHERE {
        ?project a ex:Project .
      }
      LIMIT 2
    `;

    // Query 2: Match people to projects using TWO separate input tuples
    const query2String = `
      PREFIX ex: <http://example.org/>
      PREFIX foaf: <http://xmlns.com/foaf/0.1/>
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>

      SELECT ?p ?personName ?proj ?projectName WHERE {
        # First input tuple for people
        VALUES (?p) { (UNDEF) }

        # Second input tuple for projects
        VALUES (?proj) { (UNDEF) }

        # Get names
        ?p foaf:name ?personName .
        ?proj rdfs:label ?projectName .

        # Match skills (simplified - just create cartesian product)
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
            queryType: QueryTypeIri.select,
          }
        }
      });
      return versionResponse.json();
    };

    const query1aVersion = await createQuery('Get People', query1aString);
    const query1bVersion = await createQuery('Get Projects', query1bString);
    const query2Version = await createQuery('Match People to Projects', query2String);

    // Verify Query 2 has TWO input tuples
    expect(query2Version.queryVersion.inferredInputs).toBeDefined();
    expect(query2Version.queryVersion.inferredInputs.length).toBe(2);
    expect(query2Version.inputTuples.length).toBe(2);

    // Identify which tuple is for people (?p) and which is for projects (?proj)
    const getTupleMembers = (tuple: any) => {
      const memberIds: string[] = Array.isArray(tuple.memberEntries)
        ? tuple.memberEntries
        : Array.isArray(tuple.members)
          ? tuple.members
          : [];
      const members = query2Version.tupleMembers.filter((m: any) =>
        memberIds.includes(m.id)
      );
      return { memberIds, members };
    };

    const peopleTuple = query2Version.inputTuples.find((tuple: any) => {
      const { members } = getTupleMembers(tuple);
      return members.some((m: any) => {
        const input = query2Version.inputs.find((i: any) => i.id === (m.memberId ?? m.variable));
        return input?.variableName === 'p';
      });
    });

    const projectsTuple = query2Version.inputTuples.find((tuple: any) => {
      const { members } = getTupleMembers(tuple);
      return members.some((m: any) => {
        const input = query2Version.inputs.find((i: any) => i.id === (m.memberId ?? m.variable));
        return input?.variableName === 'proj';
      });
    });

    expect(peopleTuple).toBeDefined();
    expect(projectsTuple).toBeDefined();

    // Create Query Group Version
    const node1aId = 'urn:ui-temp:source-people';
    const node1bId = 'urn:ui-temp:source-projects';
    const node2Id = 'urn:ui-temp:matcher';

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
            id: node1aId,
            nodeType: 'QueryNode',
            queryId: query1aVersion.queryVersion.id,
            backendId: context.backendId,
            outputs: [query1aVersion.queryVersion.inferredOutputs[0]]
          },
          {
            id: node1bId,
            nodeType: 'QueryNode',
            queryId: query1bVersion.queryVersion.id,
            backendId: context.backendId,
            outputs: [query1bVersion.queryVersion.inferredOutputs[0]]
          },
          {
            id: node2Id,
            nodeType: 'QueryNode',
            queryId: query2Version.queryVersion.id,
            backendId: context.backendId,
            // Node has TWO input tuples
            inputs: [peopleTuple.id, projectsTuple.id],
            outputs: [query2Version.queryVersion.inferredOutputs[0]]
          }
        ],
        edges: [
          {
            id: 'urn:ui-temp:edge-1',
            sourceNodeId: 'urn:__START__',
            targetNodeId: node1aId,
            dataFlowType: 'CONTROL_FLOW'
          },
          {
            id: 'urn:ui-temp:edge-2',
            sourceNodeId: 'urn:__START__',
            targetNodeId: node1bId,
            dataFlowType: 'CONTROL_FLOW'
          },
          // Edge from people query to people input tuple
          {
            id: 'urn:ui-temp:edge-3',
            sourceNodeId: node1aId,
            targetNodeId: node2Id,
            dataFlowType: 'VARIABLE_BINDINGS',
            sourceOutputId: query1aVersion.queryVersion.inferredOutputs[0],
            targetInputId: peopleTuple.id
          },
          // Edge from projects query to projects input tuple
          {
            id: 'urn:ui-temp:edge-4',
            sourceNodeId: node1bId,
            targetNodeId: node2Id,
            dataFlowType: 'VARIABLE_BINDINGS',
            sourceOutputId: query1bVersion.queryVersion.inferredOutputs[0],
            targetInputId: projectsTuple.id
          },
          {
            id: 'urn:ui-temp:edge-5',
            sourceNodeId: node2Id,
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
    expect(iriMap[node1aId]).toMatch(/^urn:sqlib:node:/);
    expect(iriMap[node1bId]).toMatch(/^urn:sqlib:node:/);
    expect(iriMap[node2Id]).toMatch(/^urn:sqlib:node:/);
    expect(iriMap['urn:ui-temp:edge-1']).toMatch(/^urn:sqlib:edge:/);
    expect(iriMap['urn:ui-temp:edge-2']).toMatch(/^urn:sqlib:edge:/);
    expect(iriMap['urn:ui-temp:edge-3']).toMatch(/^urn:sqlib:edge:/);
    expect(iriMap['urn:ui-temp:edge-4']).toMatch(/^urn:sqlib:edge:/);
    expect(iriMap['urn:ui-temp:edge-5']).toMatch(/^urn:sqlib:edge:/);

    expect(queryGroupVersion.queryGroupVersion.executionNodes.length).toBe(3);
    expect(queryGroupVersion.queryGroupVersion.edges.length).toBe(5);

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
      headers: { 'accept': 'application/sparql-results+json' },
      payload: {
        targetId: queryGroup.id
      }
    });

    console.log('Execute Response:', executeResponse.statusCode, executeResponse.body);
    expect(executeResponse.statusCode).toBe(200);
    const result = executeResponse.json();

    expect(result.head.vars).toContain('p');
    expect(result.head.vars).toContain('proj');
    expect(result.results.bindings.length).toBeGreaterThan(0);

    console.log('✅ Multiple input tuples executed successfully');
    console.log(`📊 Result rows: ${result.results.bindings.length}`);
  });
});