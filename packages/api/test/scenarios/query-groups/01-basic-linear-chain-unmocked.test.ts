import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { QueryTypeIri } from '../../../src/constants/queryTypes.js';
import { ScenarioTestBaseUnmocked, type ScenarioTestContext } from '../fixtures/scenario-test-base-unmocked.js';

/**
 * Basic Linear Chain Scenario Test (UNMOCKED VERSION)
 *
 * This version tests the real functionality without mocking the persistence layer.
 * Purpose: Verify that autoAllOutputsTuple and related data structures work correctly.
 */
describe('Basic Linear Chain Scenario (Unmocked)', () => {
  let context: ScenarioTestContext;

  beforeAll(async () => {
    context = await ScenarioTestBaseUnmocked.createTestContext('basic-linear-chain-unmocked');
  }, 30000);

  afterAll(async () => {
    await ScenarioTestBaseUnmocked.cleanupTestContext(context);
  });

  it('should create query version with proper inferredoutputs data', async () => {
    // === SETUP: Load data and create infrastructure ===

    // Load turtle data into Oxigraph backend
    await ScenarioTestBaseUnmocked.loadTurtleDataIntoBackend(context, 'people-skills-projects.ttl');

    // Create Oxigraph backend via API
    const backend = await ScenarioTestBaseUnmocked.createOxigraphBackend(context, 'People Skills Projects Backend');
    expect(backend.id).toBe(context.backendId);
    expect(backend.backendType).toBe('oxigraphEphemeral');

    // Create library
    const library = await ScenarioTestBaseUnmocked.createLibrary(context, 'Skills Management Library');
    expect(library.id).toBe(context.libraryId);

    // Create query group
    const queryGroup = await ScenarioTestBaseUnmocked.createQueryGroup(context, 'People-Skills-Projects Workflow');
    expect(queryGroup.name).toBe('People-Skills-Projects Workflow');

    // === QUERY SETUP: Load SPARQL queries ===

    const query1 = await ScenarioTestBaseUnmocked.readQueryFile('basic-linear-chain-query1.sparql');

    // === STEP 1: Create individual query first ===
    console.log('Creating Query 1...');
    const query1Response = await context.app.inject({
      method: 'POST',
      url: '/queries/',
      payload: {
        name: 'Find People with Required Skills',
        description: 'Finds people who have specific skills',
        isPartOf: [context.libraryId]
      }
    });

    if (query1Response.statusCode !== 201) {
      console.error('Query 1 creation failed:', query1Response.statusCode);
      console.error('Response:', query1Response.json());
    }
    expect(query1Response.statusCode).toBe(201);
    const query1Entity = query1Response.json();
    console.log('Query 1 created:', query1Entity.id);

    // === STEP 2: Create query version ===
    console.log('Creating Query 1 version...');
    const query1VersionResponse = await context.app.inject({
      method: 'POST',
      url: `/queries/${encodeURIComponent(query1Entity.id)}/v`,
      payload: {
        queryVersion: {
          queryString: query1,
          queryType: QueryTypeIri.select
        }
      }
    });

    if (query1VersionResponse.statusCode !== 201) {
      console.error('Query 1 version creation failed:', query1VersionResponse.statusCode);
      console.error('Response:', query1VersionResponse.json());
    }
    expect(query1VersionResponse.statusCode).toBe(201);

    // DEBUG: Log raw response body
    console.log('=== RAW RESPONSE BODY ===');
    console.log(query1VersionResponse.body);
    console.log('=== END RAW RESPONSE BODY ===');

    const query1Version = query1VersionResponse.json();

    // DEBUG: Log parsed JSON
    console.log(JSON.stringify(query1Version, null, 2));

    console.log('Query 1 version created:', query1Version.queryVersion.id);
    console.log('Full Query 1 version response:', JSON.stringify(query1Version, null, 2));

    // === VERIFICATION: Check that we get the expected data structures ===

    // 1. The queryVersion should have inferredOutputs
    expect(query1Version.queryVersion.inferredOutputs).toBeDefined();
    expect(Array.isArray(query1Version.queryVersion.inferredOutputs)).toBe(true);
    expect(query1Version.queryVersion.inferredOutputs[0]).toMatch(/^urn:sqlib:output-tuple:/);

    const autoTuple = query1Version.outputTuples.find((tuple: any) =>
      tuple.id === query1Version.queryVersion.inferredOutputs[0]
    );
    expect(autoTuple).toBeDefined();
    expect(autoTuple.name).toBe('All query outputs');

    // 5. The expanded response should include tuple members
    expect(query1Version.tupleMembers).toBeDefined();
    expect(Array.isArray(query1Version.tupleMembers)).toBe(true);
    expect(query1Version.tupleMembers.length).toBe(4); // One for each output variable

    // 6. The expanded response should include the actual output entities
    expect(query1Version.outputs).toBeDefined();
    expect(Array.isArray(query1Version.outputs)).toBe(true);
    expect(query1Version.outputs.length).toBe(4); // The actual QueryOutput entities

    // Verify the outputs have the expected variable names
    const outputVariableNames = query1Version.outputs.map((output: any) => output.variableName).sort();
    expect(outputVariableNames).toEqual(['person', 'personName', 'skill', 'skillLabel']);

    console.log('✅ Query version created with proper autoAllOutputsTuple data structure');
    console.log(`📊 Found ${query1Version.outputs.length} outputs with unique IDs`);
    console.log(`🔗 Found ${query1Version.tupleMembers.length} tuple members`);
    console.log(`📋 Found ${query1Version.outputTuples.length} output tuples`);
  });
});
