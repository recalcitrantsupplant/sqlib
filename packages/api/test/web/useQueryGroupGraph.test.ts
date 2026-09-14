import { describe, expect, it } from 'vitest';
import type { QueryGroupVersionExpandedWithIriMap } from '@sparql-query-lib/contracts';
import {
  createGraphStateFromExpanded,
  graphStateToFlatPayload,
} from '../../../web/src/composables/useQueryGroupGraph.js';
import type {
  GraphNodeState,
  GraphPort,
} from '../../../web/src/composables/useQueryGroupGraph.js';

const expandedSample: QueryGroupVersionExpandedWithIriMap = {
  queryGroupVersion: {
    id: 'urn:sqlib:group-version:demo',
    version: 1,
    startNode: 'urn:sqlib:startnode:start-1',
    endNode: 'urn:sqlib:endnode:end-1',
    executionNodes: ['urn:sqlib:node:q1'],
    edges: [
      'urn:sqlib:edge:control',
      'urn:sqlib:edge:param',
      'urn:sqlib:edge:rdf',
    ],
    canvasData: null,
    comment: null,
    dateCreated: null,
    dateModified: null,
    isPartOf: 'urn:sqlib:group:demo',
  },
  executionNodes: [
    {
      id: 'urn:sqlib:node:q1',
      inputs: ['urn:sqlib:input-tuple:params'],
      outputs: [
        'urn:sqlib:output-tuple:rows',
        'urn:sqlib:triples-quads:rdf',
      ],
      queryId: 'urn:sqlib:queryversion:select-1',
      backendId: 'urn:sqlib:backend:wikidata',
      backendConfig: null,
      nodeType: 'QueryNode',
      dateCreated: null,
      dateModified: null,
    },
  ],
  startNode: {
    id: 'urn:sqlib:startnode:start-1',
    outputs: [
      'urn:sqlib:control-output:demo',
      'urn:sqlib:output-tuple:external',
    ],
    dateCreated: null,
    dateModified: null,
  },
  endNode: {
    id: 'urn:sqlib:endnode:end-1',
    inputs: ['urn:sqlib:triples-quads:rdf'],
    mediaType: 'application/n-triples',
    dateCreated: null,
    dateModified: null,
  },
  edges: [
    {
      id: 'urn:sqlib:edge:control',
      sourceNodeId: 'urn:sqlib:startnode:start-1',
      targetNodeId: 'urn:sqlib:node:q1',
      dataFlowType: 'CONTROL_FLOW',
      sourceOutputId: null,
      targetInputId: null,
    },
    {
      id: 'urn:sqlib:edge:param',
      sourceNodeId: 'urn:sqlib:startnode:start-1',
      targetNodeId: 'urn:sqlib:node:q1',
      dataFlowType: 'VARIABLE_BINDINGS',
      sourceOutputId: 'urn:sqlib:output-tuple:external',
      targetInputId: 'urn:sqlib:input-tuple:params',
    },
    {
      id: 'urn:sqlib:edge:rdf',
      sourceNodeId: 'urn:sqlib:node:q1',
      targetNodeId: 'urn:sqlib:endnode:end-1',
      dataFlowType: 'RDF_GRAPH',
      sourceOutputId: 'urn:sqlib:triples-quads:rdf',
      targetInputId: 'urn:sqlib:triples-quads:rdf',
    },
  ],
  tupleMembers: [],
  inputTuples: [
    {
      id: 'urn:sqlib:input-tuple:params',
      name: 'Region Parameters',
      memberEntries: [],
    },
  ],
  outputTuples: [
    {
      id: 'urn:sqlib:output-tuple:external',
      name: 'External Params',
      memberEntries: [],
    },
    {
      id: 'urn:sqlib:output-tuple:rows',
      name: 'Country Rows',
      memberEntries: [],
    },
  ],
  inputs: [],
  outputs: [],
  rdfOutputs: [
    {
      id: 'urn:sqlib:triples-quads:rdf',
      name: 'Population RDF',
      description: null,
      ioType: 'output',
      outputType: 'RDF_GRAPH',
      triplesOrQuads: null,
      specifiedGraph: null,
      dateCreated: null,
      dateModified: null,
    },
  ],
  booleanOutputs: [],
  queryIdInputs: [],
  iriMap: {
    'urn:__START__': 'urn:sqlib:startnode:start-1',
    'urn:__END__': 'urn:sqlib:endnode:end-1',
  },
};

describe('useQueryGroupGraph', () => {
  it('converts expanded payload into graph state', () => {
    const state = createGraphStateFromExpanded(expandedSample);

    expect(state.nodes).toHaveLength(3);

    const start = state.nodes.find((node: GraphNodeState) => node.kind === 'start');
    expect(start).toBeDefined();
    expect(start?.outputs).toEqual([
      expect.objectContaining({
        id: 'urn:sqlib:control-output:demo',
        entityType: 'ControlFlowIO',
      }),
      expect.objectContaining({
        id: 'urn:sqlib:output-tuple:external',
        entityType: 'QueryOutputTuple',
      }),
    ]);

    const execution = state.nodes.find((node: GraphNodeState) => node.kind === 'query');
    expect(execution).toBeDefined();
    expect(execution?.inputs[0]).toEqual(
      expect.objectContaining({
        id: 'urn:sqlib:input-tuple:params',
        entityType: 'QueryInputTuple',
      }),
    );
    expect(execution?.outputs.map((port: GraphPort) => port.id)).toEqual([
      'urn:sqlib:output-tuple:rows',
      'urn:sqlib:triples-quads:rdf',
    ]);

    const end = state.nodes.find((node: GraphNodeState) => node.kind === 'end');
    expect(end?.inputs).toEqual([
      expect.objectContaining({
        id: 'urn:sqlib:triples-quads:rdf',
        entityType: 'TriplesQuadsIO',
      }),
    ]);

    expect(state.edges).toEqual([
      expect.objectContaining({
        id: 'urn:sqlib:edge:control',
        flowType: 'CONTROL_FLOW',
      }),
      expect.objectContaining({
        id: 'urn:sqlib:edge:param',
        flowType: 'VARIABLE_BINDINGS',
      }),
      expect.objectContaining({
        id: 'urn:sqlib:edge:rdf',
        flowType: 'RDF_GRAPH',
      }),
    ]);
  });

  it('serialises graph state back into flat payload', () => {
    const state = createGraphStateFromExpanded(expandedSample);
    const flat = graphStateToFlatPayload(state);

    expect(flat.startNode).toEqual({
      id: 'urn:sqlib:startnode:start-1',
      outputs: [
        'urn:sqlib:control-output:demo',
        'urn:sqlib:output-tuple:external',
      ],
    });

    expect(flat.executionNodes).toEqual([
      {
        id: 'urn:sqlib:node:q1',
        nodeType: 'QueryNode',
        queryId: 'urn:sqlib:queryversion:select-1',
        backendId: 'urn:sqlib:backend:wikidata',
        inputs: ['urn:sqlib:input-tuple:params'],
        outputs: [
          'urn:sqlib:output-tuple:rows',
          'urn:sqlib:triples-quads:rdf',
        ],
      },
    ]);

    expect(flat.endNode).toEqual({
      id: 'urn:sqlib:endnode:end-1',
      inputs: ['urn:sqlib:triples-quads:rdf'],
      mediaType: 'application/n-triples',
    });

    expect(flat.edges).toEqual([
      {
        id: 'urn:sqlib:edge:control',
        sourceNodeId: 'urn:sqlib:startnode:start-1',
        targetNodeId: 'urn:sqlib:node:q1',
        dataFlowType: 'CONTROL_FLOW',
        sourceOutputId: null,
        targetInputId: null,
        whenEmpty: null,
        variableMappings: null,
      },
      {
        id: 'urn:sqlib:edge:param',
        sourceNodeId: 'urn:sqlib:startnode:start-1',
        targetNodeId: 'urn:sqlib:node:q1',
        dataFlowType: 'VARIABLE_BINDINGS',
        sourceOutputId: 'urn:sqlib:output-tuple:external',
        targetInputId: 'urn:sqlib:input-tuple:params',
        whenEmpty: null,
        variableMappings: null,
      },
      {
        id: 'urn:sqlib:edge:rdf',
        sourceNodeId: 'urn:sqlib:node:q1',
        targetNodeId: 'urn:sqlib:endnode:end-1',
        dataFlowType: 'RDF_GRAPH',
        sourceOutputId: 'urn:sqlib:triples-quads:rdf',
        targetInputId: 'urn:sqlib:triples-quads:rdf',
        whenEmpty: null,
        variableMappings: null,
      },
    ]);
  });
});
