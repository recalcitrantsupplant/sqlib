/**
 * The canned backend the query group e2e specs run against.
 *
 * Split out of `query-group-test-helpers.ts` so it can be imported without
 * Playwright. That file pulls in `expect` from `@playwright/test`, which made
 * this fixture unreachable from a unit test — and an 800-line executable
 * description of the API that nothing verifies is exactly the thing that drifts
 * (see `test/lib/mockApiContract.test.ts`, and issue #47).
 *
 * Data, plus the one piece of behaviour a unit test has to be able to reach:
 * what `POST /query-groups/:id/v` answers. The routing itself lives in the
 * helper.
 */
import type {
  Backend,
  Library,
  Query,
  QueryVersion,
  QueryGroup,
  QueryGroupVersion,
  QueryGroupVersionExpanded,
  RuleSet,
  RuleSetVersion,
} from '@sparql-query-lib/contracts';

export type StoredQueryVersion = QueryVersion & { queryString: string };

/**
 * An argument set version as `GET /argument-sets/:id/v/:n` answers.
 *
 * Not a contracts type: argument sets have no generated schema yet, so this
 * mirrors `argumentSetVersionResponseSchema`
 * (`packages/api/src/routes/argument-set-schemas.ts`) by hand. The client's own
 * Zod parse is what actually holds the two together — a response of the wrong
 * shape throws inside `useApiClient` and the panel shows nothing.
 */
export type StoredArgumentRow = {
  id: string;
  position: number;
  values: Record<string, { type: 'uri' | 'literal'; value: string; datatype?: string }>;
};

export type StoredArgumentTupleBinding = {
  id: string;
  tupleSignature: string;
  variables: string[];
  rows: StoredArgumentRow[];
  tupleSetVersions?: string[];
};

export type StoredArgumentSetVersion = {
  id: string;
  isPartOf: string;
  version: number;
  tupleBindings: StoredArgumentTupleBinding[];
  scalarBindings: unknown[];
  graphBindings?: unknown[];
  dateCreated: string;
  dateModified: string;
};

/** An argument set as the API expands it: the set, plus its current version. */
export type StoredArgumentSet = {
  id: string;
  name: string;
  description: string | null;
  /* Provenance. A set made on this group's screen carries both. */
  scope: 'query' | 'queryGroup' | null;
  targetId: string | null;
  libraryId: string;
  currentVersionId: string;
  currentVersion: StoredArgumentSetVersion;
  tupleBindings: StoredArgumentTupleBinding[];
  scalarBindings: unknown[];
  dateCreated: string;
  dateModified: string;
};

export type MockState = {
  backends: Backend[];
  libraries: Library[];
  queries: Query[];
  queryVersions: Record<string, StoredQueryVersion[]>;
  queryGroups: QueryGroup[];
  queryGroupVersions: Record<string, QueryGroupVersion[]>;
  queryGroupExpanded: Record<string, Record<number, QueryGroupVersionExpanded>>;
  nextQueryVersion: Record<string, number>;
  nextQueryGroupVersion: Record<string, number>;
  argumentSets: StoredArgumentSet[];
  argumentSetVersions: Record<string, StoredArgumentSetVersion[]>;
  nextArgumentSetVersion: Record<string, number>;
  /*
   * The library's rule sets, so a canvas can put one on a RuleSetNode. Kept
   * out of the seeded group deliberately: a node the specs *add* is the flow
   * worth testing, and seeding one would change the graph every other query
   * group spec asserts on.
   */
  ruleSets: RuleSet[];
  ruleSetVersions: Record<string, RuleSetVersion[]>;
};

/**
 * What one node reports back from a run, as `/execute?nodeDetail=results` sends it.
 *
 * `status: 'pending'` never reaches a client — a node is only reported once it
 * has started — so the three the canvas can actually receive are the three here.
 */
export type NodeDetailFixture = {
  nodeId: string;
  status: 'running' | 'ok' | 'failed';
  durationMs?: number;
  rowCount?: number;
  tripleCount?: number;
  result?: unknown;
  error?: string;
};

/**
 * The *result* of a run, and what each node did to produce it.
 *
 * `contentType` and `body` describe the result alone. How they reach the client
 * depends on the request: a run that asks for `nodeDetail` — which is every run
 * the query group screen makes — gets them wrapped in the `{ result, nodes,
 * resultContentType }` envelope, because that is the only thing the server can
 * answer such a request with. See `wrapExecutionResponse`.
 */
export type ExecutionResponseFixture = {
  status?: number;
  contentType?: string;
  body: string | Record<string, unknown> | unknown[];
  /** Per-node detail. Omitted means "the server reported no nodes", not "no detail was asked for". */
  nodes?: NodeDetailFixture[];
};

/**
 * What `GET /query-groups/:id/v/:n/validate` answers.
 *
 * An `issue` whose `entityId` names a node, edge or port is decorated onto that
 * element of the canvas (`useCanvasValidation`); one that names nothing is a
 * graph-level issue. Execution pre-flights this route, so `valid: false` is also
 * how a spec stops a run before it reaches `/execute`.
 */
export type ValidationResponseFixture = {
  valid: boolean;
  /** Strings, as the client's schema demands — objects here fail the parse. */
  errors?: string[];
  warnings?: string[];
  issues?: Array<{
    level: 'error' | 'warning';
    message: string;
    entityType?: string;
    entityId?: string | null;
    code?: string | null;
  }>;
};

export type SetupMockApiOptions = {
  executionResponse?: ExecutionResponseFixture | (() => ExecutionResponseFixture);
  validationResponse?: ValidationResponseFixture | (() => ValidationResponseFixture);
};

export const LIBRARY_ID = 'urn:sqlib:library:integration-demo';
export const LIBRARY_NAME = 'Integration Library';
export const BACKEND_ID = 'urn:sqlib:backend:wikidata';
export const EXISTING_QUERY_ID = 'urn:sqlib:query:existing';
export const EXISTING_QUERY_VERSION_ID = `${EXISTING_QUERY_ID}:v1`;
export const EXISTING_QUERY_NAME = 'Existing Countries Query';
export const GROUP_ID = 'urn:sqlib:query-group:canvas-flow';
export const GROUP_NAME = 'Sample Query Group';
export const START_NODE_ID = 'urn:sqlib:startnode:flow-start';
export const END_NODE_ID = 'urn:sqlib:endnode:flow-end';
export const QUERY_NODE_ID = 'urn:sqlib:node:cities';
export const CONTROL_EDGE_ID = 'urn:sqlib:edge:control';
export const DATA_EDGE_ID = 'urn:sqlib:edge:data';
export const OUTPUT_EDGE_ID = 'urn:sqlib:edge:rdf';
export const START_CONTROL_PORT = 'urn:sqlib:control-output:start';
/*
 * A start node's bindings port is a QueryInputTuple, not an output tuple: what
 * the Start node *saves* is the group's inputs, and `legalSourcePortKinds`
 * refuses a QueryOutputTuple there. Declared as an output tuple, as it was
 * until now, this fixture described a group the canvas marks broken on sight —
 * "Start Params is a QueryOutputTuple, which a VARIABLE_BINDINGS edge cannot
 * use as its source" — and offered no candidate to fix it with.
 */
export const START_TUPLE_PORT = 'urn:sqlib:input-tuple:start-binding';
export const NODE_INPUT_PORT = 'urn:sqlib:input-tuple:city-params';
export const NODE_OUTPUT_PORT = 'urn:sqlib:triples-quads:city-rdf';

/*
 * An UPDATE query, so a patch node has something it can legally derive.
 *
 * It has to be a second query rather than a second version of the existing one:
 * a patch node refuses anything that is not an update, and the seeded SELECT is
 * what every other spec assigns. Its `queryType` is declared because the server
 * derives one from the query string and the canvas keys on it — a patch node
 * pointed at a version claiming no type has nothing to check.
 */
export const UPDATE_QUERY_ID = 'urn:sqlib:query:retire-value';
export const UPDATE_QUERY_VERSION_ID = `${UPDATE_QUERY_ID}:v1`;
export const UPDATE_QUERY_NAME = 'Retire the old value';
export const UPDATE_QUERY_TYPE_IRI = 'https://sparql-query-lib/query-type/update';

export const RULE_SET_ID = 'urn:sqlib:rule-set:transit';
export const RULE_SET_NAME = 'Transit Rules';
export const RULE_SET_VERSION_1_ID = `${RULE_SET_ID}:v1`;
export const RULE_SET_VERSION_2_ID = `${RULE_SET_ID}:v2`;

/*
 * The variables those two tuples carry. A tuple with no members has no arity
 * and no mapping, so the inspector's variable grid — the thing that says which
 * of the source's columns lands in which of the target's — had nothing to draw.
 * `city` is common to both; `region` is the target-only name that shows what an
 * unmapped variable looks like.
 */
export const START_VAR_CITY = 'urn:sqlib:query-input:start-city';
export const START_VAR_COUNTRY = 'urn:sqlib:query-input:start-country';
export const START_MEMBER_CITY = 'urn:sqlib:tuple-member:start-city';
export const START_MEMBER_COUNTRY = 'urn:sqlib:tuple-member:start-country';
/*
 * A saved argument set for the group, over the variables the start node's tuple
 * declares — `city` and `country`, in that order, which is what makes it *fit*
 * this group rather than merely parse. A set whose clause named other variables
 * would list in the switcher with a "does not fit" verdict, which is a
 * different spec from the one these exist for.
 */
export const ARGUMENT_SET_ID = 'urn:sqlib:argument-set:capital-cities';
export const ARGUMENT_SET_NAME = 'Capital cities';
export const ARGUMENT_SET_VERSION_ID = `${ARGUMENT_SET_ID}:v1`;
export const ARGUMENT_SET_CITY = 'https://example.org/city/perth';
export const ARGUMENT_SET_COUNTRY = 'https://example.org/country/au';

/*
 * A set made on the *query* next door, in the same library. Scope has always
 * been provenance rather than a fence, so the group's switcher offers this one
 * too — with a verdict, because its single `city` column cannot fill a
 * two-variable tuple. Without a second set in the fixture, "elsewhere in the
 * library" and the fits/doesn't-fit verdict are both unreachable.
 */
export const FOREIGN_ARGUMENT_SET_ID = 'urn:sqlib:argument-set:query-side-cities';
export const FOREIGN_ARGUMENT_SET_NAME = 'Query-side cities';

export const NODE_VAR_CITY = 'urn:sqlib:query-input:city';
export const NODE_VAR_REGION = 'urn:sqlib:query-input:region';
export const NODE_MEMBER_CITY = 'urn:sqlib:tuple-member:city';
export const NODE_MEMBER_REGION = 'urn:sqlib:tuple-member:region';

const isoNow = () => new Date().toISOString();

function makeEtag(kind: string, value: string) {
  return `"${kind}-${value}"`;
}

export const createMockState = (): MockState => {
  const now = isoNow();
  const backends: Backend[] = [
    {
      id: BACKEND_ID,
      name: 'Wikidata',
      description: 'Public SPARQL endpoint',
      backendType: 'http',
      endpoint: 'https://query.wikidata.org/sparql',
      authEnvKey: null,
      oxigraphConfig: null,
      dateCreated: now,
      dateModified: now,
    },
  ];

  const libraries: Library[] = [
    {
      id: LIBRARY_ID,
      name: LIBRARY_NAME,
      description: 'Demo library for canvas flow',
      defaultBackend: BACKEND_ID,
      dateCreated: now,
      dateModified: now,
    },
  ];

  const queries: Query[] = [
    {
      id: EXISTING_QUERY_ID,
      name: EXISTING_QUERY_NAME,
      description: 'Pre-seeded query powering the group',
      defaultBackend: BACKEND_ID,
      currentVersion: EXISTING_QUERY_VERSION_ID,
      isPartOf: [LIBRARY_ID],
      dateCreated: now,
      dateModified: now,
    },
    {
      id: UPDATE_QUERY_ID,
      name: UPDATE_QUERY_NAME,
      description: 'An update a patch node can derive the effect of',
      defaultBackend: BACKEND_ID,
      currentVersion: UPDATE_QUERY_VERSION_ID,
      isPartOf: [LIBRARY_ID],
      dateCreated: now,
      dateModified: now,
    },
  ];

  const queryVersions: Record<string, StoredQueryVersion[]> = {
    [EXISTING_QUERY_ID]: [
      {
        id: EXISTING_QUERY_VERSION_ID,
        version: 1,
        queryString: 'SELECT ?country WHERE { ?country wdt:P31 wd:Q6256 } LIMIT 5',
        comment: 'Initial version',
        isPartOf: EXISTING_QUERY_ID,
        defaultBackend: BACKEND_ID,
        /*
         * The ports the seeded node already declares, said by the entity that
         * owns them. A query version is the canonical interface of every node
         * referencing it (`expandGroupVersionDetailed`), which is what makes a
         * reloaded node show the same ports as a freshly assigned one — and
         * what `buildExecutionNodes` looks for before it decides the node's
         * query version is unreadable. Nothing about the drawn graph changes.
         */
        inferredInputs: [NODE_INPUT_PORT],
        inferredOutputs: [NODE_OUTPUT_PORT],
        dateCreated: now,
        dateModified: now,
      },
    ],
    [UPDATE_QUERY_ID]: [
      {
        id: UPDATE_QUERY_VERSION_ID,
        version: 1,
        queryString: 'DELETE { ?s ?p ?o } INSERT { ?s ?p "new" } WHERE { ?s ?p ?o }',
        comment: 'Initial version',
        isPartOf: UPDATE_QUERY_ID,
        defaultBackend: BACKEND_ID,
        queryType: UPDATE_QUERY_TYPE_IRI,
        dateCreated: now,
        dateModified: now,
      },
    ],
  };

  const ruleSets: RuleSet[] = [
    {
      id: RULE_SET_ID,
      name: RULE_SET_NAME,
      description: 'Inference rules a canvas node can run',
      currentVersion: RULE_SET_VERSION_2_ID,
      currentVersionNumber: 2,
      isPartOf: [LIBRARY_ID],
      rules: null,
      dataBlocks: null,
      tags: null,
      dateCreated: now,
      dateModified: now,
    },
  ];

  // Two versions, because the selector renders a version picker only for a
  // rule set that has more than one — a single-version row shows static text.
  const ruleSetVersions: Record<string, RuleSetVersion[]> = {
    [RULE_SET_ID]: [
      {
        id: RULE_SET_VERSION_1_ID,
        isPartOf: RULE_SET_ID,
        version: 1,
        immutable: true,
        comment: 'Initial rules',
        hasRule: null,
        hasDataBlock: null,
        stratificationReport: null,
        dateCreated: now,
        dateModified: now,
      },
      {
        id: RULE_SET_VERSION_2_ID,
        isPartOf: RULE_SET_ID,
        version: 2,
        immutable: null,
        comment: 'Adds the interchange rule',
        hasRule: null,
        hasDataBlock: null,
        stratificationReport: null,
        dateCreated: now,
        dateModified: now,
      },
    ],
  };

  const queryGroups: QueryGroup[] = [
    {
      id: GROUP_ID,
      name: GROUP_NAME,
      description: 'Routes start inputs through an execution node',
      isPartOf: LIBRARY_ID,
      currentVersion: `${GROUP_ID}:v1`,
      dateCreated: now,
      dateModified: now,
    },
  ];

  const queryGroupVersionSummary: QueryGroupVersion = {
    id: `${GROUP_ID}:v1`,
    version: 1,
    startNode: START_NODE_ID,
    endNode: END_NODE_ID,
    executionNodes: [QUERY_NODE_ID],
    edges: [CONTROL_EDGE_ID, DATA_EDGE_ID, OUTPUT_EDGE_ID],
    canvasData: null,
    comment: 'Initial layout',
    dateCreated: now,
    dateModified: now,
    isPartOf: GROUP_ID,
  };

  const expanded: QueryGroupVersionExpanded = {
    queryGroupVersion: queryGroupVersionSummary,
    startNode: {
      id: START_NODE_ID,
      outputs: [START_CONTROL_PORT, START_TUPLE_PORT],
      dateCreated: now,
      dateModified: now,
    },
    endNode: {
      id: END_NODE_ID,
      inputs: [NODE_OUTPUT_PORT],
      mediaType: 'application/sparql-results+json',
      dateCreated: now,
      dateModified: now,
    },
    executionNodes: [
      {
        id: QUERY_NODE_ID,
        inputs: [NODE_INPUT_PORT],
        outputs: [NODE_OUTPUT_PORT],
        queryId: EXISTING_QUERY_VERSION_ID,
        backendId: BACKEND_ID,
        backendConfig: null,
        nodeType: 'QueryNode',
        dateCreated: now,
        dateModified: now,
      },
    ],
    edges: [
      {
        id: CONTROL_EDGE_ID,
        sourceNodeId: START_NODE_ID,
        targetNodeId: QUERY_NODE_ID,
        dataFlowType: 'CONTROL_FLOW',
        /*
         * No endpoints, which is what a control-flow edge is: it orders
         * execution and carries nothing, so `resolveEndpoints` returns a null
         * pair for one and `checkEndpoint` calls a port on one an error. The
         * anchor stays in the Start node's outputs — that is a handle for the
         * canvas to draw from, not a port the edge names.
         */
        sourceOutputId: null,
        targetInputId: null,
      },
      {
        id: DATA_EDGE_ID,
        sourceNodeId: START_NODE_ID,
        targetNodeId: QUERY_NODE_ID,
        dataFlowType: 'VARIABLE_BINDINGS',
        sourceOutputId: START_TUPLE_PORT,
        targetInputId: NODE_INPUT_PORT,
      },
      {
        id: OUTPUT_EDGE_ID,
        sourceNodeId: QUERY_NODE_ID,
        targetNodeId: END_NODE_ID,
        dataFlowType: 'RDF_GRAPH',
        sourceOutputId: NODE_OUTPUT_PORT,
        targetInputId: NODE_OUTPUT_PORT,
      },
    ],
    tupleMembers: [
      { id: START_MEMBER_CITY, position: 0, variable: START_VAR_CITY },
      { id: START_MEMBER_COUNTRY, position: 1, variable: START_VAR_COUNTRY },
      { id: NODE_MEMBER_CITY, position: 0, variable: NODE_VAR_CITY },
      { id: NODE_MEMBER_REGION, position: 1, variable: NODE_VAR_REGION },
    ],
    inputTuples: [
      {
        id: START_TUPLE_PORT,
        name: 'Start Params',
        memberEntries: [START_MEMBER_CITY, START_MEMBER_COUNTRY],
      },
      {
        id: NODE_INPUT_PORT,
        name: 'City Params',
        memberEntries: [NODE_MEMBER_CITY, NODE_MEMBER_REGION],
      },
    ],
    outputTuples: [],
    inputs: [
      { id: START_VAR_CITY, variableName: 'city' },
      { id: START_VAR_COUNTRY, variableName: 'country' },
      { id: NODE_VAR_CITY, variableName: 'city' },
      { id: NODE_VAR_REGION, variableName: 'region' },
    ],
    outputs: [],
    rdfOutputs: [
      {
        id: NODE_OUTPUT_PORT,
        name: 'City RDF',
        description: 'Sample RDF output',
        ioType: 'output',
        outputType: 'RDF_GRAPH',
        triplesOrQuads: null,
        specifiedGraph: null,
        dateCreated: now,
        dateModified: now,
      },
    ],
    booleanOutputs: [],
    queryIdInputs: [],
    /*
     * The query versions the nodes name. The expansion is what carries them.
     *
     * Without them `buildExecutionNodes` cannot tell "this node's query has no
     * ports" from "the saved group did not describe this query version", so it
     * says the second — a blocking `NODE_QUERY_VERSION_UNREADABLE` on the one
     * node of the one group ten specs load. They asserted on other things and
     * never saw it; `test/lib/canvasFixtureHealth.test.ts` is what does.
     */
    queryVersions: queryVersions[EXISTING_QUERY_ID],
  };

  /*
   * One saved set, so the switcher has something to offer a group that has just
   * been opened — the state a user is in far more often than "no set has ever
   * been made here". Its rows come back with the ids and positions the server
   * synthesises (`ArgumentSetService.expandTupleBinding`), not the bare
   * `{ values }` a client sends.
   */
  const argumentSetVersion: StoredArgumentSetVersion = {
    id: ARGUMENT_SET_VERSION_ID,
    isPartOf: ARGUMENT_SET_ID,
    version: 1,
    tupleBindings: [
      {
        id: `${ARGUMENT_SET_ID}:binding:1`,
        tupleSignature: 'city|country',
        variables: ['city', 'country'],
        rows: [
          {
            id: `${ARGUMENT_SET_ID}:binding:1:row:0`,
            position: 0,
            values: {
              city: { type: 'uri', value: ARGUMENT_SET_CITY },
              country: { type: 'uri', value: ARGUMENT_SET_COUNTRY },
            },
          },
        ],
      },
    ],
    scalarBindings: [],
    dateCreated: now,
    dateModified: now,
  };

  const argumentSet: StoredArgumentSet = {
    id: ARGUMENT_SET_ID,
    name: ARGUMENT_SET_NAME,
    description: null,
    scope: 'queryGroup',
    targetId: GROUP_ID,
    libraryId: LIBRARY_ID,
    currentVersionId: ARGUMENT_SET_VERSION_ID,
    currentVersion: argumentSetVersion,
    tupleBindings: argumentSetVersion.tupleBindings,
    scalarBindings: argumentSetVersion.scalarBindings,
    dateCreated: now,
    dateModified: now,
  };

  const foreignVersion: StoredArgumentSetVersion = {
    id: `${FOREIGN_ARGUMENT_SET_ID}:v1`,
    isPartOf: FOREIGN_ARGUMENT_SET_ID,
    version: 1,
    tupleBindings: [
      {
        id: `${FOREIGN_ARGUMENT_SET_ID}:binding:1`,
        tupleSignature: 'city',
        variables: ['city'],
        rows: [
          {
            id: `${FOREIGN_ARGUMENT_SET_ID}:binding:1:row:0`,
            position: 0,
            values: { city: { type: 'uri', value: ARGUMENT_SET_CITY } },
          },
        ],
      },
    ],
    scalarBindings: [],
    dateCreated: now,
    dateModified: now,
  };

  const foreignArgumentSet: StoredArgumentSet = {
    id: FOREIGN_ARGUMENT_SET_ID,
    name: FOREIGN_ARGUMENT_SET_NAME,
    description: null,
    scope: 'query',
    targetId: EXISTING_QUERY_ID,
    libraryId: LIBRARY_ID,
    currentVersionId: foreignVersion.id,
    currentVersion: foreignVersion,
    tupleBindings: foreignVersion.tupleBindings,
    scalarBindings: foreignVersion.scalarBindings,
    dateCreated: now,
    dateModified: now,
  };

  return {
    backends,
    libraries,
    queries,
    queryVersions,
    queryGroups,
    argumentSets: [argumentSet, foreignArgumentSet],
    argumentSetVersions: {
      [ARGUMENT_SET_ID]: [argumentSetVersion],
      [FOREIGN_ARGUMENT_SET_ID]: [foreignVersion],
    },
    nextArgumentSetVersion: {
      [ARGUMENT_SET_ID]: 2,
      [FOREIGN_ARGUMENT_SET_ID]: 2,
    },
    queryGroupVersions: {
      [GROUP_ID]: [queryGroupVersionSummary],
    },
    queryGroupExpanded: {
      [GROUP_ID]: {
        1: expanded,
      },
    },
    nextQueryVersion: {
      [EXISTING_QUERY_ID]: 2,
      [UPDATE_QUERY_ID]: 2,
    },
    nextQueryGroupVersion: {
      [GROUP_ID]: 2,
    },
    ruleSets,
    ruleSetVersions,
  };
};

/**
 * The names the canvas labels an entity with, keyed by the version IRI it
 * stores — what `GET /query-groups/:id/v/:n` returns as its `iriMap`.
 *
 * Both kinds belong in it: a QueryNode names a query version and a RuleSetNode
 * names a rule set version, and the inspector reads both out of this one map.
 */
export const buildIriMap = (state: MockState): Record<string, string> => {
  const map: Record<string, string> = {};
  for (const [queryId, versions] of Object.entries(state.queryVersions)) {
    const query = state.queries.find((entry) => entry.id === queryId);
    if (!query) continue;
    for (const version of versions) {
      map[version.id] = query.name;
    }
  }
  for (const [ruleSetId, versions] of Object.entries(state.ruleSetVersions)) {
    const ruleSet = state.ruleSets.find((entry) => entry.id === ruleSetId);
    if (!ruleSet) continue;
    for (const version of versions) {
      map[version.id] = ruleSet.name;
    }
  }
  return map;
};

export const SELECT_SIMPLE_QUERY = 'SELECT ?city WHERE { ?city wdt:P31 wd:Q515 } LIMIT 3';

/**
 * The create payload as this mock reads it.
 *
 * Deliberately looser than `queryGroupVersionForGroupCreateSchema`: a mock that
 * only compiles against a well-formed draft cannot be handed a malformed one to
 * see what it does with it, and the arrays it merely passes through are echoed
 * rather than inspected.
 */
type DraftRecord = Record<string, unknown>;
export type VersionCreateDraft = {
  queryGroupVersion?: { canvasData?: string | null; comment?: string | null } | null;
  startNode?: { outputs?: string[] } | null;
  endNode?: { inputs?: string[]; mediaType?: string | null } | null;
  executionNodes?: DraftRecord[];
  edges?: DraftRecord[];
  tupleMembers?: unknown[];
  inputTuples?: unknown[];
  outputTuples?: unknown[];
  inputs?: unknown[];
  outputs?: unknown[];
  rdfOutputs?: unknown[];
  booleanOutputs?: unknown[];
  queryIdInputs?: DraftRecord[];
};

const asString = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);
const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

/**
 * What `/execute` puts on the wire for a fixture, given what the run asked for.
 *
 * Lives here for the same reason `buildVersionCreateResponse` does — so item 3's
 * guard can replay it — and for a second: it is the mock's answer to a request
 * the server has only one legal answer to.
 *
 * With `nodeDetail` set, `packages/api/src/routes/execute.ts` *always* replies
 * `application/json` carrying `{ result, nodes, resultContentType }`, whatever
 * the result's own type. The query group screen sends `nodeDetail: 'results'` on
 * every run, so an unwrapped SPARQL JSON body — what this mock used to answer
 * with — is a response no server can produce for the request the client makes,
 * and it left the whole per-node path (node status, timings, counts) unreachable
 * from a spec.
 *
 * A failed run is not wrapped: the error body has its own shape, with
 * `failedNodeId` and `nodes` at the top level.
 */
export function wrapExecutionResponse(
  fixture: ExecutionResponseFixture,
  options: { nodeDetail: boolean },
): { status: number; contentType: string; body: string } {
  const status = fixture.status ?? 200;
  const resultContentType = fixture.contentType ?? 'application/sparql-results+json';
  const stringify = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value));

  if (!options.nodeDetail || status >= 400) {
    return { status, contentType: resultContentType, body: stringify(fixture.body) };
  }

  return {
    status,
    contentType: 'application/json',
    // `result` keeps the fixture's own shape: a string for RDF, an object for
    // bindings — the discriminator the client reads it back by.
    body: JSON.stringify({
      result: fixture.body,
      nodes: fixture.nodes ?? [],
      resultContentType,
    }),
  };
}

/**
 * What `POST /query-groups/:id/v` answers, built from the draft it was sent.
 *
 * Lives here rather than in the route handler so `test/lib/mockApiContract.test.ts`
 * can replay it: the create response is the half of the mock a spec cannot
 * inspect (the canvas either reloads from it or silently does not), and it is
 * the half most likely to drift, because it has to turn *drafts* into
 * *entities* the way the server does. Replaying `createMockState` through the
 * contracts schemas — item 3's guard — never sees this code at all.
 */
export function buildVersionCreateResponse(
  payload: VersionCreateDraft,
  context: {
    groupId: string;
    versionId: string;
    versionNumber: number;
    now: string;
    /**
     * The store's query versions, so the response can carry the ones its nodes
     * name — as `MockState.queryVersions` holds them.
     *
     * Optional only so a caller testing the draft-to-entity work above need not
     * hand over a store; a response built without it describes no query
     * version, which is a group the canvas marks broken.
     */
    queryVersions?: Record<string, StoredQueryVersion[]>;
  },
): QueryGroupVersionExpanded {
  const { groupId, versionId, versionNumber, now } = context;

  const resolveNodeId = (value?: string | null) => {
    if (!value) {
      return null;
    }
    if (value === 'urn:__START__') {
      return START_NODE_ID;
    }
    if (value === 'urn:__END__') {
      return END_NODE_ID;
    }
    return value;
  };

  const executionNodes = (payload.executionNodes ?? []).map((node, index) => {
    const common = {
      id: asString(node.id) ?? `${groupId}:node:${versionNumber}:${index}`,
      inputs: asStringArray(node.inputs),
      outputs: asStringArray(node.outputs),
      dateCreated: now,
      dateModified: now,
    };
    /*
     * A rule set node is its own shape, and coercing every node to
     * QueryNode/DynamicQueryNode here meant a saved RuleSetNode came back as a
     * query node with no query — the canvas redrew it as a broken query node on
     * reload, and no spec could see the difference because the mock was the one
     * losing it. `ruleSetVersion` is the wire name the client sends and the
     * response shape requires.
     */
    if (node.nodeType === 'RuleSetNode') {
      return {
        ...common,
        nodeType: 'RuleSetNode',
        ruleSetVersion: asString(node.ruleSetVersion) ?? asString(node.ruleSetVersionId),
      };
    }
    /*
     * A patch node is the same gap as the rule set one above, with a worse
     * consequence: coerced to a QueryNode it comes back as a node that *runs*
     * the update it only derives, and the two halves it names are gone, so the
     * reloaded canvas has a node whose edges leave by ports it no longer
     * declares. The real writer refuses that carry-over outright; a mock that
     * performs it is answering with a response no server can produce.
     */
    if (node.nodeType === 'PatchNode') {
      return {
        ...common,
        nodeType: 'PatchNode',
        queryId: asString(node.queryId),
        backendId: asString(node.backendId),
        backendConfig: null,
        deletionsOutput: asString(node.deletionsOutput),
        additionsOutput: asString(node.additionsOutput),
      };
    }
    return {
      ...common,
      queryId: asString(node.queryId),
      backendId: asString(node.backendId),
      backendConfig: null,
      nodeType: node.nodeType === 'DynamicQueryNode' ? 'DynamicQueryNode' : 'QueryNode',
    };
  });

  const edges = (payload.edges ?? []).map((edge, index) => ({
    id: asString(edge.id) ?? `${groupId}:edge:${versionNumber}:${index}`,
    sourceNodeId: resolveNodeId(asString(edge.sourceNodeId)) ?? START_NODE_ID,
    targetNodeId: resolveNodeId(asString(edge.targetNodeId)) ?? END_NODE_ID,
    dataFlowType: asString(edge.dataFlowType) ?? 'CONTROL_FLOW',
    sourceOutputId: asString(edge.sourceOutputId),
    targetInputId: asString(edge.targetInputId),
    /*
     * Both are persisted by QueryEdgeSchema and both were dropped here,
     * which made this mock quietly stricter than the API: an edge saved
     * with an empty-input policy or a variable mapping came back without
     * one, so a spec could only ever see the value it had just typed — the
     * same class of gap as the `whenEmpty` hole the draft schema carried.
     */
    whenEmpty: asString(edge.whenEmpty),
    variableMappings: asString(edge.variableMappings),
  }));

  /*
   * `QueryIdInput.isPartOf` is required on the way out and absent on the way in:
   * the flat create shape strips it, so `GroupVersionWriter` derives the owner
   * from whichever execution node declares the port. Echoing the draft back
   * unchanged — as this did — produced a response no real server can produce and
   * the client's own schema refuses, so saving a group with a dynamic query
   * node's Query ID input failed at the parse with the version left unchanged.
   */
  const queryIdInputs = (payload.queryIdInputs ?? []).map((input) => {
    const id = asString(input.id);
    const owner = executionNodes.find((node) => id !== null && node.inputs.includes(id));
    return {
      id,
      name: asString(input.name),
      description: asString(input.description),
      isPartOf: asString(input.isPartOf) ?? owner?.id ?? null,
      dateCreated: now,
      dateModified: now,
    };
  });

  /*
   * The same closure the GET carries, because the same code builds both: the
   * create route answers with `expandGroupVersionDetailed(created)`
   * (`packages/api/src/routes/query-groups.ts`), so a response that dropped the
   * query versions would be one no server sends. It is not cosmetic — the
   * canvas re-reads the version it has just written, so a create response
   * without them turns a healthy group red on every save.
   */
  const referencedVersionIds = new Set(
    executionNodes
      .map((node) => (node as { queryId?: string | null }).queryId)
      .filter((id): id is string => typeof id === 'string' && !!id),
  );
  const queryVersions = Object.values(context.queryVersions ?? {})
    .flat()
    .filter((version) => referencedVersionIds.has(version.id));

  const summary: QueryGroupVersion = {
    id: versionId,
    version: versionNumber,
    startNode: START_NODE_ID,
    endNode: END_NODE_ID,
    executionNodes: executionNodes.map((node) => node.id),
    edges: edges.map((edge) => edge.id),
    canvasData: payload.queryGroupVersion?.canvasData ?? null,
    comment: payload.queryGroupVersion?.comment ?? null,
    dateCreated: now,
    dateModified: now,
    isPartOf: groupId,
  };

  return {
    queryGroupVersion: summary,
    startNode: {
      id: START_NODE_ID,
      outputs: payload.startNode?.outputs ?? [START_CONTROL_PORT, START_TUPLE_PORT],
      dateCreated: now,
      dateModified: now,
    },
    endNode: {
      id: END_NODE_ID,
      inputs: payload.endNode?.inputs ?? [NODE_OUTPUT_PORT],
      mediaType: payload.endNode?.mediaType ?? 'application/sparql-results+json',
      dateCreated: now,
      dateModified: now,
    },
    executionNodes,
    edges,
    tupleMembers: payload.tupleMembers ?? [],
    inputTuples: payload.inputTuples ?? [],
    outputTuples: payload.outputTuples ?? [],
    inputs: payload.inputs ?? [],
    outputs: payload.outputs ?? [],
    rdfOutputs: payload.rdfOutputs ?? [],
    booleanOutputs: payload.booleanOutputs ?? [],
    queryIdInputs,
    queryVersions,
  } as QueryGroupVersionExpanded;
}
