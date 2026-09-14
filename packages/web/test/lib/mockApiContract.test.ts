import { describe, it, expect } from 'vitest';
import {
  backendSchema,
  librarySchema,
  querySchema,
  queryGroupSchema,
  queryGroupVersionSchema,
  queryGroupVersionExpandedSchema,
  queryGroupVersionForGroupCreateSchema,
  ruleSetSchema,
  ruleSetVersionSchema,
} from '@sparql-query-lib/contracts';
import {
  ARGUMENT_SET_ID,
  BACKEND_ID,
  buildVersionCreateResponse,
  createMockState,
  END_NODE_ID,
  EXISTING_QUERY_VERSION_ID,
  GROUP_ID,
  QUERY_NODE_ID,
  START_NODE_ID,
  START_TUPLE_PORT,
  UPDATE_QUERY_VERSION_ID,
  wrapExecutionResponse,
} from '../../tests/e2e/fixtures/query-group-mock-state';

/**
 * Mock-drift guard (issue #47, item 3).
 *
 * The query group e2e specs run entirely against `createMockState` — an 800-line
 * executable description of the API that nothing verified. A mock that has
 * drifted from the real contract does something worse than fail: it keeps
 * passing, while testing a backend that no longer exists.
 *
 * Replaying it through the same contracts schemas the client validates against
 * makes the fixture answer to the contract. It is deliberately cheap and blunt:
 * it does not check the mock's *behaviour*, only that every entity it hands back
 * is a shape the real client would accept.
 */
describe('e2e mock state matches the API contract', () => {
  const state = createMockState();

  /** Parse every item and report the first failure with its index and id. */
  const expectAll = (label: string, items: unknown[], schema: { safeParse: (v: unknown) => any }) => {
    expect(items.length, `${label}: fixture is empty, so this assertion proves nothing`).toBeGreaterThan(0);
    items.forEach((item, index) => {
      const parsed = schema.safeParse(item);
      const id = (item as { id?: string })?.id ?? `#${index}`;
      expect(
        parsed.success ? null : JSON.stringify(parsed.error.issues.slice(0, 3)),
        `${label}[${id}] does not match the contract`,
      ).toBeNull();
    });
  };

  it('serves backends, libraries and queries the client would accept', () => {
    expectAll('backends', state.backends, backendSchema);
    expectAll('libraries', state.libraries, librarySchema);
    expectAll('queries', state.queries, querySchema);
  });

  it('serves query groups and their versions', () => {
    expectAll('queryGroups', state.queryGroups, queryGroupSchema);
    for (const [groupId, versions] of Object.entries(state.queryGroupVersions)) {
      expectAll(`queryGroupVersions[${groupId}]`, versions, queryGroupVersionSchema);
    }
  });

  it('serves rule sets and their versions', () => {
    // What a RuleSetNode is assigned from. The selector reads the list and then
    // each rule set's versions, and validates both against these schemas — a
    // fixture that drifts here fails inside a dialog, where it reads as an
    // empty list rather than as a parse error.
    expectAll('ruleSets', state.ruleSets, ruleSetSchema);
    for (const [ruleSetId, versions] of Object.entries(state.ruleSetVersions)) {
      expectAll(`ruleSetVersions[${ruleSetId}]`, versions, ruleSetVersionSchema);
    }
  });

  it('keeps expanded versions internally consistent', () => {
    // The expanded form is what the canvas loads, and a dangling reference here
    // would surface as a blank canvas in a spec that still reports green.
    for (const [groupId, byVersion] of Object.entries(state.queryGroupExpanded)) {
      for (const [version, expanded] of Object.entries(byVersion)) {
        const where = `${groupId} v${version}`;
        const nodeIds = new Set([
          ...(expanded.executionNodes ?? []).map((node: any) => node.id),
          expanded.startNode?.id,
          expanded.endNode?.id,
        ].filter(Boolean));

        for (const edge of (expanded.edges ?? []) as any[]) {
          expect(nodeIds.has(edge.sourceNodeId), `${where}: edge ${edge.id} has a dangling source`).toBe(true);
          expect(nodeIds.has(edge.targetNodeId), `${where}: edge ${edge.id} has a dangling target`).toBe(true);
        }

        // Every id the version lists must actually be present in the payload.
        const listed = (expanded.queryGroupVersion as any)?.executionNodes ?? [];
        for (const id of listed) {
          expect(nodeIds.has(id), `${where}: lists node ${id} but does not include it`).toBe(true);
        }
      }
    }
  });

  /*
   * Argument sets have no generated contracts schema, so there is nothing to
   * replay them through — what can be checked is what the fixture *means*,
   * which is the half of the guard that has caught every gap so far anyway.
   *
   * The shape is held to the client's own Zod parse instead: the e2e specs read
   * these sets back through `useApiClient`, which throws on a response the real
   * client would refuse, so a wrong shape reds a spec rather than passing here.
   */
  describe('argument sets', () => {
    const setsById = new Map(state.argumentSets.map((set) => [set.id, set]));

    it('points every set at a version, a target and a library the mock serves', () => {
      expect(state.argumentSets.length, 'no argument sets: this assertion proves nothing').toBeGreaterThan(0);
      const libraryIds = new Set(state.libraries.map((library) => library.id));
      const queryIds = new Set(state.queries.map((query) => query.id));
      const groupIds = new Set(state.queryGroups.map((group) => group.id));

      for (const set of state.argumentSets) {
        const versions = state.argumentSetVersions[set.id] ?? [];
        const current = versions.find((version) => version.id === set.currentVersionId);
        expect(current, `${set.id}: currentVersionId names no version the mock serves`).toBeDefined();
        expect(current?.isPartOf, `${set.id}: its current version points at another set`).toBe(set.id);
        // The expansion mirrors the current version onto the set itself; a
        // fixture where the two disagree describes a server that cannot exist.
        expect(set.tupleBindings, `${set.id}: set bindings differ from its current version`)
          .toEqual(current?.tupleBindings);
        expect(libraryIds.has(set.libraryId), `${set.id}: unknown library ${set.libraryId}`).toBe(true);

        const target = set.targetId ?? '';
        const known = set.scope === 'query' ? queryIds.has(target) : groupIds.has(target);
        expect(known, `${set.id}: scope ${set.scope} names ${target}, which the mock does not serve`).toBe(true);
      }
    });

    it('returns rows the way the server expands them, not the way a client sends them', () => {
      // `expandTupleBinding` synthesises a row id and position; a fixture that
      // echoed the request body would have neither, and a spec asserting on
      // them would be asserting on a response no server produces.
      for (const versions of Object.values(state.argumentSetVersions)) {
        for (const version of versions) {
          for (const binding of version.tupleBindings) {
            expect(binding.id, `${version.id}: a binding with no id`).toBeTruthy();
            expect(binding.tupleSignature, `${version.id}: a binding with no signature`)
              .toBe((binding.variables ?? []).join('|'));
            binding.rows.forEach((row, position) => {
              expect(row.id, `${version.id}: row ${position} has no id`).toBeTruthy();
              expect(row.position, `${version.id}: row ${position} is not positioned`).toBe(position);
            });
          }
        }
      }
    });

    it('gives the group a set that actually fits its start node', () => {
      /*
       * The switcher lists any set in the library and judges each against the
       * group's signature, so a fixture whose only group-scoped set did not fit
       * would make every "pick a set and run" spec unreachable — and would look
       * exactly like a passing fixture.
       */
      const expanded = Object.values(state.queryGroupExpanded[GROUP_ID])[0];
      const variableNames = new Map(
        (expanded.inputs ?? []).map((input) => [input.id, input.variableName]),
      );
      const memberVariables = new Map(
        (expanded.tupleMembers ?? []).map((member) => [member.id, member.variable]),
      );
      const startTuple = (expanded.inputTuples ?? []).find((tuple) => tuple.id === START_TUPLE_PORT);
      expect(startTuple, 'the start node declares no input tuple to fill').toBeDefined();
      const declared = (startTuple?.memberEntries ?? [])
        .map((id) => variableNames.get(memberVariables.get(id) ?? ''));

      const binding = setsById.get(ARGUMENT_SET_ID)?.currentVersion.tupleBindings[0];
      expect(binding?.variables, 'the seeded group set does not fill the start tuple').toEqual(declared);
    });
  });

  it('references only queries and backends the mock also serves', () => {
    // A node pointing at a query version the mock never returns is the drift
    // that turns into "the canvas renders but the node is empty".
    const queryVersionIds = new Set(
      Object.values(state.queryVersions).flat().map(version => version.id),
    );
    const backendIds = new Set(state.backends.map(backend => backend.id));

    for (const byVersion of Object.values(state.queryGroupExpanded)) {
      for (const expanded of Object.values(byVersion)) {
        for (const node of ((expanded as any).executionNodes ?? []) as any[]) {
          if (node.queryId) {
            expect(queryVersionIds.has(node.queryId), `node ${node.id} references unknown query version ${node.queryId}`).toBe(true);
          }
          if (node.backendId) {
            expect(backendIds.has(node.backendId), `node ${node.id} references unknown backend ${node.backendId}`).toBe(true);
          }
        }
      }
    }
  });

  /*
   * The other half of the mock, and the half the assertions above cannot see.
   *
   * `createMockState` is what the canvas *loads*; `buildVersionCreateResponse`
   * is what it gets back when it *saves*, and that one has real work to do —
   * the client sends drafts and the client's own schema demands entities. Every
   * field the response has to add rather than echo is a place the mock can be
   * wrong while the fixture stays perfectly valid, and a wrong one is invisible
   * in a spec: the save posts, the parse throws, and the canvas simply does not
   * advance to the new version.
   *
   * That is exactly how it was wrong. `QueryIdInput.isPartOf` is required on the
   * way out and stripped on the way in, so the server derives it from the node
   * declaring the port (`GroupVersionWriter`) — and echoing the draft instead
   * meant no group with a dynamic query node's Query ID input could be saved
   * through this mock at all.
   */
  const DYNAMIC_NODE_ID = 'urn:sqlib:node:dynamic';
  const QUERY_ID_PORT = 'urn:sqlib:query-id-input:which-query';
  const START_TUPLE = 'urn:sqlib:input-tuple:start-binding';
  const QUERY_ID_EDGE = 'urn:sqlib:edge:query-id';

  /** A create payload of the shape `buildVersionCreatePayload` produces. */
  const createPayload = {
    queryGroupVersion: { comment: null, canvasData: null },
    startNode: { outputs: [START_TUPLE] },
    endNode: { inputs: [], mediaType: 'application/sparql-results+json' },
    executionNodes: [
      {
        id: DYNAMIC_NODE_ID,
        nodeType: 'DynamicQueryNode',
        queryId: EXISTING_QUERY_VERSION_ID,
        backendId: BACKEND_ID,
        inputs: [QUERY_ID_PORT],
      },
    ],
    edges: [
      {
        id: QUERY_ID_EDGE,
        sourceNodeId: START_NODE_ID,
        targetNodeId: DYNAMIC_NODE_ID,
        dataFlowType: 'QUERY_ID',
        sourceOutputId: START_TUPLE,
        targetInputId: QUERY_ID_PORT,
      },
    ],
    inputTuples: [{ id: START_TUPLE, name: 'Start Params', memberEntries: [] }],
    // Authored by the group rather than inferred from the query version, and
    // sent without `isPartOf` — the create shape has no field for it.
    queryIdInputs: [{ id: QUERY_ID_PORT, name: 'Dynamic Query query id', description: null }],
  };

  it('answers a version create with a response the client would accept', () => {
    // The input is a payload the API would accept, so a failure below is the
    // mock's answer and not a payload this test invented.
    const sent = queryGroupVersionForGroupCreateSchema.safeParse(createPayload);
    expect(
      sent.success ? null : JSON.stringify(sent.error.issues.slice(0, 3)),
      'the create payload this test sends is not one the API would accept',
    ).toBeNull();

    const response = buildVersionCreateResponse(createPayload, {
      groupId: GROUP_ID,
      versionId: `${GROUP_ID}:v2`,
      versionNumber: 2,
      now: new Date().toISOString(),
    });

    const parsed = queryGroupVersionExpandedSchema.safeParse(response);
    expect(
      parsed.success ? null : JSON.stringify(parsed.error.issues.slice(0, 3)),
      'the version create response is not one the client would accept',
    ).toBeNull();
  });

  it('owns a query ID input by the node that declares it, as the writer does', () => {
    const response = buildVersionCreateResponse(createPayload, {
      groupId: GROUP_ID,
      versionId: `${GROUP_ID}:v2`,
      versionNumber: 2,
      now: new Date().toISOString(),
    }) as { queryIdInputs?: Array<{ id: string; isPartOf?: string | null }> };

    const port = (response.queryIdInputs ?? []).find(entry => entry.id === QUERY_ID_PORT);
    expect(port, 'the saved version dropped the query ID input').toBeTruthy();
    expect(port?.isPartOf, 'a query ID input belongs to the node that declares it').toBe(DYNAMIC_NODE_ID);
  });

  it('keeps the end node the version names, whatever the payload asked for', () => {
    // The mock has one start and one end node, so a response that named others
    // would leave every reloaded edge dangling.
    const response = buildVersionCreateResponse(createPayload, {
      groupId: GROUP_ID,
      versionId: `${GROUP_ID}:v2`,
      versionNumber: 2,
      now: new Date().toISOString(),
    });
    expect(response.queryGroupVersion.startNode).toBe(START_NODE_ID);
    expect(response.queryGroupVersion.endNode).toBe(END_NODE_ID);
  });

  /*
   * The same class of gap as the query ID input above, on the node type whose
   * whole point is that it is not the one it resembles.
   *
   * A `PatchNode` names an update and derives its effect without running it. A
   * mock that coerced it back to a `QueryNode` — as this one did — answered a
   * save with a node that *runs* that update, and dropped the two named halves
   * its edges leave by, so the reloaded canvas had a node whose edges pointed at
   * ports it no longer declared. The real writer refuses that carry-over
   * outright, which is what makes the coerced answer one no server can produce.
   */
  describe('a patch node saved through the mock', () => {
    const PATCH_NODE_ID = 'urn:sqlib:node:patch';
    const DELETIONS = 'urn:sqlib:triples-quads-io:deletions';
    const ADDITIONS = 'urn:sqlib:triples-quads-io:additions';

    const patchPayload = {
      queryGroupVersion: { comment: null, canvasData: null },
      startNode: { outputs: [] },
      endNode: { inputs: [DELETIONS], mediaType: null },
      executionNodes: [
        {
          id: PATCH_NODE_ID,
          nodeType: 'PatchNode',
          queryId: UPDATE_QUERY_VERSION_ID,
          backendId: BACKEND_ID,
          outputs: [DELETIONS, ADDITIONS],
          deletionsOutput: DELETIONS,
          additionsOutput: ADDITIONS,
        },
      ],
      edges: [
        {
          id: 'urn:sqlib:edge:patch-out',
          sourceNodeId: PATCH_NODE_ID,
          targetNodeId: 'urn:__END__',
          dataFlowType: 'RDF_GRAPH',
          sourceOutputId: DELETIONS,
          targetInputId: DELETIONS,
        },
      ],
      rdfOutputs: [
        { id: DELETIONS, name: 'deletions', description: null },
        { id: ADDITIONS, name: 'additions', description: null },
      ],
    };

    const respond = () =>
      buildVersionCreateResponse(patchPayload, {
        groupId: GROUP_ID,
        versionId: `${GROUP_ID}:v2`,
        versionNumber: 2,
        now: new Date().toISOString(),
      }) as unknown as {
        executionNodes: Array<{
          id: string;
          nodeType?: string;
          queryId?: string | null;
          deletionsOutput?: string | null;
          additionsOutput?: string | null;
        }>;
      };

    it('is a payload the API would accept, so what follows is about the answer', () => {
      const sent = queryGroupVersionForGroupCreateSchema.safeParse(patchPayload);
      expect(
        sent.success ? null : JSON.stringify(sent.error.issues.slice(0, 3)),
        'the patch create payload this test sends is not one the API would accept',
      ).toBeNull();
    });

    it('comes back as a patch node, halves and all', () => {
      const node = respond().executionNodes.find(entry => entry.id === PATCH_NODE_ID);
      expect(node, 'the saved version dropped the patch node').toBeTruthy();
      expect(node?.nodeType, 'a saved patch node came back as another node type').toBe('PatchNode');
      expect(node?.queryId).toBe(UPDATE_QUERY_VERSION_ID);
      expect(node?.deletionsOutput).toBe(DELETIONS);
      expect(node?.additionsOutput).toBe(ADDITIONS);
    });

    it('answers with a version the client would accept', () => {
      const parsed = queryGroupVersionExpandedSchema.safeParse(respond());
      expect(
        parsed.success ? null : JSON.stringify(parsed.error.issues.slice(0, 3)),
        'the patch version create response is not one the client would accept',
      ).toBeNull();
    });
  });

  /*
   * The third thing the mock has to get right, beside the entities it serves and
   * the create response it builds: the *shape* of a reply, which the request
   * decides rather than the fixture.
   *
   * `/execute` with `nodeDetail` set has exactly one legal answer —
   * `application/json` carrying `{ result, nodes, resultContentType }`, whatever
   * the result's own type (`packages/api/src/routes/execute.ts`). The query group
   * screen sets `nodeDetail` on every run, so a mock that answered with a bare
   * result body was answering a request no server answers that way, and the
   * client's whole per-node path was unreachable behind it.
   */
  describe('answers /execute the way the request asks it to', () => {
    const constructFixture = {
      contentType: 'application/n-triples',
      body: '<https://example.org/s> <https://example.org/p> "o" .',
      nodes: [{ nodeId: QUERY_NODE_ID, status: 'ok' as const, durationMs: 12, tripleCount: 1 }],
    };

    it('wraps a run that asked for node detail, result type and all', () => {
      const sent = wrapExecutionResponse(constructFixture, { nodeDetail: true });
      expect(sent.contentType).toBe('application/json');

      const envelope = JSON.parse(sent.body);
      expect(envelope.result).toBe(constructFixture.body);
      expect(envelope.nodes).toEqual(constructFixture.nodes);
      /*
       * The part a client cannot work out for itself: the reply's own type
       * describes the envelope, so without this a CONSTRUCT's N-Triples is an
       * unlabelled string and the viewer has to guess.
       */
      expect(envelope.resultContentType).toBe('application/n-triples');
    });

    it('leaves a run that did not ask for it alone', () => {
      const sent = wrapExecutionResponse(constructFixture, { nodeDetail: false });
      expect(sent.contentType).toBe('application/n-triples');
      expect(sent.body).toBe(constructFixture.body);
    });

    it('does not wrap a failure, which has its own shape', () => {
      // `failedNodeId` and `nodes` sit at the top level of the error body, which
      // is where `useQueryGroupExecution` reads them from.
      const sent = wrapExecutionResponse(
        {
          status: 500,
          contentType: 'application/json',
          body: { error: 'Node execution failed', failedNodeId: QUERY_NODE_ID, nodes: [] },
        },
        { nodeDetail: true },
      );
      expect(sent.status).toBe(500);
      expect(JSON.parse(sent.body)).toEqual({
        error: 'Node execution failed',
        failedNodeId: QUERY_NODE_ID,
        nodes: [],
      });
    });
  });
});
