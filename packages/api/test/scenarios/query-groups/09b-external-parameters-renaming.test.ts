import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { QueryTypeIri } from '../../../src/constants/queryTypes.js';
import { ScenarioTestBaseUnmocked, type ScenarioTestContext } from '../fixtures/scenario-test-base-unmocked.js';

/**
 * Scenario 09b: External Parameters with Variable Renaming (Complex Mode)
 *
 * Tests the COMPLEX mode of external parameters:
 * - StartNode defines custom QueryOutputTuple with different variable names
 * - Edge provides positional mapping between StartNode output and query input
 * - Demonstrates variable renaming at the boundary
 *
 * Expected flow:
 * 1. Query expects ?targetExperience
 * 2. External parameter is named ?experienceFilter
 * 3. StartNode.outputs = [custom-output-tuple] with ?experienceFilter
 * 4. Edge maps position 0: ?experienceFilter → ?targetExperience
 *
 * This demonstrates how to rename variables at the query group boundary
 * without modifying the underlying queries.
 */
describe('External Parameters with Variable Renaming', () => {
  let context: ScenarioTestContext;
  let backend: any;
  let library: any;
  let queryGroup: any;

  beforeAll(async () => {
    context = await ScenarioTestBaseUnmocked.createTestContext('external-parameters-renaming');

    await ScenarioTestBaseUnmocked.loadTurtleDataIntoBackend(context, 'people-skills-projects.ttl');
    backend = await ScenarioTestBaseUnmocked.createOxigraphBackend(context, 'Renaming Backend');
    library = await ScenarioTestBaseUnmocked.createLibrary(context, 'Renaming Library');
    queryGroup = await ScenarioTestBaseUnmocked.createQueryGroup(context, 'Renaming Workflow');
  }, 30000);

  afterAll(async () => {
    await ScenarioTestBaseUnmocked.cleanupTestContext(context);
  });

  it('should rename external parameter variable via custom output tuple', { timeout: 15000 }, async () => {
    // Query expects ?targetExperience
    const queryString = `
      PREFIX ex: <http://example.org/>
      PREFIX foaf: <http://xmlns.com/foaf/0.1/>

      SELECT ?person ?name WHERE {
        VALUES (?targetExperience) { (UNDEF) }

        ?person a foaf:Person ;
                foaf:name ?name ;
                ex:experienceLevel ?targetExperience .
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

    const queryVersion = await createQuery('Filter by Experience', queryString);
    const queryInputTuple = queryVersion.queryVersion.inferredInputs[0];

    const nodeId = 'urn:ui-temp:filter-people';

    // Create custom output tuple for StartNode with RENAMED variable
    const queryGroupVersionResponse = await context.app.inject({
      method: 'POST',
      url: `/query-groups/${encodeURIComponent(queryGroup.id)}/v`,
      payload: {
        queryGroupVersion: {},
        // COMPLEX MODE: Create custom output tuple with different variable name
        outputs: [
          {
            id: 'urn:ui-temp:external-var-exp-filter',
            variableName: 'experienceFilter'  // Different from query's ?targetExperience
          }
        ],
        tupleMembers: [
          {
            id: 'urn:ui-temp:external-member-exp',
            position: 0,
            variable: 'urn:ui-temp:external-var-exp-filter'
          }
        ],
        outputTuples: [
          {
            id: 'urn:ui-temp:external-output-tuple',
            name: 'External Experience Filter',
            memberEntries: ['urn:ui-temp:external-member-exp']
          }
        ],
        startNode: {
          outputs: ['urn:ui-temp:external-output-tuple']  // Custom tuple, not query's inferredInputs
        },
        endNode: {
          mediaType: 'application/sparql-results+json'
        },
        executionNodes: [
          {
            id: nodeId,
            nodeType: 'QueryNode',
            queryId: queryVersion.queryVersion.id,
            backendId: context.backendId,
            inputs: [queryInputTuple],
            outputs: [queryVersion.queryVersion.inferredOutputs[0]]
          }
        ],
        edges: [
          // Edge provides POSITIONAL MAPPING: ?experienceFilter (pos 0) → ?targetExperience (pos 0)
          {
            id: 'urn:ui-temp:edge-1',
            sourceNodeId: 'urn:__START__',
            targetNodeId: nodeId,
            dataFlowType: 'VARIABLE_BINDINGS',
            sourceOutputId: 'urn:ui-temp:external-output-tuple',  // Custom tuple
            targetInputId: queryInputTuple            // Query's inferred input
          },
          {
            id: 'urn:ui-temp:edge-2',
            sourceNodeId: nodeId,
            targetNodeId: 'urn:__END__',
            dataFlowType: 'VARIABLE_BINDINGS',
            sourceOutputId: queryVersion.queryVersion.inferredOutputs[0],
            targetInputId: queryVersion.queryVersion.inferredOutputs[0]
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
    expect(iriMap[nodeId]).toMatch(/^urn:sqlib:node:/);
    expect(iriMap['urn:ui-temp:edge-1']).toMatch(/^urn:sqlib:edge:/);
    expect(iriMap['urn:ui-temp:edge-2']).toMatch(/^urn:sqlib:edge:/);
    expect(iriMap['urn:ui-temp:external-output-tuple']).toMatch(/^urn:sqlib:output-tuple:/);
    expect(iriMap['urn:ui-temp:external-member-exp']).toMatch(/^urn:sqlib:tuple-member:/);
    expect(iriMap['urn:ui-temp:external-var-exp-filter']).toMatch(/^urn:sqlib:output:/);

    await context.app.inject({
      method: 'PUT',
      url: `/query-groups/${encodeURIComponent(queryGroup.id)}`,
      payload: {
        name: queryGroup.name,
        isPartOf: queryGroup.isPartOf,
        currentVersion: queryGroupVersion.queryGroupVersion.id
      }
    });

    // Execute with RENAMED parameter: experienceFilter = "senior"
    const executeResponse = await context.app.inject({
      method: 'POST',
      url: '/execute/',
      headers: { 'accept': 'application/sparql-results+json' },
      payload: {
        targetId: queryGroup.id,
        arguments: [
          {
            head: { vars: ['experienceFilter'] },  // External name (not targetExperience)
            arguments: {
              bindings: [
                { experienceFilter: { type: 'literal', value: 'senior' } }
              ]
            }
          }
        ]
      }
    });

    console.log('Execute Response:', executeResponse.statusCode);
    expect(executeResponse.statusCode).toBe(200);
    const result = executeResponse.json();

    // Assert the exact rows, not just "some rows": an unfiltered query also returns
    // results, so a length check cannot tell renaming from silent non-application.
    const names = (response: { results: { bindings: Array<{ name: { value: string } }> } }) =>
      response.results.bindings.map(binding => binding.name.value).sort();
    expect(names(result)).toEqual(['Alice Johnson', 'Charlie Brown', 'Diana Prince']);

    // Negative control: a value nothing matches must return nothing. If the renamed
    // parameter were dropped, this would return every person in the store.
    const noMatchResponse = await context.app.inject({
      method: 'POST',
      url: '/execute/',
      headers: { 'accept': 'application/sparql-results+json' },
      payload: {
        targetId: queryGroup.id,
        arguments: [{
          head: { vars: ['experienceFilter'] },
          arguments: { bindings: [{ experienceFilter: { type: 'literal', value: 'no-such-level' } }] },
        }],
      },
    });

    expect(noMatchResponse.statusCode).toBe(200);
    expect(noMatchResponse.json().results.bindings).toEqual([]);

    console.log('✅ Variable renaming via StartNode executed successfully');
    console.log(`📊 Found ${result.results.bindings.length} results`);
  });
});