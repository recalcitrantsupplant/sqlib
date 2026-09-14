/**
 * One graph, described the two ways the canvas can receive it: as an expanded
 * query-group version (reload) and as an expanded query version (assignment).
 *
 * The two descriptions are deliberately built from the same constants, so a
 * test that finds them producing different canvas state has found a real
 * asymmetry rather than a typo in a fixture.
 */

import type { QueryGroupVersionExpandedWithIriMap, QueryVersionExpanded } from '@sparql-query-lib/contracts';

export const IDS = {
  group: 'urn:sqlib:group:1',
  groupVersion: 'urn:sqlib:group-version:1',
  startNode: 'urn:sqlib:start-node:1',
  endNode: 'urn:sqlib:end-node:1',
  queryNode: 'urn:sqlib:node:select',
  secondQueryNode: 'urn:sqlib:node:select-2',
  boundaryEdge: 'urn:sqlib:edge:boundary',
  resultEdge: 'urn:sqlib:edge:result',

  selectVersion: 'urn:sqlib:query-version:select',
  selectQuery: 'urn:sqlib:query:select',

  boundaryTuple: 'urn:sqlib:input-tuple:boundary',
  boundaryMember: 'urn:sqlib:tuple-member:boundary-0',
  boundaryVariable: 'urn:sqlib:input:boundary-city',

  inputTuple: 'urn:sqlib:input-tuple:select-in',
  inputMemberCity: 'urn:sqlib:tuple-member:in-0',
  inputMemberCountry: 'urn:sqlib:tuple-member:in-1',
  inputVarCity: 'urn:sqlib:input:city',
  inputVarCountry: 'urn:sqlib:input:country',

  outputTuple: 'urn:sqlib:output-tuple:select-out',
  outputMemberCity: 'urn:sqlib:tuple-member:out-0',
  outputMemberPop: 'urn:sqlib:tuple-member:out-1',
  outputMemberArea: 'urn:sqlib:tuple-member:out-2',
  outputVarCity: 'urn:sqlib:output:city',
  outputVarPop: 'urn:sqlib:output:pop',
  outputVarArea: 'urn:sqlib:output:area',
} as const;

const SELECT_QUERY_TYPE = 'https://sparql-query-lib/query-type/select';

/** The SELECT version's own tuples: two inputs in, three outputs out. */
const queryVersionEntities = {
  inputTuples: [
    { id: IDS.inputTuple, name: 'city-country', memberEntries: [IDS.inputMemberCity, IDS.inputMemberCountry] },
  ],
  outputTuples: [
    {
      id: IDS.outputTuple,
      name: 'results',
      memberEntries: [IDS.outputMemberCity, IDS.outputMemberPop, IDS.outputMemberArea],
    },
  ],
  tupleMembers: [
    { id: IDS.inputMemberCity, position: 0, variable: IDS.inputVarCity },
    { id: IDS.inputMemberCountry, position: 1, variable: IDS.inputVarCountry },
    { id: IDS.outputMemberCity, position: 0, variable: IDS.outputVarCity },
    { id: IDS.outputMemberPop, position: 1, variable: IDS.outputVarPop },
    { id: IDS.outputMemberArea, position: 2, variable: IDS.outputVarArea },
  ],
  inputs: [
    { id: IDS.inputVarCity, variableName: 'city' },
    { id: IDS.inputVarCountry, variableName: 'country' },
  ],
  outputs: [
    { id: IDS.outputVarCity, variableName: 'city' },
    { id: IDS.outputVarPop, variableName: 'pop' },
    { id: IDS.outputVarArea, variableName: 'area' },
  ],
};

export const selectQueryVersionExpanded = (): QueryVersionExpanded =>
  ({
    queryVersion: {
      id: IDS.selectVersion,
      isPartOf: IDS.selectQuery,
      version: 1,
      queryString: 'SELECT ?city ?pop ?area WHERE { VALUES (?city ?country) {} }',
      queryType: SELECT_QUERY_TYPE,
      inferredInputs: [IDS.inputTuple],
      inferredOutputs: [IDS.outputTuple],
    },
    limitParameters: [],
    offsetParameters: [],
    ...structuredClone(queryVersionEntities),
  }) as unknown as QueryVersionExpanded;

export const OTHER_IDS = {
  version: 'urn:sqlib:query-version:other',
  query: 'urn:sqlib:query:other',
  inputTuple: 'urn:sqlib:input-tuple:other-in',
  inputMember: 'urn:sqlib:tuple-member:other-in-0',
  inputVar: 'urn:sqlib:input:region',
  outputTuple: 'urn:sqlib:output-tuple:other-out',
  outputMember: 'urn:sqlib:tuple-member:other-out-0',
  outputVar: 'urn:sqlib:output:region',
} as const;

/** A different query version, so a node can be switched away from the first. */
export const otherQueryVersionExpanded = (): QueryVersionExpanded =>
  ({
    queryVersion: {
      id: OTHER_IDS.version,
      isPartOf: OTHER_IDS.query,
      version: 1,
      queryString: 'SELECT ?region WHERE { VALUES (?region) {} }',
      queryType: SELECT_QUERY_TYPE,
      inferredInputs: [OTHER_IDS.inputTuple],
      inferredOutputs: [OTHER_IDS.outputTuple],
    },
    limitParameters: [],
    offsetParameters: [],
    inputTuples: [{ id: OTHER_IDS.inputTuple, name: 'region', memberEntries: [OTHER_IDS.inputMember] }],
    outputTuples: [{ id: OTHER_IDS.outputTuple, name: 'regions', memberEntries: [OTHER_IDS.outputMember] }],
    tupleMembers: [
      { id: OTHER_IDS.inputMember, position: 0, variable: OTHER_IDS.inputVar },
      { id: OTHER_IDS.outputMember, position: 0, variable: OTHER_IDS.outputVar },
    ],
    inputs: [{ id: OTHER_IDS.inputVar, variableName: 'region' }],
    outputs: [{ id: OTHER_IDS.outputVar, variableName: 'region' }],
  }) as unknown as QueryVersionExpanded;

type GroupOptions = {
  /** Give the query node(s) no persisted ports, as a stale save would. */
  omitNodePorts?: boolean;
  /** Add a second node on the same query version. */
  withSecondNode?: boolean;
};

export const selectGroupVersionExpanded = (options: GroupOptions = {}): QueryGroupVersionExpandedWithIriMap => {
  const nodePorts = options.omitNodePorts
    ? { inputs: [], outputs: [] }
    : { inputs: [IDS.inputTuple], outputs: [IDS.outputTuple] };

  const queryNode = (id: string) => ({
    id,
    nodeType: 'QueryNode' as const,
    queryId: IDS.selectVersion,
    backendId: 'urn:sqlib:backend:1',
    ...nodePorts,
  });

  const executionNodes = [queryNode(IDS.queryNode)];
  if (options.withSecondNode) executionNodes.push(queryNode(IDS.secondQueryNode));

  return {
    queryGroupVersion: {
      id: IDS.groupVersion,
      isPartOf: IDS.group,
      version: 1,
      startNode: IDS.startNode,
      endNode: IDS.endNode,
      executionNodes: executionNodes.map(node => node.id),
      edges: [IDS.boundaryEdge, IDS.resultEdge],
      canvasData: null,
      comment: null,
      dateCreated: null,
      dateModified: null,
    },
    executionNodes,
    startNode: { id: IDS.startNode, outputs: [IDS.boundaryTuple] },
    endNode: { id: IDS.endNode, inputs: [IDS.outputTuple], mediaType: null },
    edges: [
      {
        id: IDS.boundaryEdge,
        sourceNodeId: IDS.startNode,
        targetNodeId: IDS.queryNode,
        dataFlowType: 'VARIABLE_BINDINGS',
        sourceOutputId: IDS.boundaryTuple,
        targetInputId: IDS.inputTuple,
        variableMappings: null,
      },
      {
        id: IDS.resultEdge,
        sourceNodeId: IDS.queryNode,
        targetNodeId: IDS.endNode,
        dataFlowType: 'VARIABLE_BINDINGS',
        sourceOutputId: IDS.outputTuple,
        targetInputId: IDS.outputTuple,
        variableMappings: null,
      },
    ],
    queryNodes: executionNodes,
    dynamicQueryNodes: [],
    ruleSetNodes: [],
    startNodes: [{ id: IDS.startNode, outputs: [IDS.boundaryTuple] }],
    endNodes: [{ id: IDS.endNode, inputs: [IDS.outputTuple], mediaType: null }],

    // The transport closure: the group's own boundary tuple alongside every
    // entity the referenced query version needs.
    inputTuples: [
      { id: IDS.boundaryTuple, name: 'Cities', memberEntries: [IDS.boundaryMember] },
      ...queryVersionEntities.inputTuples,
    ],
    outputTuples: [...queryVersionEntities.outputTuples],
    tupleMembers: [
      { id: IDS.boundaryMember, position: 0, variable: IDS.boundaryVariable },
      ...queryVersionEntities.tupleMembers,
    ],
    inputs: [{ id: IDS.boundaryVariable, variableName: 'city' }, ...queryVersionEntities.inputs],
    outputs: [...queryVersionEntities.outputs],
    rdfOutputs: [],
    booleanOutputs: [],
    queryIdInputs: [],
    queryVersions: [
      {
        id: IDS.selectVersion,
        isPartOf: IDS.selectQuery,
        version: 1,
        queryString: 'SELECT ?city ?pop ?area WHERE { VALUES (?city ?country) {} }',
        queryType: SELECT_QUERY_TYPE,
        inferredInputs: [IDS.inputTuple],
        inferredOutputs: [IDS.outputTuple],
      },
    ],
    iriMap: { [IDS.selectVersion]: 'City lookup' },
  } as unknown as QueryGroupVersionExpandedWithIriMap;
};

/** The same group before any query is assigned to its execution node. */
export const unassignedGroupVersionExpanded = (): QueryGroupVersionExpandedWithIriMap => {
  const expanded = selectGroupVersionExpanded();
  return {
    ...expanded,
    executionNodes: [
      { id: IDS.queryNode, nodeType: 'QueryNode', queryId: null, backendId: 'urn:sqlib:backend:1', inputs: [], outputs: [] },
    ],
    queryNodes: [],
    endNode: { ...expanded.endNode, inputs: [] },
    endNodes: [{ ...expanded.endNodes[0], inputs: [] }],
    edges: [],
    outputTuples: [],
    inputTuples: expanded.inputTuples.filter(tuple => tuple.id === IDS.boundaryTuple),
    tupleMembers: expanded.tupleMembers.filter(member => member.id === IDS.boundaryMember),
    inputs: expanded.inputs.filter(variable => variable.id === IDS.boundaryVariable),
    outputs: [],
    queryVersions: [],
  } as unknown as QueryGroupVersionExpandedWithIriMap;
};

/** What a node exposes, reduced to the part the inspector and edges rely on. */
export const observablePorts = (node: { inputs: Array<{ id: string; entityType: string }>; outputs: Array<{ id: string; entityType: string }> }) => ({
  inputs: node.inputs.map(port => ({ id: port.id, entityType: port.entityType })),
  outputs: node.outputs.map(port => ({ id: port.id, entityType: port.entityType })),
});
