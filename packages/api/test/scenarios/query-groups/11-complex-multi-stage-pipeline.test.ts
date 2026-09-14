import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ScenarioTestBaseUnmocked, type ScenarioTestContext } from '../fixtures/scenario-test-base-unmocked.js';

/**
 * Scenario 11: Complex Multi-Stage Pipeline
 *
 * Complexity: Combines multiple previous patterns:
 * - External parameters via StartNode
 * - Diamond pattern (branch and merge)
 * - Multiple input tuples
 * - Mixed SELECT and CONSTRUCT queries
 * - Three-level depth
 *
 * Expected flow:
 *              START (with params)
 *                     |
 *                   Q1 (filter)
 *                  /    \
 *               Q2a      Q2b
 *              (skills) (projects)
 *                  \    /
 *                   Q3 (match)
 *                    |
 *                   Q4 (construct)
 *                    |
 *                   END
 *
 * This represents a realistic workflow:
 * 1. Accept experience level parameter
 * 2. Find matching people
 * 3. Branch to get their skills AND available projects in parallel
 * 4. Match people to projects based on skills
 * 5. Generate assignment RDF
 */
describe('Complex Multi-Stage Pipeline', () => {
  let context: ScenarioTestContext;
  let queryGroup: any;

  beforeAll(async () => {
    context = await ScenarioTestBaseUnmocked.createTestContext('complex-pipeline');

    await ScenarioTestBaseUnmocked.loadTurtleDataIntoBackend(context, 'people-skills-projects.ttl');
    await ScenarioTestBaseUnmocked.createOxigraphBackend(context, 'Pipeline Backend');
    await ScenarioTestBaseUnmocked.createLibrary(context, 'Pipeline Library');
    queryGroup = await ScenarioTestBaseUnmocked.createQueryGroup(context, 'Assignment Pipeline');
  }, 30000);

  afterAll(async () => {
    await ScenarioTestBaseUnmocked.cleanupTestContext(context);
  });

  it('should execute complex multi-stage pipeline', { timeout: 15000 }, async () => {
    // Q1: Filter people by experience level (from StartNode parameter)
    const q1String = `
      PREFIX ex: <http://example.org/>
      PREFIX foaf: <http://xmlns.com/foaf/0.1/>

      SELECT ?person ?name WHERE {
        VALUES (?experienceLevel) { (UNDEF) }

        ?person a foaf:Person ;
                foaf:name ?name ;
                ex:experienceLevel ?experienceLevel .
      }
    `;

    // Q2a: Get skills for filtered people (left branch)
    const q2aString = `
      PREFIX ex: <http://example.org/>
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>

      SELECT ?p ?skill ?skillLabel WHERE {
        VALUES (?p ?n) { (UNDEF UNDEF) }

        ?p ex:hasSkill ?skill .
        ?skill rdfs:label ?skillLabel .
      }
    `;

    // Q2b: Get available projects (right branch, independent of people)
    const q2bString = `
      PREFIX ex: <http://example.org/>
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>

      SELECT ?project ?projectName ?requiredSkill WHERE {
        ?project a ex:Project ;
                rdfs:label ?projectName ;
                ex:requiredSkill ?requiredSkill ;
                ex:status "planning" .
      }
    `;

    // Q3: Match people to projects based on skills (merge point)
    // This has TWO input tuples: one from Q2a (people+skills), one from Q2b (projects+required skills)
    const q3String = `
      SELECT ?person ?project WHERE {
        # Input from Q2a: people and their skills
        VALUES (?person ?skill ?skillLabel) { (UNDEF UNDEF UNDEF) }

        # Input from Q2b: projects and required skills
        VALUES (?project ?projectName ?requiredSkill) { (UNDEF UNDEF UNDEF) }

        # Match where person has the required skill
        FILTER(?skill = ?requiredSkill)
      }
    `;

    // Q4: Generate assignment RDF
    const q4String = `
      PREFIX ex: <http://example.org/>

      CONSTRUCT {
        ?assignment ex:assignee ?person ;
                   ex:assignedProject ?project ;
                   ex:createdAt ?timestamp ;
                   ex:status "proposed" .
      }
      WHERE {
        VALUES (?person ?project) { (UNDEF UNDEF) }

        BIND(IRI(CONCAT("http://example.org/assignment/", ENCODE_FOR_URI(STR(?person)), "-", ENCODE_FOR_URI(STR(?project)))) AS ?assignment)
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

    const q1Version = await createQuery('Filter People', q1String);
    const q2aVersion = await createQuery('Get Skills', q2aString);
    const q2bVersion = await createQuery('Get Projects', q2bString);
    const q3Version = await createQuery('Match Skills', q3String);
    const q4Version = await createQuery('Generate Assignments', q4String);

    if (!q3Version.queryVersion) {
      console.error('Q3Version structure:', JSON.stringify(q3Version, null, 2));
      throw new Error(`Q3 Version is missing queryVersion: ${JSON.stringify(q3Version)}`);
    }

    // Verify Q3 has TWO input tuples (one from each branch)
    expect(q3Version.queryVersion.inferredInputs.length).toBe(2);

    // Identify which tuple is which based on variable names
    const findTupleByVariable = (version: any, varName: string) => {
      const toMemberIds = (tuple: any) => {
        if (Array.isArray(tuple.memberEntries)) return tuple.memberEntries;
        if (Array.isArray(tuple.members)) return tuple.members;
        return [];
      };

      return version.inputTuples.find((tuple: any) => {
        const memberIds = toMemberIds(tuple);
        const members = version.tupleMembers.filter((m: any) =>
          memberIds.includes(m.id)
        );
        return members.some((m: any) => {
          const input = version.inputs.find((i: any) => i.id === (m.memberId ?? m.variable));
          return input?.variableName === varName;
        });
      });
    };

    const q3PeopleSkillsTuple = findTupleByVariable(q3Version, 'person');
    const q3ProjectsTuple = findTupleByVariable(q3Version, 'project');

    const node1Id = 'urn:ui-temp:filter-people';
    const node2aId = 'urn:ui-temp:get-skills';
    const node2bId = 'urn:ui-temp:get-projects';
    const node3Id = 'urn:ui-temp:match-skills';
    const node4Id = 'urn:ui-temp:generate-assignments';

    const payload = {
      queryGroupVersion: { },
      startNode: {
        // StartNode provides experienceLevel parameter
        outputs: [q1Version.queryVersion.inferredInputs[0]]
      },
      endNode: {
        mediaType: 'application/n-triples'
      },
      executionNodes: [
        {
          id: node1Id,
          nodeType: 'QueryNode',
          queryId: q1Version.queryVersion.id,
          backendId: context.backendId,
          inputs: [q1Version.queryVersion.inferredInputs[0]],
          outputs: [q1Version.queryVersion.inferredOutputs[0]]
        },
          {
            id: node2aId,
            nodeType: 'QueryNode',
            queryId: q2aVersion.queryVersion.id,
            backendId: context.backendId,
            inputs: [q2aVersion.queryVersion.inferredInputs[0]],
            outputs: [q2aVersion.queryVersion.inferredOutputs[0]]
          },
          {
            id: node2bId,
            nodeType: 'QueryNode',
            queryId: q2bVersion.queryVersion.id,
            backendId: context.backendId,
            outputs: [q2bVersion.queryVersion.inferredOutputs[0]]
          },
          {
            id: node3Id,
            nodeType: 'QueryNode',
            queryId: q3Version.queryVersion.id,
            backendId: context.backendId,
            inputs: [q3PeopleSkillsTuple.id, q3ProjectsTuple.id],
            outputs: [q3Version.queryVersion.inferredOutputs[0]]
          },
          {
            id: node4Id,
            nodeType: 'QueryNode',
            queryId: q4Version.queryVersion.id,
            backendId: context.backendId,
            inputs: [q4Version.queryVersion.inferredInputs[0]],
            outputs: [q4Version.queryVersion.inferredOutputs[0]]
          }
        ],
        edges: [
          // START → Q1 (with parameter)
          {
            id: 'urn:ui-temp:edge-1',
            sourceNodeId: 'urn:__START__',
            targetNodeId: node1Id,
            dataFlowType: 'VARIABLE_BINDINGS',
            sourceOutputId: q1Version.queryVersion.inferredInputs[0],
            targetInputId: q1Version.queryVersion.inferredInputs[0]
          },
          // START → Q2b (independent project query)
          {
            id: 'urn:ui-temp:edge-2',
            sourceNodeId: 'urn:__START__',
            targetNodeId: node2bId,
            dataFlowType: 'CONTROL_FLOW'
          },
          // Q1 → Q2a (people to skills)
          {
            id: 'urn:ui-temp:edge-3',
            sourceNodeId: node1Id,
            targetNodeId: node2aId,
            dataFlowType: 'VARIABLE_BINDINGS',
            sourceOutputId: q1Version.queryVersion.inferredOutputs[0],
            targetInputId: q2aVersion.queryVersion.inferredInputs[0]
          },
          // Q2a → Q3 (skills to matcher, first input tuple)
          {
            id: 'urn:ui-temp:edge-4',
            sourceNodeId: node2aId,
            targetNodeId: node3Id,
            dataFlowType: 'VARIABLE_BINDINGS',
            sourceOutputId: q2aVersion.queryVersion.inferredOutputs[0],
            targetInputId: q3PeopleSkillsTuple.id
          },
          // Q2b → Q3 (projects to matcher, second input tuple)
          {
            id: 'urn:ui-temp:edge-5',
            sourceNodeId: node2bId,
            targetNodeId: node3Id,
            dataFlowType: 'VARIABLE_BINDINGS',
            sourceOutputId: q2bVersion.queryVersion.inferredOutputs[0],
            targetInputId: q3ProjectsTuple.id
          },
          // Q3 → Q4 (matches to assignments)
          {
            id: 'urn:ui-temp:edge-6',
            sourceNodeId: node3Id,
            targetNodeId: node4Id,
            dataFlowType: 'VARIABLE_BINDINGS',
            sourceOutputId: q3Version.queryVersion.inferredOutputs[0],
            targetInputId: q4Version.queryVersion.inferredInputs[0]
          },
          // Q4 → END (final RDF)
          {
            id: 'urn:ui-temp:edge-7',
            sourceNodeId: node4Id,
            targetNodeId: 'urn:__END__',
            dataFlowType: 'RDF_GRAPH',
            sourceOutputId: q4Version.queryVersion.inferredOutputs[0],
            targetInputId: q4Version.queryVersion.inferredOutputs[0]
          }
        ]
    };

    const queryGroupVersionResponse = await context.app.inject({
      method: 'POST',
      url: `/query-groups/${encodeURIComponent(queryGroup.id)}/v`,
      payload
    });

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
    expect(iriMap[node4Id]).toMatch(/^urn:sqlib:node:/);
    expect(iriMap['urn:ui-temp:edge-1']).toMatch(/^urn:sqlib:edge:/);
    expect(iriMap['urn:ui-temp:edge-2']).toMatch(/^urn:sqlib:edge:/);
    expect(iriMap['urn:ui-temp:edge-3']).toMatch(/^urn:sqlib:edge:/);
    expect(iriMap['urn:ui-temp:edge-4']).toMatch(/^urn:sqlib:edge:/);
    expect(iriMap['urn:ui-temp:edge-5']).toMatch(/^urn:sqlib:edge:/);
    expect(iriMap['urn:ui-temp:edge-6']).toMatch(/^urn:sqlib:edge:/);
    expect(iriMap['urn:ui-temp:edge-7']).toMatch(/^urn:sqlib:edge:/);

    // Verify complex structure
    expect(queryGroupVersion.queryGroupVersion.executionNodes.length).toBe(5);
    expect(queryGroupVersion.queryGroupVersion.edges.length).toBe(7);

    await context.app.inject({
      method: 'PUT',
      url: `/query-groups/${encodeURIComponent(queryGroup.id)}`,
      payload: {
        name: queryGroup.name,
        isPartOf: queryGroup.isPartOf,
        currentVersion: queryGroupVersion.queryGroupVersion.id
      }
    });

    // Execute with parameter: senior developers
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

    expect(executeResponse.statusCode).toBe(200);
    const rdfResult = executeResponse.body;

    expect(rdfResult).toContain('assignee');
    expect(rdfResult).toContain('assignedProject');
    expect(rdfResult).toContain('createdAt');
    expect(rdfResult).toContain('proposed');

    console.log('✅ Complex multi-stage pipeline executed successfully');
    console.log(`📊 RDF output length: ${rdfResult.length} characters`);
    console.log('🎯 Pipeline: Filter → Branch (Skills + Projects) → Match → Generate RDF');
  });
});
