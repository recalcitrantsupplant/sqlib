import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GroupHarness, START, END } from './harness/group-harness.js';
import { getTemplate, queryIdSelect } from './harness/query-templates.js';

/**
 * Phase 2 Layer A, execution half (docs §2.2).
 *
 * `legality-matrix.test.ts` proves the validator and the executor agree on which
 * shapes are allowed. It stops at "the run returned 200", which is deliberately
 * shallow: it has 160 cells to get through. This file takes the shapes the plan
 * singles out as never actually exercised - UPDATE mid-chain, DESCRIBE in a
 * chain, ASK feeding a VALUES clause, a RuleSetNode running inside a group,
 * multi-input EndNode merging, QUERY_ID dispatch, fan-in dedupe - and asserts
 * the exact result each one produces.
 *
 * Exactness is the point. `bindings.length > 0` is satisfied by a correctly
 * filtered result and by a completely unfiltered one alike, which is how the
 * §1.3 order bug stayed hidden through a green suite.
 */
describe('Phase 2 legal-shape execution', () => {
  let harness: GroupHarness;

  beforeAll(async () => {
    harness = await GroupHarness.create('phase2-execution');
    for (const key of [
      'things', 'labelledThings', 'noThings', 'thingByThing', 'groupByThing', 'labelByThing',
      'nameByGroup', 'echoThing', 'constructThings', 'constructByThing', 'askThings', 'askMissing',
      'describeByThing', 'updateByThing', 'scratchThings', 'groups',
    ]) {
      await harness.defineQuery(key, getTemplate(key).sparql);
    }
    await harness.defineRuleSet('derive', [
      'PREFIX ex: <http://example.org/>\nRULE { ?s a ex:Derived } WHERE { ?s a ex:Copy }',
    ]);
  }, 120000);

  afterAll(async () => {
    await harness.destroy();
  });

  const rows = (response: { statusCode: number; payload: string; json: () => any }) => {
    expect(response.statusCode, response.payload.slice(0, 500)).toBe(200);
    return response.json().results.bindings as Record<string, { value: string }>[];
  };

  const valuesOf = (response: Parameters<typeof rows>[0], variable: string) =>
    rows(response).map(row => row[variable]?.value).sort();

  const triplesOf = (response: { statusCode: number; payload: string }) => {
    expect(response.statusCode, response.payload.slice(0, 500)).toBe(200);
    return response.payload.split('\n').map(line => line.trim()).filter(Boolean).sort();
  };

  it('renames variables positionally across a chained edge', async () => {
    // `groupByThing` projects ?group; the downstream `nameByGroup` reads ?group
    // from position 0 of its own tuple. The rename is positional, not by name,
    // and a broken mapping shows up as the wrong groups rather than as an error.
    const built = await harness.build({
      nodes: [
        { key: 'a', query: 'things' },
        { key: 'b', query: 'groupByThing' },
        { key: 'c', query: 'nameByGroup' },
      ],
      edges: [
        { from: START, to: 'a', flow: 'CONTROL_FLOW' },
        { from: 'a', to: 'b', flow: 'VARIABLE_BINDINGS', source: { node: 'a', port: 'outputTuple' }, target: { node: 'b', input: 0 } },
        { from: 'b', to: 'c', flow: 'VARIABLE_BINDINGS', source: { node: 'b', port: 'outputTuple' }, target: { node: 'c', input: 0 } },
        { from: 'c', to: END, flow: 'VARIABLE_BINDINGS', source: { node: 'c', port: 'outputTuple' }, target: { node: 'c', port: 'outputTuple' } },
      ],
    });

    // All four Things sit in g1 or g2, so both names come back - and g3, which
    // no Thing belongs to, must not. Each name appears twice because the
    // upstream supplies its group twice and a single edge's rows are not
    // deduped: duplicate VALUES rows produce duplicate solutions, per SPARQL.
    // (Dedupe is a fan-in operation - see the union test below.)
    expect(valuesOf(await harness.execute(built), 'name'))
      .toEqual(['Group One', 'Group One', 'Group Two', 'Group Two']);
  }, 30000);

  it('feeds an ASK result into a downstream VALUES clause', async () => {
    const built = await harness.build({
      nodes: [
        { key: 'a', query: 'askThings' },
        { key: 'b', query: 'echoThing' },
      ],
      edges: [
        { from: START, to: 'a', flow: 'CONTROL_FLOW' },
        { from: 'a', to: 'b', flow: 'VARIABLE_BINDINGS', source: { node: 'a', port: 'boolean' }, target: { node: 'b', input: 0 } },
        { from: 'b', to: END, flow: 'VARIABLE_BINDINGS', source: { node: 'b', port: 'outputTuple' }, target: { node: 'b', port: 'outputTuple' } },
      ],
    });

    const result = rows(await harness.execute(built));
    expect(result).toHaveLength(1);
    expect(result[0].thing.value).toBe('true');
    expect((result[0].thing as any).datatype).toBe('http://www.w3.org/2001/XMLSchema#boolean');
  }, 30000);

  it('returns a false ASK verbatim over a BOOLEAN edge', async () => {
    const built = await harness.build({
      nodes: [{ key: 'a', query: 'askMissing' }],
      edges: [
        { from: START, to: 'a', flow: 'CONTROL_FLOW' },
        { from: 'a', to: END, flow: 'BOOLEAN', source: { node: 'a', port: 'boolean' }, target: { node: 'a', port: 'boolean' } },
      ],
    });

    const execution = await harness.execute(built);
    expect(execution.statusCode).toBe(200);
    expect(execution.json()).toBe(false);
  }, 30000);

  it('runs a DESCRIBE mid-chain and returns its graph', async () => {
    const built = await harness.build({
      nodes: [
        { key: 'a', query: 'groups' },
        { key: 'b', query: 'describeByThing' },
      ],
      edges: [
        { from: START, to: 'a', flow: 'CONTROL_FLOW' },
        { from: 'a', to: 'b', flow: 'VARIABLE_BINDINGS', source: { node: 'a', port: 'outputTuple' }, target: { node: 'b', input: 0 } },
        { from: 'b', to: END, flow: 'RDF_GRAPH', source: { node: 'b', port: 'rdf' }, target: { node: 'b', port: 'rdf' } },
      ],
      endNodeMediaType: 'application/n-triples',
    });

    const triples = triplesOf(await harness.execute(built, { accept: 'application/n-triples' }));
    // Each of the three Groups describes to exactly its type and its name.
    expect(triples).toHaveLength(6);
    expect(triples.filter(t => t.includes('#type'))).toHaveLength(3);
    expect(triples.some(t => t.includes('"Group Three"'))).toBe(true);
  }, 30000);

  it('applies an UPDATE mid-chain, and the change is visible downstream', async () => {
    const built = await harness.build({
      nodes: [
        { key: 'a', query: 'things' },
        { key: 'b', query: 'updateByThing' },
        { key: 'c', query: 'scratchThings' },
      ],
      edges: [
        { from: START, to: 'a', flow: 'CONTROL_FLOW' },
        { from: 'a', to: 'b', flow: 'VARIABLE_BINDINGS', source: { node: 'a', port: 'outputTuple' }, target: { node: 'b', input: 0 } },
        // The reader must run after the writer, which is the whole reason
        // CONTROL_FLOW edges exist.
        { from: 'b', to: 'c', flow: 'CONTROL_FLOW' },
        { from: 'c', to: END, flow: 'VARIABLE_BINDINGS', source: { node: 'c', port: 'outputTuple' }, target: { node: 'c', port: 'outputTuple' } },
      ],
    });

    expect(valuesOf(await harness.execute(built), 'thing')).toEqual([
      'http://example.org/t1', 'http://example.org/t2', 'http://example.org/t3', 'http://example.org/t4',
    ]);
  }, 30000);

  it('runs a RuleSetNode inside the group and returns its inferences', async () => {
    const built = await harness.build({
      nodes: [
        { key: 'a', query: 'constructThings' },
        { key: 'r', kind: 'RuleSetNode', ruleSet: 'derive' },
      ],
      declaredPorts: [
        { key: 'rIn', type: 'TriplesQuadsIO', attachTo: 'r', attachAs: 'inputs' },
        { key: 'rOut', type: 'TriplesQuadsIO', attachTo: 'r', attachAs: 'outputs' },
      ],
      edges: [
        { from: START, to: 'a', flow: 'CONTROL_FLOW' },
        { from: 'a', to: 'r', flow: 'RDF_GRAPH', source: { node: 'a', port: 'rdf' }, target: { declared: 'rIn' } },
        { from: 'r', to: END, flow: 'RDF_GRAPH', source: { declared: 'rOut' }, target: { declared: 'rOut' } },
      ],
      endNodeMediaType: 'application/n-triples',
    });

    const triples = triplesOf(await harness.execute(built, { accept: 'application/n-triples' }));
    // A RuleSetNode emits its *inferences*, not the union with what it was fed:
    // four ex:Copy triples go in, four ex:Derived come out, and the input is not
    // echoed. Worth pinning explicitly - it is the kind of thing a caller
    // assumes the other way round.
    expect(triples.filter(t => t.includes('/Derived'))).toHaveLength(4);
    expect(triples.filter(t => t.includes('/Copy'))).toHaveLength(0);
  }, 60000);

  it('merges two RDF producers at a multi-input EndNode', async () => {
    const built = await harness.build({
      nodes: [
        { key: 'a', query: 'things' },
        { key: 'b', query: 'constructByThing' },
        { key: 'c', query: 'constructThings' },
      ],
      edges: [
        { from: START, to: 'a', flow: 'CONTROL_FLOW' },
        { from: 'a', to: 'b', flow: 'VARIABLE_BINDINGS', source: { node: 'a', port: 'outputTuple' }, target: { node: 'b', input: 0 } },
        { from: 'b', to: END, flow: 'RDF_GRAPH', source: { node: 'b', port: 'rdf' }, target: { node: 'b', port: 'rdf' } },
        { from: 'c', to: END, flow: 'RDF_GRAPH', source: { node: 'c', port: 'rdf' }, target: { node: 'c', port: 'rdf' } },
      ],
      endNodeMediaType: 'application/n-triples',
    });

    // Concatenation, not set union: both producers emit the same four triples.
    expect(triplesOf(await harness.execute(built, { accept: 'application/n-triples' }))).toHaveLength(8);
  }, 30000);

  it('rejects a multi-input EndNode whose inputs are not all RDF', async () => {
    const built = await harness.build({
      nodes: [
        { key: 'a', query: 'things' },
        { key: 'b', query: 'constructThings' },
      ],
      edges: [
        { from: START, to: 'a', flow: 'CONTROL_FLOW' },
        { from: 'a', to: END, flow: 'VARIABLE_BINDINGS', source: { node: 'a', port: 'outputTuple' }, target: { node: 'a', port: 'outputTuple' } },
        { from: 'b', to: END, flow: 'RDF_GRAPH', source: { node: 'b', port: 'rdf' }, target: { node: 'b', port: 'rdf' } },
      ],
    });

    const validation = await harness.validate(built);
    expect(validation.valid).toBe(false);
    expect(validation.issues.some(i => i.code === 'END_NODE_MIXED_RESULT_TYPES')).toBe(true);
    expect((await harness.execute(built)).statusCode).toBe(400);
  }, 30000);

  it('dispatches a DynamicQueryNode through a QUERY_ID edge', async () => {
    const target = harness.queryHandle('groups');
    await harness.defineQuery('pointToGroups', queryIdSelect(target.versionId));

    const built = await harness.build({
      nodes: [
        { key: 'a', query: 'pointToGroups' },
        { key: 'd', query: 'echoThing', kind: 'DynamicQueryNode' },
      ],
      declaredPorts: [{ key: 'dQuery', type: 'QueryIdInput', attachTo: 'd', attachAs: 'inputs' }],
      edges: [
        { from: START, to: 'a', flow: 'CONTROL_FLOW' },
        { from: 'a', to: 'd', flow: 'QUERY_ID', source: { node: 'a', port: 'outputTuple' }, target: { declared: 'dQuery' } },
        { from: 'd', to: END, flow: 'VARIABLE_BINDINGS', source: { node: 'd', port: 'outputTuple' }, target: { node: 'd', port: 'outputTuple' } },
      ],
    });

    // The node was declared with `echoThing` but must have run `groups`.
    expect(valuesOf(await harness.execute(built), 'group')).toEqual([
      'http://example.org/g1', 'http://example.org/g2', 'http://example.org/g3',
    ]);
  }, 30000);

  it('unions and dedupes fan-in into a single input tuple', async () => {
    // Two upstreams overlap on t1..t3; the union must not repeat them.
    const built = await harness.build({
      nodes: [
        { key: 'a', query: 'things' },
        { key: 'b', query: 'labelledThings' },
        { key: 'c', query: 'thingByThing' },
      ],
      edges: [
        { from: START, to: 'a', flow: 'CONTROL_FLOW' },
        { from: START, to: 'b', flow: 'CONTROL_FLOW' },
        { from: 'a', to: 'c', flow: 'VARIABLE_BINDINGS', source: { node: 'a', port: 'outputTuple' }, target: { node: 'c', input: 0 } },
        { from: 'b', to: 'c', flow: 'VARIABLE_BINDINGS', source: { node: 'b', port: 'outputTuple' }, target: { node: 'c', input: 0 } },
        { from: 'c', to: END, flow: 'VARIABLE_BINDINGS', source: { node: 'c', port: 'outputTuple' }, target: { node: 'c', port: 'outputTuple' } },
      ],
    });

    expect(valuesOf(await harness.execute(built), 'thing')).toEqual([
      'http://example.org/t1', 'http://example.org/t2', 'http://example.org/t3', 'http://example.org/t4',
    ]);
  }, 30000);

  it('reports the failing node when a mid-chain node errors', async () => {
    // `nameByGroup` expects group IRIs; handing it labels is legal SPARQL but
    // matches nothing, so the node has to fail for a different reason.
    //
    // This used to author the node against a backend IRI that never existed.
    // The flat writer now rejects unresolvable references before anything is
    // written, so that shape cannot reach execution any more. Deleting the
    // backend after the group is authored reaches the same executor path and
    // is the way it actually happens in production.
    const doomedBackendId = 'urn:sqlib:backend:phase2-deleted';
    const backend = await harness.app.inject({
      method: 'POST',
      url: '/backends/',
      payload: {
        id: doomedBackendId,
        name: 'Backend deleted after authoring',
        backendType: 'oxigraphEphemeral',
      },
    });
    expect(backend.statusCode).toBe(201);

    const built = await harness.build({
      nodes: [
        { key: 'a', query: 'things' },
        { key: 'b', query: 'thingByThing', backendId: doomedBackendId },
      ],
      edges: [
        { from: START, to: 'a', flow: 'CONTROL_FLOW' },
        { from: 'a', to: 'b', flow: 'VARIABLE_BINDINGS', source: { node: 'a', port: 'outputTuple' }, target: { node: 'b', input: 0 } },
        { from: 'b', to: END, flow: 'VARIABLE_BINDINGS', source: { node: 'b', port: 'outputTuple' }, target: { node: 'b', port: 'outputTuple' } },
      ],
    });

    const deleted = await harness.app.inject({
      method: 'DELETE',
      url: `/backends/${encodeURIComponent(doomedBackendId)}`,
    });
    expect(deleted.statusCode).toBeLessThan(300);

    const execution = await harness.execute(built);
    expect(execution.statusCode).toBe(400);
    expect(execution.json().failedNodeId).toBe(built.nodeIris.b);
  }, 30000);
});
