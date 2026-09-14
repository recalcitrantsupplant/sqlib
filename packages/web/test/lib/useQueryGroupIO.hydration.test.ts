import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { QueryGroupVersionExpandedWithIriMap, QueryVersionExpanded } from '@sparql-query-lib/contracts';
import { createGraphStateFromExpanded } from '../../src/composables/useQueryGroupGraph';
import { useQueryGroupGraphState } from '../../src/composables/useQueryGroupGraphState';
import { useQueryGroupIO } from '../../src/composables/useQueryGroupIO';

/**
 * Issue #47, item 1 ("composable unit tests" for `useQueryGroupIO`). The
 * fuzz test in `queryGroupPayloadContract.test.ts` already pins
 * `buildVersionCreatePayload` end to end; what it never exercises is the
 * *hydration* direction - loading a saved group back into the draft store
 * the editors read - which the Aug 2 status comment on #47 named directly
 * as "port hydration", still uncovered.
 */

const noopToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
const quietLogger = { debug: vi.fn(), error: vi.fn() };

const XSD = 'http://www.w3.org/2001/XMLSchema#';

const baseExpanded: QueryGroupVersionExpandedWithIriMap = {
  queryGroupVersion: {
    id: 'urn:sqlib:group-version:1',
    version: 1,
    startNode: 'urn:sqlib:startnode:1',
    endNode: 'urn:sqlib:endnode:1',
    executionNodes: ['urn:sqlib:node:0'],
    edges: ['urn:sqlib:edge:0', 'urn:sqlib:edge:1'],
    canvasData: null,
    comment: null,
    dateCreated: null,
    dateModified: null,
    isPartOf: 'urn:sqlib:group:1',
  },
  executionNodes: [
    {
      id: 'urn:sqlib:node:0',
      inputs: ['urn:sqlib:input-tuple:0'],
      outputs: ['urn:sqlib:output-tuple:0'],
      queryId: 'urn:sqlib:query-version:0',
      backendId: 'urn:sqlib:backend:1',
      backendConfig: null,
      nodeType: 'QueryNode',
      dateCreated: null,
      dateModified: null,
    },
  ],
  startNode: { id: 'urn:sqlib:startnode:1', outputs: ['urn:sqlib:input-tuple:0'], dateCreated: null, dateModified: null },
  endNode: {
    id: 'urn:sqlib:endnode:1',
    inputs: ['urn:sqlib:output-tuple:0'],
    mediaType: null,
    dateCreated: null,
    dateModified: null,
  },
  edges: [
    {
      id: 'urn:sqlib:edge:0',
      sourceNodeId: 'urn:sqlib:startnode:1',
      targetNodeId: 'urn:sqlib:node:0',
      dataFlowType: 'VARIABLE_BINDINGS',
      sourceOutputId: null,
      targetInputId: null,
      variableMappings: null,
      dateCreated: null,
      dateModified: null,
    },
    {
      id: 'urn:sqlib:edge:1',
      sourceNodeId: 'urn:sqlib:node:0',
      targetNodeId: 'urn:sqlib:endnode:1',
      dataFlowType: 'VARIABLE_BINDINGS',
      sourceOutputId: null,
      targetInputId: null,
      variableMappings: null,
      dateCreated: null,
      dateModified: null,
    },
  ],
  inputTuples: [
    {
      id: 'urn:sqlib:input-tuple:0',
      name: 'Params',
      memberEntries: ['urn:sqlib:tuple-member:0', 'urn:sqlib:tuple-member:1'],
      dateCreated: null,
      dateModified: null,
    },
  ],
  outputTuples: [
    { id: 'urn:sqlib:output-tuple:0', name: 'Rows', memberEntries: [], dateCreated: null, dateModified: null },
  ],
  tupleMembers: [
    { id: 'urn:sqlib:tuple-member:0', position: 0, variable: 'urn:sqlib:input:0' },
    { id: 'urn:sqlib:tuple-member:1', position: 1, variable: 'urn:sqlib:input:1' },
  ],
  inputs: [
    { id: 'urn:sqlib:input:0', variableName: 'name', allowedTypes: [`${XSD}anyURI`] },
    { id: 'urn:sqlib:input:1', variableName: 'limit', allowedTypes: [`${XSD}integer`] },
  ],
  outputs: [
    { id: 'urn:sqlib:output:0', variableName: 'result', description: 'The result binding' },
  ],
  rdfOutputs: [
    { id: 'urn:sqlib:rdf:0', name: 'Graph', description: null, dateCreated: null, dateModified: null },
  ],
  booleanOutputs: [
    { id: 'urn:sqlib:bool:0', name: 'Flag', description: null, dateCreated: null, dateModified: null },
  ],
  queryIdInputs: [
    { id: 'urn:sqlib:queryid:0', name: 'Which query', description: null, isPartOf: 'urn:sqlib:library:1' },
  ],
  iriMap: {},
} as unknown as QueryGroupVersionExpandedWithIriMap;

function makeIo(expanded: QueryGroupVersionExpandedWithIriMap = baseExpanded) {
  const graph = useQueryGroupGraphState({ initialGraphState: createGraphStateFromExpanded(expanded) });
  const io = useQueryGroupIO({ graph, toast: noopToast, logger: quietLogger });
  return { graph, io };
}

describe('useQueryGroupIO hydration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('populateFromExpanded loads every draft kind into the ioDraftStore', () => {
    const { io } = makeIo();
    io.populateFromExpanded(baseExpanded);

    expect(io.ioDraftStore.inputs.value.get('urn:sqlib:input:0')).toEqual(
      expect.objectContaining({ id: 'urn:sqlib:input:0', variableName: 'name' }),
    );
    expect(io.ioDraftStore.outputs.value.get('urn:sqlib:output:0')).toEqual(
      expect.objectContaining({ id: 'urn:sqlib:output:0', variableName: 'result' }),
    );
    expect(io.ioDraftStore.inputTuples.value.get('urn:sqlib:input-tuple:0')).toEqual(
      expect.objectContaining({ id: 'urn:sqlib:input-tuple:0', name: 'Params' }),
    );
    expect(io.ioDraftStore.outputTuples.value.get('urn:sqlib:output-tuple:0')).toEqual(
      expect.objectContaining({ id: 'urn:sqlib:output-tuple:0', name: 'Rows' }),
    );
    expect(io.ioDraftStore.tupleMembers.value.get('urn:sqlib:tuple-member:0')).toEqual(
      expect.objectContaining({ id: 'urn:sqlib:tuple-member:0', variable: 'urn:sqlib:input:0' }),
    );
    expect(io.ioDraftStore.rdfOutputs.value.get('urn:sqlib:rdf:0')).toEqual(
      expect.objectContaining({ id: 'urn:sqlib:rdf:0', name: 'Graph' }),
    );
    expect(io.ioDraftStore.booleanOutputs.value.get('urn:sqlib:bool:0')).toEqual(
      expect.objectContaining({ id: 'urn:sqlib:bool:0', name: 'Flag' }),
    );
    expect(io.ioDraftStore.queryIdInputs.value.get('urn:sqlib:queryid:0')).toEqual(
      expect.objectContaining({ id: 'urn:sqlib:queryid:0', name: 'Which query' }),
    );
  });

  it('rebuilds the tuple-editor state from the start node, resolving each variable\'s UI type', () => {
    const { io } = makeIo();
    io.populateFromExpanded(baseExpanded);

    expect(io.inputTuples.value).toHaveLength(1);
    const [tuple] = io.inputTuples.value;
    expect(tuple.id).toBe('urn:sqlib:input-tuple:0');
    expect(tuple.label).toBe('Params');
    expect(tuple.variables).toHaveLength(2);

    // allowedTypes: xsd:anyURI -> the IRI branch of mapAllowedTypesToUi.
    expect(tuple.variables[0]).toEqual(
      expect.objectContaining({ name: '?name', nodeKind: 'iri', datatype: 'xsd:string' }),
    );
    // allowedTypes: xsd:integer -> the literal branch, with the short datatype form.
    expect(tuple.variables[1]).toEqual(
      expect.objectContaining({ name: '?limit', nodeKind: 'literal', datatype: 'xsd:integer' }),
    );
  });

  it('replaces rather than accumulates on a second load', () => {
    const { io } = makeIo();
    io.populateFromExpanded(baseExpanded);

    const reloaded = {
      ...baseExpanded,
      inputs: [{ id: 'urn:sqlib:input:9', variableName: 'onlyOne' }],
    } as unknown as QueryGroupVersionExpandedWithIriMap;
    io.populateFromExpanded(reloaded);

    expect(io.ioDraftStore.inputs.value.size).toBe(1);
    expect(io.ioDraftStore.inputs.value.has('urn:sqlib:input:0')).toBe(false);
    expect(io.ioDraftStore.inputs.value.get('urn:sqlib:input:9')).toEqual(
      expect.objectContaining({ variableName: 'onlyOne' }),
    );
  });

  it('ingestQueryVersionDrafts adds a query version\'s ports without touching unrelated ones', () => {
    const { io } = makeIo();
    io.populateFromExpanded(baseExpanded);

    const queryVersion: QueryVersionExpanded = {
      inputs: [{ id: 'urn:sqlib:qv-input:0', variableName: 'fromQuery' }],
      outputs: [{ id: 'urn:sqlib:qv-output:0', variableName: 'qvResult' }],
      inputTuples: [{ id: 'urn:sqlib:qv-input-tuple:0', name: 'QV Params', memberEntries: [] }],
      outputTuples: [],
      tupleMembers: [],
    } as unknown as QueryVersionExpanded;

    io.ingestQueryVersionDrafts(queryVersion);

    // Additive: the group-level draft from populateFromExpanded survives.
    expect(io.ioDraftStore.inputs.value.get('urn:sqlib:input:0')).toBeDefined();
    // And the query version's own ports are now present too.
    expect(io.ioDraftStore.inputs.value.get('urn:sqlib:qv-input:0')).toEqual(
      expect.objectContaining({ variableName: 'fromQuery' }),
    );
    expect(io.ioDraftStore.outputs.value.get('urn:sqlib:qv-output:0')).toEqual(
      expect.objectContaining({ variableName: 'qvResult' }),
    );
    expect(io.ioDraftStore.inputTuples.value.get('urn:sqlib:qv-input-tuple:0')).toEqual(
      expect.objectContaining({ name: 'QV Params' }),
    );
  });

  it('resetDrafts clears every draft map and the tuple-editor state', () => {
    const { io } = makeIo();
    io.populateFromExpanded(baseExpanded);
    expect(io.ioDraftStore.inputs.value.size).toBeGreaterThan(0);
    expect(io.inputTuples.value.length).toBeGreaterThan(0);

    io.resetDrafts();

    for (const map of Object.values(io.ioDraftStore)) {
      expect(map.value.size).toBe(0);
    }
    expect(io.inputTuples.value).toEqual([]);
  });

  it('resetStartTuples clears only the tuple-editor state, not the loaded drafts', () => {
    const { io } = makeIo();
    io.populateFromExpanded(baseExpanded);

    io.resetStartTuples();

    expect(io.inputTuples.value).toEqual([]);
    // populateFromExpanded's draft maps are untouched by this narrower reset.
    expect(io.ioDraftStore.inputs.value.size).toBeGreaterThan(0);
    expect(io.ioDraftStore.inputTuples.value.size).toBeGreaterThan(0);
  });

  it('registerRdfIoEntity / unregisterIoEntity round-trip an RDF output draft', () => {
    const { io } = makeIo();

    io.registerRdfIoEntity({ id: 'urn:sqlib:rdf:9', name: 'New graph' });
    expect(io.ioDraftStore.rdfOutputs.value.get('urn:sqlib:rdf:9')).toEqual(
      expect.objectContaining({ name: 'New graph' }),
    );

    io.unregisterIoEntity('urn:sqlib:rdf:9');
    expect(io.ioDraftStore.rdfOutputs.value.has('urn:sqlib:rdf:9')).toBe(false);
  });

  it('registerQueryIdInput / unregisterQueryIdInput round-trip a query-id input draft', () => {
    const { io } = makeIo();

    io.registerQueryIdInput({ id: 'urn:sqlib:queryid:9', name: 'Second slot' });
    expect(io.ioDraftStore.queryIdInputs.value.get('urn:sqlib:queryid:9')).toEqual(
      expect.objectContaining({ name: 'Second slot' }),
    );

    io.unregisterQueryIdInput('urn:sqlib:queryid:9');
    expect(io.ioDraftStore.queryIdInputs.value.has('urn:sqlib:queryid:9')).toBe(false);
  });
});

describe('useQueryGroupIO tupleEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('addTuple adds a UI row and a matching start-node port + ioEntity', () => {
    const { io, graph } = makeIo();
    io.populateFromExpanded(baseExpanded);
    const before = io.inputTuples.value.length;

    io.tupleEditor.addTuple();

    expect(io.inputTuples.value).toHaveLength(before + 1);
    const added = io.inputTuples.value[before];
    const startNode = graph.currentGraphState.value.nodes.find((node) => node.kind === 'start')!;
    expect(startNode.outputs.some((port) => port.id === added.id)).toBe(true);
    expect(graph.currentGraphState.value.ioEntities[added.id]).toEqual(
      expect.objectContaining({ kind: 'QueryInputTuple', arity: 0, memberEntries: [] }),
    );
  });

  it('removeTuple drops the UI row, the start-node port and the ioEntity', () => {
    const { io, graph } = makeIo();
    io.populateFromExpanded(baseExpanded);
    io.tupleEditor.addTuple();
    const index = io.inputTuples.value.length - 1;
    const removedId = io.inputTuples.value[index].id!;

    io.tupleEditor.removeTuple(index);

    expect(io.inputTuples.value.some((tuple) => tuple.id === removedId)).toBe(false);
    const startNode = graph.currentGraphState.value.nodes.find((node) => node.kind === 'start')!;
    expect(startNode.outputs.some((port) => port.id === removedId)).toBe(false);
    expect(graph.currentGraphState.value.ioEntities[removedId]).toBeUndefined();
  });

  it('addVariable / removeVariable keep ioEntity arity and memberEntries in sync', () => {
    const { io, graph } = makeIo();
    io.populateFromExpanded(baseExpanded);
    io.tupleEditor.addTuple();
    const tupleIndex = io.inputTuples.value.length - 1;
    const tupleId = io.inputTuples.value[tupleIndex].id!;

    io.tupleEditor.addVariable(tupleIndex);
    expect(io.inputTuples.value[tupleIndex].variables).toHaveLength(1);
    expect(graph.currentGraphState.value.ioEntities[tupleId]?.arity).toBe(1);

    io.tupleEditor.addVariable(tupleIndex);
    expect(graph.currentGraphState.value.ioEntities[tupleId]?.arity).toBe(2);

    io.tupleEditor.removeVariable(tupleIndex, 0);
    expect(io.inputTuples.value[tupleIndex].variables).toHaveLength(1);
    expect(graph.currentGraphState.value.ioEntities[tupleId]?.arity).toBe(1);
  });

  it('updateVariable resets datatype fields when switching node kind', () => {
    const { io } = makeIo();
    io.populateFromExpanded(baseExpanded);
    io.tupleEditor.addTuple();
    const tupleIndex = io.inputTuples.value.length - 1;
    io.tupleEditor.addVariable(tupleIndex);

    io.tupleEditor.updateVariable({ tupleIndex, variableIndex: 0, field: 'nodeKind', value: 'literal' });
    io.tupleEditor.updateVariable({ tupleIndex, variableIndex: 0, field: 'datatype', value: 'custom' });
    io.tupleEditor.updateVariable({ tupleIndex, variableIndex: 0, field: 'customDatatype', value: 'urn:example:type' });

    const variable = io.inputTuples.value[tupleIndex].variables[0];
    expect(variable.nodeKind).toBe('literal');
    expect(variable.datatype).toBe('custom');
    expect(variable.customDatatype).toBe('urn:example:type');

    // Switching back to iri clears the literal-only fields (matches SPARQL's
    // own rule: an IRI slot has no datatype to remember).
    io.tupleEditor.updateVariable({ tupleIndex, variableIndex: 0, field: 'nodeKind', value: 'iri' });
    expect(io.inputTuples.value[tupleIndex].variables[0].datatype).toBe('xsd:string');
    expect(io.inputTuples.value[tupleIndex].variables[0].customDatatype).toBeUndefined();
  });

  it('saveStartInputs refuses a tuple with no variables and never touches the graph', () => {
    const { io, graph } = makeIo();
    io.populateFromExpanded(baseExpanded);
    io.tupleEditor.addTuple();
    const before = JSON.stringify(graph.currentGraphState.value.ioEntities);

    io.tupleEditor.saveStartInputs();

    expect(noopToast.error).toHaveBeenCalledWith(expect.stringContaining('no variables'));
    expect(noopToast.success).not.toHaveBeenCalled();
    expect(JSON.stringify(graph.currentGraphState.value.ioEntities)).toBe(before);
  });

  it('saveStartInputs refuses a variable with no name', () => {
    const { io } = makeIo();
    io.populateFromExpanded(baseExpanded);
    io.tupleEditor.addTuple();
    const tupleIndex = io.inputTuples.value.length - 1;
    io.tupleEditor.addVariable(tupleIndex);

    io.tupleEditor.saveStartInputs();

    expect(noopToast.error).toHaveBeenCalledWith(expect.stringContaining('Name is required'));
    expect(noopToast.success).not.toHaveBeenCalled();
  });

  it('saveStartInputs refuses a custom datatype left blank', () => {
    const { io } = makeIo();
    io.populateFromExpanded(baseExpanded);
    io.tupleEditor.addTuple();
    const tupleIndex = io.inputTuples.value.length - 1;
    io.tupleEditor.addVariable(tupleIndex);
    io.tupleEditor.updateVariable({ tupleIndex, variableIndex: 0, field: 'name', value: 'myVar' });
    io.tupleEditor.updateVariable({ tupleIndex, variableIndex: 0, field: 'nodeKind', value: 'literal' });
    io.tupleEditor.updateVariable({ tupleIndex, variableIndex: 0, field: 'datatype', value: 'custom' });

    io.tupleEditor.saveStartInputs();

    expect(noopToast.error).toHaveBeenCalledWith(expect.stringContaining('Custom datatype IRI is required'));
  });

  it('saveStartInputs normalizes and confirms once every tuple is well formed', () => {
    const { io } = makeIo();
    io.populateFromExpanded(baseExpanded);
    io.tupleEditor.addTuple();
    const tupleIndex = io.inputTuples.value.length - 1;
    io.tupleEditor.addVariable(tupleIndex);
    io.tupleEditor.updateVariable({ tupleIndex, variableIndex: 0, field: 'name', value: 'myVar' });

    io.tupleEditor.saveStartInputs();

    expect(noopToast.error).not.toHaveBeenCalled();
    expect(noopToast.success).toHaveBeenCalledWith(expect.stringContaining('saved'));
  });
});
