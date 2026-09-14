import { describe, it, expect } from 'vitest';
import type {
  Query,
  QueryGroup,
  QueryVersionExpanded,
  QueryGroupVersionExpanded,
} from '@sparql-query-lib/contracts';
import { QueryTypeIri } from '@sparql-query-lib/types';
import {
  callableFromQueryVersion,
  callableFromGroupVersion,
  callablesAcceptingOutput,
  inputSummary,
  inputVariableNames,
  outputSummary,
  resultKindForQueryType,
  shortenDatatype,
  type Callable,
} from '@/lib/callables';

const XSD = 'http://www.w3.org/2001/XMLSchema#';

const QUERY: Query = {
  id: 'urn:q:order-detail',
  name: 'Order detail',
  description: 'One row per order',
  currentVersion: 'urn:qv:order-detail-v3',
  defaultBackend: null,
  isPartOf: ['urn:lib:storefront'],
  dateCreated: null,
  dateModified: null,
  argumentSets: null,
};

/**
 * A two-member VALUES tuple plus a LIMIT parameter, laid out the way the
 * expanded version response lays it out: flat entity lists joined by IRI.
 * `memberEntries` is deliberately out of position order — position, not array
 * order, is what the model must sort on.
 */
function queryVersionExpanded(overrides: Partial<QueryVersionExpanded> = {}): QueryVersionExpanded {
  return {
    queryVersion: {
      id: 'urn:qv:order-detail-v3',
      isPartOf: QUERY.id,
      version: 3,
      immutable: true,
      queryString: 'SELECT * WHERE { ?s ?p ?o }',
      comment: null,
      queryType: QueryTypeIri.select,
      limitParameters: null,
      offsetParameters: null,
      inferredInputs: null,
      inferredOutputs: null,
      dateCreated: null,
      dateModified: null,
      defaultBackend: null,
    },
    limitParameters: [
      { id: 'urn:lp:1', name: 'limit', value: null, defaultValue: 20, dateCreated: null, dateModified: null },
    ],
    offsetParameters: [],
    inputs: [
      { id: 'urn:in:product', variableName: 'product', allowedTypes: [`${XSD}anyURI`], dateCreated: null, dateModified: null },
      { id: 'urn:in:qty', variableName: 'qty', allowedTypes: [`${XSD}integer`], dateCreated: null, dateModified: null },
    ],
    outputs: [
      { id: 'urn:out:orderId', variableName: '?orderId', description: null, dateCreated: null, dateModified: null },
      { id: 'urn:out:total', variableName: '?total', description: null, dateCreated: null, dateModified: null },
    ],
    inputTuples: [
      { id: 'urn:tuple:1', name: 'line', memberEntries: ['urn:tm:qty', 'urn:tm:product'], dateCreated: null, dateModified: null },
    ],
    outputTuples: [],
    tupleMembers: [
      { id: 'urn:tm:product', position: 0, variable: 'urn:in:product', dateCreated: null, dateModified: null },
      { id: 'urn:tm:qty', position: 1, variable: 'urn:in:qty', dateCreated: null, dateModified: null },
    ],
    ...overrides,
  } as QueryVersionExpanded;
}

describe('shortenDatatype', () => {
  it('shortens xsd IRIs and passes anything else through whole', () => {
    expect(shortenDatatype(`${XSD}integer`)).toBe('xsd:integer');
    expect(shortenDatatype('http://example.org/custom')).toBe('http://example.org/custom');
    expect(shortenDatatype(null)).toBeNull();
  });
});

describe('resultKindForQueryType', () => {
  it('maps the SPARQL forms to the kinds the rail labels use', () => {
    expect(resultKindForQueryType(QueryTypeIri.select)).toBe('BINDINGS');
    expect(resultKindForQueryType(QueryTypeIri.ask)).toBe('BOOLEAN');
    expect(resultKindForQueryType(QueryTypeIri.construct)).toBe('GRAPH');
    expect(resultKindForQueryType(QueryTypeIri.describe)).toBe('GRAPH');
  });

  it('does not pass an update off as bindings', () => {
    expect(resultKindForQueryType(QueryTypeIri.update)).toBe('UPDATE');
    expect(resultKindForQueryType(QueryTypeIri.deleteInsert)).toBe('UPDATE');
  });

  it('falls back to bindings when the type was never recorded', () => {
    expect(resultKindForQueryType(null)).toBe('BINDINGS');
  });
});

describe('callableFromQueryVersion', () => {
  it('builds a live callable with its version number', () => {
    const callable = callableFromQueryVersion(QUERY, queryVersionExpanded());

    expect(callable.id).toBe(QUERY.id);
    expect(callable.type).toBe('query');
    expect(callable.state).toBe('live');
    expect(callable.version).toBe(3);
    expect(callable.libraryId).toBe('urn:lib:storefront');
    expect(callable.composes).toBeNull();
  });

  it('keeps a VALUES tuple as a group and orders members by position', () => {
    const callable = callableFromQueryVersion(QUERY, queryVersionExpanded());

    expect(callable.inputTuples).toHaveLength(1);
    expect(callable.inputTuples[0]!.members.map((m) => m.variableName)).toEqual(['product', 'qty']);
  });

  it('carries the datatypes the version stored', () => {
    const callable = callableFromQueryVersion(QUERY, queryVersionExpanded());

    expect(callable.inputTuples[0]!.members.map((m) => m.datatype)).toEqual([
      'xsd:anyURI',
      'xsd:integer',
    ]);
  });

  it('carries a limit parameter default', () => {
    const callable = callableFromQueryVersion(QUERY, queryVersionExpanded());
    expect(callable.limitParameters).toEqual([{ name: 'limit', defaultValue: 20 }]);
  });

  it('drops a tuple member whose entry has gone missing rather than throwing', () => {
    const callable = callableFromQueryVersion(
      QUERY,
      queryVersionExpanded({ tupleMembers: [] })
    );
    expect(callable.inputTuples[0]!.members).toEqual([]);
  });
});

describe('signature summaries', () => {
  it('lists tuple variables then limit and offset parameters', () => {
    const callable = callableFromQueryVersion(QUERY, queryVersionExpanded());
    expect(inputSummary(callable)).toBe('product, qty, limit');
  });

  it('says none when a callable takes no arguments', () => {
    const callable = callableFromQueryVersion(
      QUERY,
      queryVersionExpanded({ inputTuples: [], limitParameters: [], offsetParameters: [] })
    );
    expect(inputSummary(callable)).toBe('none');
  });

  it('renders a boolean and a graph result as the shape the caller gets', () => {
    const ask = callableFromQueryVersion(
      QUERY,
      queryVersionExpanded({
        queryVersion: { ...queryVersionExpanded().queryVersion, queryType: QueryTypeIri.ask },
      })
    );
    expect(outputSummary(ask)).toBe('true / false');

    const construct = callableFromQueryVersion(
      QUERY,
      queryVersionExpanded({
        queryVersion: { ...queryVersionExpanded().queryVersion, queryType: QueryTypeIri.construct },
      })
    );
    expect(outputSummary(construct)).toBe('?s ?p ?o');
  });

  it('joins output variable names for bindings', () => {
    const callable = callableFromQueryVersion(QUERY, queryVersionExpanded());
    expect(outputSummary(callable)).toBe('?orderId, ?total');
    expect(inputVariableNames(callable)).toEqual(['product', 'qty']);
  });
});

// --- Query groups ----------------------------------------------------------

const GROUP: QueryGroup = {
  id: 'urn:g:order-flow',
  name: 'Order detail',
  description: null,
  currentVersion: 'urn:gv:order-flow-v1',
  isPartOf: 'urn:lib:storefront',
  dateCreated: null,
  dateModified: null,
  argumentSets: null,
};

function groupVersionExpanded(
  overrides: Partial<QueryGroupVersionExpanded> = {}
): QueryGroupVersionExpanded {
  return {
    queryGroupVersion: {
      id: 'urn:gv:order-flow-v1',
      version: 1,
      immutable: true,
      startNode: null,
      endNode: null,
      executionNodes: null,
      edges: null,
      canvasData: null,
      comment: null,
      dateCreated: null,
      dateModified: null,
      isPartOf: GROUP.id,
    },
    executionNodes: [],
    startNode: null,
    endNode: null,
    edges: [],
    queryNodes: [{ id: 'urn:qn:1' }, { id: 'urn:qn:2' }],
    dynamicQueryNodes: [],
    ruleSetNodes: [],
    startNodes: [],
    endNodes: [],
    tupleMembers: [
      { id: 'urn:tm:order', position: 0, variable: 'urn:in:orderId', dateCreated: null, dateModified: null },
    ],
    inputTuples: [
      { id: 'urn:tuple:g1', name: null, memberEntries: ['urn:tm:order'], dateCreated: null, dateModified: null },
    ],
    outputTuples: [],
    inputs: [
      { id: 'urn:in:orderId', variableName: 'orderId', allowedTypes: null, dateCreated: null, dateModified: null },
    ],
    outputs: [
      { id: 'urn:out:orderId', variableName: '?orderId', description: null, dateCreated: null, dateModified: null },
      { id: 'urn:out:status', variableName: '?status', description: null, dateCreated: null, dateModified: null },
    ],
    rdfOutputs: [],
    booleanOutputs: [],
    queryIdInputs: [],
    queryVersions: [],
    ...overrides,
  } as unknown as QueryGroupVersionExpanded;
}

describe('callableFromGroupVersion', () => {
  it('counts what the group composes', () => {
    const callable = callableFromGroupVersion(GROUP, groupVersionExpanded());
    expect(callable.type).toBe('group');
    expect(callable.composes).toBe(2);
    expect(callable.libraryId).toBe('urn:lib:storefront');
  });

  it('takes the result kind from what the group emits, not from its members', () => {
    expect(callableFromGroupVersion(GROUP, groupVersionExpanded()).resultKind).toBe('BINDINGS');

    const graph = callableFromGroupVersion(
      GROUP,
      groupVersionExpanded({ rdfOutputs: [{ id: 'urn:rdf:1' }] as never })
    );
    expect(graph.resultKind).toBe('GRAPH');

    const boolean = callableFromGroupVersion(
      GROUP,
      groupVersionExpanded({ booleanOutputs: [{ id: 'urn:bool:1' }] as never })
    );
    expect(boolean.resultKind).toBe('BOOLEAN');
  });
});

// --- Signature matching (§7) ----------------------------------------------

function callableWith(
  id: string,
  inputs: string[],
  outputs: string[],
  overrides: Partial<Callable> = {}
): Callable {
  return {
    id,
    name: id,
    description: null,
    type: 'query',
    state: 'live',
    version: 1,
    libraryId: 'urn:lib:storefront',
    resultKind: 'BINDINGS',
    inputTuples: inputs.length
      ? [{ id: `${id}#t`, name: null, members: inputs.map((v) => ({ variableName: v, datatype: null })) }]
      : [],
    limitParameters: [],
    offsetParameters: [],
    outputs: outputs.map((variableName) => ({ variableName, description: null })),
    composes: null,
    ...overrides,
  };
}

describe('callablesAcceptingOutput', () => {
  const source = callableWith('source', [], ['?orderId', '?status']);

  it('matches a callable whose inputs the output covers', () => {
    const matches = callablesAcceptingOutput(source, [callableWith('shipment', ['orderId'], [])]);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.sharedVariables).toEqual(['?orderId']);
  });

  it('ignores the leading question mark on either side', () => {
    const matches = callablesAcceptingOutput(source, [callableWith('shipment', ['?orderId'], [])]);
    expect(matches).toHaveLength(1);
  });

  it('does not match when only some inputs are covered', () => {
    const matches = callablesAcceptingOutput(source, [
      callableWith('invoice', ['orderId', 'customerId'], []),
    ]);
    expect(matches).toEqual([]);
  });

  it('excludes a callable that takes no inputs — everything would match it', () => {
    const matches = callablesAcceptingOutput(source, [callableWith('facets', [], ['?category'])]);
    expect(matches).toEqual([]);
  });

  it('excludes the source itself', () => {
    const matches = callablesAcceptingOutput(source, [source]);
    expect(matches).toEqual([]);
  });

  it('offers nothing to chain from a graph or boolean result', () => {
    const ask = callableWith('in-stock', [], [], { resultKind: 'BOOLEAN' });
    expect(callablesAcceptingOutput(ask, [callableWith('shipment', ['orderId'], [])])).toEqual([]);
  });
});
