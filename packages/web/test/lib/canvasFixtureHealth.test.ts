import { describe, it, expect } from 'vitest';
import { createGraphStateFromExpanded } from '../../src/composables/useQueryGroupGraph';
import { liveValidationIssues } from '../../src/composables/useQueryGroupLiveValidation';
import {
  BACKEND_ID,
  buildVersionCreateResponse,
  createMockState,
  END_NODE_ID,
  EXISTING_QUERY_VERSION_ID,
  GROUP_ID,
  NODE_INPUT_PORT,
  NODE_OUTPUT_PORT,
  QUERY_NODE_ID,
  START_NODE_ID,
  START_TUPLE_PORT,
} from '../../tests/e2e/fixtures/query-group-mock-state';
import { QUERY_GROUP_VERSION_EXPANDED } from '../../tests/e2e/fixtures/entities';

/**
 * The canvas fixtures describe a group the canvas itself calls healthy.
 *
 * `mockApiContract.test.ts` asks whether the mock's entities are *shapes* the
 * client would accept. This asks the question a shape cannot: whether the group
 * they add up to is one the app would draw without complaint. Both fixtures
 * failed it, and had since they were written —
 *
 * - the canvas mock's expansion described no `queryVersions`, so its one query
 *   node could not resolve the version it names and carried a blocking
 *   `NODE_QUERY_VERSION_UNREADABLE`;
 * - both fixtures put a source port on a control-flow edge, which orders
 *   execution and carries no data (`control-flow-has-endpoint`);
 * - the visual fixture's start node offered its bindings as a QueryOutputTuple,
 *   which a VARIABLE_BINDINGS edge out of a Start node cannot use as its source.
 *
 * None of that reds a functional spec, because a functional spec asserts on the
 * thing it came to see. It reds a picture: `visual-regression.spec.ts` has been
 * photographing an error ring and a validation badge as the reference for what a
 * healthy canvas looks like.
 *
 * So the assertion is the live validator itself rather than a list of rules
 * restated here. Anything it learns to object to, these fixtures answer for.
 */

/** Error-level issues only: a warning is the ordinary incompleteness of a draft. */
const blockingIssues = (expanded: unknown) =>
  liveValidationIssues(createGraphStateFromExpanded(expanded as never)).filter(
    (issue) => issue.level === 'error',
  );

const describeIssues = (expanded: unknown) =>
  blockingIssues(expanded)
    .map((issue) => `${issue.code} on ${issue.entityId ?? 'the graph'}: ${issue.message}`)
    .join('\n');

describe('the canvas fixtures draw a group the canvas calls healthy', () => {
  it('loads the seeded group with nothing blocking it', () => {
    const state = createMockState();
    const expanded = state.queryGroupExpanded[GROUP_ID][1];

    // A fixture that resolved to no nodes would satisfy the assertion below by
    // having nothing to object to.
    expect(createGraphStateFromExpanded(expanded as never).nodes.length).toBeGreaterThan(2);
    expect(describeIssues(expanded), 'the seeded canvas fixture opens with errors on it').toBe('');
  });

  it('reloads a saved version with nothing blocking it either', () => {
    /*
     * The other half of the mock, and the half a fixture assertion cannot see:
     * after a save the canvas re-reads the version it just wrote, so a create
     * response that drops what the load path carries turns the canvas red on
     * every save. The real route builds its answer with the same
     * `expandGroupVersionDetailed` the GET uses
     * (`packages/api/src/routes/query-groups.ts`), so the two cannot disagree
     * there.
     */
    const payload = {
      queryGroupVersion: { comment: null, canvasData: null },
      startNode: { outputs: [START_TUPLE_PORT] },
      endNode: { inputs: [NODE_OUTPUT_PORT], mediaType: 'application/sparql-results+json' },
      executionNodes: [
        {
          id: QUERY_NODE_ID,
          nodeType: 'QueryNode',
          queryId: EXISTING_QUERY_VERSION_ID,
          backendId: BACKEND_ID,
          inputs: [NODE_INPUT_PORT],
          outputs: [NODE_OUTPUT_PORT],
        },
      ],
      edges: [
        {
          id: 'urn:sqlib:edge:saved-control',
          sourceNodeId: START_NODE_ID,
          targetNodeId: QUERY_NODE_ID,
          dataFlowType: 'CONTROL_FLOW',
          sourceOutputId: null,
          targetInputId: null,
        },
        {
          id: 'urn:sqlib:edge:saved-rdf',
          sourceNodeId: QUERY_NODE_ID,
          targetNodeId: END_NODE_ID,
          dataFlowType: 'RDF_GRAPH',
          sourceOutputId: NODE_OUTPUT_PORT,
          targetInputId: NODE_OUTPUT_PORT,
        },
      ],
      inputTuples: [{ id: NODE_INPUT_PORT, name: 'City Params', memberEntries: [] }],
      rdfOutputs: [
        {
          id: NODE_OUTPUT_PORT,
          name: 'City RDF',
          description: null,
          ioType: 'output',
          outputType: 'RDF_GRAPH',
          triplesOrQuads: null,
          specifiedGraph: null,
        },
      ],
    };

    const response = buildVersionCreateResponse(payload, {
      groupId: GROUP_ID,
      versionId: `${GROUP_ID}:v2`,
      versionNumber: 2,
      now: new Date().toISOString(),
      queryVersions: createMockState().queryVersions,
    });

    expect(describeIssues(response), 'a saved version reloads with errors on it').toBe('');
  });

  it('draws the visual fixture with nothing blocking it', () => {
    // This one is a baseline: an error ring photographed as the reference is
    // worse than no reference, because it reads as the design.
    expect(
      describeIssues(QUERY_GROUP_VERSION_EXPANDED),
      'the visual regression fixture is photographed with errors on it',
    ).toBe('');
  });
});
