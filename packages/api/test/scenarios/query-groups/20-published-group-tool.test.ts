import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ScenarioTestBaseUnmocked, type ScenarioTestContext } from '../fixtures/scenario-test-base-unmocked.js';
import { collectPublishedTools } from '../../../src/lib/publishedTools.js';
import { buildPublishedExecuteBody } from '@sparql-query-lib/tools';

/**
 * Scenario 20: a query group published as a tool.
 *
 * The group's start node passes `?targetExperience` to its one query, so the
 * tool's input is that variable. The `tool` object is checked against it when
 * the group version is saved, and the collected tool runs the pinned version.
 */
describe('Published group tool', () => {
  let context: ScenarioTestContext;
  let queryGroup: { id: string; name: string; isPartOf: string[] };

  beforeAll(async () => {
    context = await ScenarioTestBaseUnmocked.createTestContext('published-group-tool');
    await ScenarioTestBaseUnmocked.loadTurtleDataIntoBackend(context, 'people-skills-projects.ttl');
    await ScenarioTestBaseUnmocked.createOxigraphBackend(context, 'Tool Backend');
    await ScenarioTestBaseUnmocked.createLibrary(context, 'Tool Library');
    queryGroup = await ScenarioTestBaseUnmocked.createQueryGroup(context, 'People by experience');
  }, 30000);

  afterAll(async () => {
    await ScenarioTestBaseUnmocked.cleanupTestContext(context);
  });

  it('checks the tool object against the start node\'s variables, and publishes the group', { timeout: 20000 }, async () => {
    const queryString = `
      PREFIX ex: <http://example.org/>
      PREFIX foaf: <http://xmlns.com/foaf/0.1/>
      SELECT ?person ?name WHERE {
        VALUES (?targetExperience) { (UNDEF) }
        ?person a foaf:Person ; foaf:name ?name ; ex:experienceLevel ?targetExperience .
      }
    `;
    const query = (await context.app.inject({
      method: 'POST',
      url: '/queries/',
      payload: { name: 'By experience', isPartOf: [context.libraryId] },
    })).json();
    const version = (await context.app.inject({
      method: 'POST',
      url: `/queries/${encodeURIComponent(query.id)}/versions`,
      payload: { queryVersion: { queryString } },
    })).json().queryVersion;
    const inputTuple = version.inferredInputs[0];
    const outputTuple = version.inferredOutputs[0];
    const nodeId = 'urn:ui-temp:by-experience';

    const saveGroupVersion = (tool: unknown) =>
      context.app.inject({
        method: 'POST',
        url: `/query-groups/${encodeURIComponent(queryGroup.id)}/versions`,
        payload: {
          queryGroupVersion: { tool },
          startNode: { outputs: [inputTuple] },
          endNode: { mediaType: 'application/sparql-results+json' },
          executionNodes: [
            { id: nodeId, nodeType: 'QueryNode', queryId: version.id, backendId: context.backendId, inputs: [inputTuple], outputs: [outputTuple] },
          ],
          edges: [
            { id: 'urn:ui-temp:e1', sourceNodeId: 'urn:__START__', targetNodeId: nodeId, dataFlowType: 'VARIABLE_BINDINGS', sourceOutputId: inputTuple, targetInputId: inputTuple },
            { id: 'urn:ui-temp:e2', sourceNodeId: nodeId, targetNodeId: 'urn:__END__', dataFlowType: 'VARIABLE_BINDINGS', sourceOutputId: outputTuple, targetInputId: outputTuple },
          ],
        },
      });

    const wrong = await saveGroupVersion({ name: 'by-experience', description: 'd', params: { level: { kind: 'term' } } });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error).toBe('tool.params.level names no input of this version. Its inputs are: ?targetExperience');

    const tool = {
      name: 'by-experience',
      description: 'The people at an experience level.',
      params: { targetExperience: { kind: 'term', list: true } },
    };
    const saved = await saveGroupVersion(tool);
    expect(saved.statusCode).toBe(201);
    const groupVersion = saved.json().queryGroupVersion;
    expect(groupVersion.tool).toEqual(tool);

    const repointed = await context.app.inject({
      method: 'PUT',
      url: `/query-groups/${encodeURIComponent(queryGroup.id)}`,
      payload: { name: queryGroup.name, isPartOf: queryGroup.isPartOf, currentVersion: groupVersion.id },
    });
    expect(repointed.statusCode).toBe(200);
    const slugged = await context.app.inject({
      method: 'PUT',
      url: `/libraries/${encodeURIComponent(context.libraryId)}`,
      payload: { slug: 'experience' },
    });
    expect(slugged.statusCode).toBe(200);

    const catalogue = collectPublishedTools();
    const spec = catalogue.specs.find((s) => s.slug === 'experience' && s.name === 'by-experience');
    expect(spec).toMatchObject({
      targetId: groupVersion.id,
      targetKind: 'group',
      readOnly: true,
      inputs: { tables: [['targetExperience']], limits: [], offsets: [] },
    });

    const execute = await context.app.inject({
      method: 'POST',
      url: '/execute/',
      headers: { accept: 'application/sparql-results+json' },
      payload: buildPublishedExecuteBody(spec!, { targetExperience: ['senior'] }),
    });
    expect(execute.statusCode).toBe(200);
  });
});
