import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { QueryGroupVersionExpandedWithIriMap } from '@sparql-query-lib/contracts';
import { createGraphStateFromExpanded } from '../../src/composables/useQueryGroupGraph';
import { useQueryGroupGraphState } from '../../src/composables/useQueryGroupGraphState';
import { useQueryGroupIO } from '../../src/composables/useQueryGroupIO';

/**
 * Issue #47, item 1 ("composable unit tests" for `useQueryGroupIO`). The Aug 2
 * status comment names `normalizeStartTuples` as still uncovered, and it is the
 * one function on this composable that writes the group's *declared interface*:
 * every save of a boundary tuple goes through it, and everything it touches -
 * start-node ports, ioEntities, the normalized member/variable model, the draft
 * maps a publish is built from - is state some other screen then reads back.
 *
 * `useQueryGroupIO.hydration.test.ts` covers the load direction and reaches
 * this function only through `saveStartInputs`'s happy path, which asserts a
 * toast. These are the transformations themselves.
 */

const noopToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
const quietLogger = { debug: vi.fn(), error: vi.fn() };

const START_NODE = 'urn:sqlib:startnode:1';
const DATA_GRAPH_PORT = 'urn:sqlib:rdf:data-graph';

/**
 * A group whose start node declares one boundary tuple *and* one data graph
 * input, since preserving the second while rewriting the first is a documented
 * property of `normalizeStartTuples`.
 */
const baseExpanded = {
  queryGroupVersion: {
    id: 'urn:sqlib:group-version:1',
    version: 1,
    startNode: START_NODE,
    endNode: 'urn:sqlib:endnode:1',
    executionNodes: ['urn:sqlib:node:0'],
    edges: [],
    canvasData: null,
    comment: null,
    dateCreated: null,
    dateModified: null,
    isPartOf: 'urn:sqlib:group:1',
  },
  executionNodes: [
    {
      id: 'urn:sqlib:node:0',
      inputs: [],
      outputs: [],
      queryId: 'urn:sqlib:query-version:0',
      backendId: 'urn:sqlib:backend:1',
      backendConfig: null,
      nodeType: 'QueryNode',
      dateCreated: null,
      dateModified: null,
    },
  ],
  startNode: {
    id: START_NODE,
    outputs: ['urn:sqlib:input-tuple:0', DATA_GRAPH_PORT],
    dateCreated: null,
    dateModified: null,
  },
  endNode: {
    id: 'urn:sqlib:endnode:1',
    inputs: [],
    mediaType: null,
    dateCreated: null,
    dateModified: null,
  },
  edges: [],
  inputTuples: [
    {
      id: 'urn:sqlib:input-tuple:0',
      name: 'Params',
      memberEntries: ['urn:sqlib:tuple-member:0'],
      dateCreated: null,
      dateModified: null,
    },
  ],
  outputTuples: [],
  tupleMembers: [{ id: 'urn:sqlib:tuple-member:0', position: 0, variable: 'urn:sqlib:input:0' }],
  inputs: [{ id: 'urn:sqlib:input:0', variableName: 'name' }],
  outputs: [],
  rdfOutputs: [
    { id: DATA_GRAPH_PORT, name: 'Ontology', description: null, dateCreated: null, dateModified: null },
  ],
  booleanOutputs: [],
  queryIdInputs: [],
  iriMap: {},
} as unknown as QueryGroupVersionExpandedWithIriMap;

function makeIo(expanded: QueryGroupVersionExpandedWithIriMap = baseExpanded) {
  const graph = useQueryGroupGraphState({ initialGraphState: createGraphStateFromExpanded(expanded) });
  const io = useQueryGroupIO({ graph, toast: noopToast, logger: quietLogger });
  io.populateFromExpanded(expanded);
  return { graph, io };
}

const startNodeOf = (graph: ReturnType<typeof useQueryGroupGraphState>) =>
  graph.currentGraphState.value.nodes.find((node) => node.kind === 'start')!;

describe('useQueryGroupIO normalizeStartTuples', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refuses to run without a start node', () => {
    const { graph, io } = makeIo();
    graph.currentGraphState.value = {
      ...graph.currentGraphState.value,
      nodes: graph.currentGraphState.value.nodes.filter((node) => node.kind !== 'start'),
    };

    expect(() => io.normalizeStartTuples()).toThrow(/Start node is missing/);
  });

  it('keeps ids that are already urns and mints one from the label otherwise', () => {
    const { io } = makeIo();
    io.inputTuples.value = [
      { id: 'urn:sqlib:input-tuple:0', label: 'Params', variables: [{ name: '?name', nodeKind: 'iri' }] },
      { label: 'Fresh tuple', variables: [{ name: 'city', nodeKind: 'iri' }] },
    ];

    const payload = io.normalizeStartTuples();

    expect(payload.inputTuples[0].id).toBe('urn:sqlib:input-tuple:0');
    // Not a urn, so it is minted from the label with the unsafe characters
    // folded to '-' - the id has to survive being an IRI segment.
    expect(payload.inputTuples[1].id).toBe('urn:ui-temp:input-tuple-Fresh-tuple');
  });

  it('names an unlabelled tuple and an unnamed variable by position', () => {
    const { io } = makeIo();
    io.inputTuples.value = [{ variables: [{ name: '', nodeKind: 'iri' }] }];

    const payload = io.normalizeStartTuples();

    expect(payload.inputTuples[0].name).toBeNull();
    expect(payload.inputTuples[0].id).toBe('urn:ui-temp:input-tuple-1');
    expect(payload.inputs[0].variableName).toBe('var1_1');
    // The editor shows SPARQL's own spelling; the payload stores the bare name.
    expect(io.inputTuples.value[0].variables[0].name).toBe('?var1_1');
  });

  it('stores variable names unprefixed and displays them with a leading ?', () => {
    const { io } = makeIo();
    io.inputTuples.value = [
      { label: 'Params', variables: [{ name: '?name', nodeKind: 'iri' }, { name: '$limit', nodeKind: 'literal' }] },
    ];

    const payload = io.normalizeStartTuples();

    expect(payload.inputs.map((input) => input.variableName)).toEqual(['name', 'limit']);
    expect(io.inputTuples.value[0].variables.map((variable) => variable.name)).toEqual(['?name', '?limit']);
  });

  it('emits one member per variable, positioned in tuple order', () => {
    const { io } = makeIo();
    io.inputTuples.value = [
      { label: 'Params', variables: [{ name: 'a', nodeKind: 'iri' }, { name: 'b', nodeKind: 'iri' }] },
    ];

    const payload = io.normalizeStartTuples();

    expect(payload.tupleMembers).toEqual([
      expect.objectContaining({ position: 0, variable: 'urn:ui-temp:input-a' }),
      expect.objectContaining({ position: 1, variable: 'urn:ui-temp:input-b' }),
    ]);
    expect(payload.inputTuples[0].memberEntries).toEqual(payload.tupleMembers.map((member) => member.id));
  });

  it('declares one variable once when two tuples share it', () => {
    const { io } = makeIo();
    io.inputTuples.value = [
      { label: 'First', variables: [{ name: 'shared', nodeKind: 'iri' }] },
      { label: 'Second', variables: [{ name: 'shared', nodeKind: 'iri' }] },
    ];

    const payload = io.normalizeStartTuples();

    // Two tuples, two members, but a single variable: the member is the
    // per-tuple slot, the variable is what fills it.
    expect(payload.inputTuples).toHaveLength(2);
    expect(payload.tupleMembers).toHaveLength(2);
    expect(payload.inputs).toEqual([expect.objectContaining({ variableName: 'shared' })]);
    expect(new Set(payload.tupleMembers.map((member) => member.variable)).size).toBe(1);
  });

  it('rewrites the start node tuple ports and leaves a data graph input alone', () => {
    const { graph, io } = makeIo();
    io.inputTuples.value = [{ label: 'Params', variables: [{ name: 'name', nodeKind: 'iri' }] }];

    io.normalizeStartTuples();

    const outputs = startNodeOf(graph).outputs;
    // The saved tuple replaces the loaded one; the RDF port is carried through,
    // because this function owns the tuple half of the start node only.
    expect(outputs.map((port) => port.id)).toEqual(['urn:ui-temp:input-tuple-Params', DATA_GRAPH_PORT]);
    expect(outputs.find((port) => port.id === DATA_GRAPH_PORT)?.entityType).toBe('TriplesQuadsIO');
    expect(graph.currentGraphState.value.ioEntities[DATA_GRAPH_PORT]).toBeDefined();
  });

  it('writes an ioEntity per tuple, with its label, members and arity', () => {
    const { graph, io } = makeIo();
    io.inputTuples.value = [
      { label: 'Params', variables: [{ name: 'name', nodeKind: 'iri' }, { name: 'limit', nodeKind: 'iri' }] },
    ];

    const payload = io.normalizeStartTuples();
    const entity = graph.currentGraphState.value.ioEntities['urn:ui-temp:input-tuple-Params'];

    expect(entity).toEqual(
      expect.objectContaining({
        kind: 'QueryInputTuple',
        name: 'Params',
        arity: 2,
        origin: 'query-group',
        memberEntries: payload.inputTuples[0].memberEntries,
      }),
    );
  });

  it('drops the ioEntity of a boundary tuple the author removed', () => {
    const { graph, io } = makeIo();
    expect(graph.currentGraphState.value.ioEntities['urn:sqlib:input-tuple:0']).toBeDefined();

    io.inputTuples.value = [];
    io.normalizeStartTuples();

    expect(graph.currentGraphState.value.ioEntities['urn:sqlib:input-tuple:0']).toBeUndefined();
    expect(startNodeOf(graph).outputs.map((port) => port.id)).toEqual([DATA_GRAPH_PORT]);
  });

  it('keeps a removed tuple\'s ioEntity while another node still declares that port', () => {
    const { graph, io } = makeIo();
    graph.updateGraphNodeState('urn:sqlib:node:0', (node) => ({
      ...node,
      inputs: [
        {
          id: 'urn:sqlib:input-tuple:0',
          label: 'Params',
          entityType: 'QueryInputTuple' as const,
          direction: 'input' as const,
          origin: 'query-group' as const,
          resolved: true,
        },
      ],
    }));

    io.inputTuples.value = [];
    io.normalizeStartTuples();

    // Deleting it here would blank the port on the node that still references
    // it, which is a worse outcome than an entity nothing on the boundary uses.
    expect(graph.currentGraphState.value.ioEntities['urn:sqlib:input-tuple:0']).toBeDefined();
  });

  it('publishes members and variables into the normalized graph model', () => {
    const { graph, io } = makeIo();
    io.inputTuples.value = [{ label: 'Params', variables: [{ name: 'name', nodeKind: 'iri' }] }];

    const payload = io.normalizeStartTuples();
    const [member] = payload.tupleMembers;

    expect(graph.currentGraphState.value.tupleMembers[member.id]).toEqual({
      id: member.id,
      position: 0,
      variable: 'urn:ui-temp:input-name',
    });
    expect(graph.currentGraphState.value.variables['urn:ui-temp:input-name']).toEqual({
      id: 'urn:ui-temp:input-name',
      variableName: 'name',
      direction: 'input',
      allowedTypes: null,
    });
  });

  it('replaces the previous start drafts rather than accumulating them', () => {
    const { io } = makeIo();
    io.inputTuples.value = [{ label: 'First', variables: [{ name: 'a', nodeKind: 'iri' }] }];
    io.normalizeStartTuples();

    io.inputTuples.value = [{ label: 'Second', variables: [{ name: 'b', nodeKind: 'iri' }] }];
    io.normalizeStartTuples();

    expect([...io.ioDraftStore.inputTuples.value.keys()]).toEqual(['urn:ui-temp:input-tuple-Second']);
    expect([...io.ioDraftStore.inputs.value.keys()]).toEqual(['urn:ui-temp:input-b']);
    expect(io.ioDraftStore.tupleMembers.value.size).toBe(1);
  });

  it('is idempotent: normalizing twice changes nothing the second time', () => {
    const { graph, io } = makeIo();
    io.inputTuples.value = [{ label: 'Params', variables: [{ name: 'name', nodeKind: 'iri' }] }];

    const first = io.normalizeStartTuples();
    const ports = startNodeOf(graph).outputs.map((port) => port.id);
    const second = io.normalizeStartTuples();

    expect(second).toEqual(first);
    expect(startNodeOf(graph).outputs.map((port) => port.id)).toEqual(ports);
  });
});

/**
 * Temp ids were derived from the row's index, so a row added after an earlier
 * one was removed could be handed an id a surviving row already held. Two ports
 * with one id is not a cosmetic problem: the start node's `outputs` carries the
 * duplicate, and the single `ioEntities` entry both rows then share is
 * whichever one wrote last.
 */
describe('useQueryGroupIO tupleEditor: temp ids stay unique', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('gives a tuple added after a removal an id no surviving tuple holds', () => {
    const { graph, io } = makeIo();
    io.inputTuples.value = [];

    io.tupleEditor.addTuple();
    io.tupleEditor.addTuple();
    io.tupleEditor.removeTuple(0);
    io.tupleEditor.addTuple();

    const ids = io.inputTuples.value.map((tuple) => tuple.id);
    expect(new Set(ids).size).toBe(ids.length);

    const portIds = startNodeOf(graph).outputs.map((port) => port.id);
    expect(new Set(portIds).size).toBe(portIds.length);
    for (const id of ids) {
      expect(portIds).toContain(id);
    }
  });

  it('gives a variable added after a removal a member id no surviving variable holds', () => {
    const { graph, io } = makeIo();
    io.inputTuples.value = [];
    io.tupleEditor.addTuple();
    const tupleIndex = io.inputTuples.value.length - 1;
    const tupleId = io.inputTuples.value[tupleIndex].id!;

    io.tupleEditor.addVariable(tupleIndex);
    io.tupleEditor.addVariable(tupleIndex);
    io.tupleEditor.removeVariable(tupleIndex, 0);
    io.tupleEditor.addVariable(tupleIndex);

    const memberIds = io.inputTuples.value[tupleIndex].variables.map((variable) => variable.memberId);
    expect(new Set(memberIds).size).toBe(memberIds.length);

    const entries = graph.currentGraphState.value.ioEntities[tupleId]?.memberEntries ?? [];
    expect(new Set(entries).size).toBe(entries.length);
    expect(entries).toEqual(memberIds);
  });

  it('keeps member ids distinct across tuples once names repeat', () => {
    const { io } = makeIo();
    io.inputTuples.value = [];
    io.tupleEditor.addTuple();
    io.tupleEditor.addTuple();
    io.tupleEditor.addVariable(0);
    io.tupleEditor.addVariable(1);

    const memberIds = io.inputTuples.value.flatMap((tuple) => tuple.variables.map((variable) => variable.memberId));
    expect(new Set(memberIds).size).toBe(memberIds.length);
  });
});
