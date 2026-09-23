/**
 * Read-only entity fixtures for specs that need the app populated.
 *
 * The visual regression suite used to mock every collection as empty, so the
 * only screens it could baseline were the ones that render without entities —
 * playgrounds, settings, an empty sidebar. That is exactly why the badge pass
 * went green over a blind spot: no baselined screen rendered a badge.
 *
 * These fixtures give every work area something to render: a query with a
 * version, a rule, a rule set with a stratification report, a query group with
 * a three-node canvas, and a benchmark experiment with a finished run.
 *
 * Everything here is FROZEN — fixed IRIs, fixed ISO dates, fixed counts — so a
 * screenshot taken today matches one taken next month. Nothing calls
 * `Date.now()`. If you add a fixture, keep it that way.
 *
 * The router is GET-only apart from the three execute endpoints; these specs
 * never mutate. For write-path coverage use `query-group-test-helpers.ts`,
 * which keeps mutable state.
 */
import type { Page, Route } from '@playwright/test';
import { API_ORIGIN } from '../api-origin';

/**
 * Where the app sends API traffic — must match `runtimeConfig.public.apiBaseUrl`
 * in the build under test. Everything on this origin is answered from fixtures;
 * everything else (the app's own HTML, JS and fonts) is passed through.
 */

const CREATED = '2026-01-01T00:00:00Z';
const MODIFIED = '2026-01-02T00:00:00Z';

export const LIBRARY = {
  id: 'urn:sqlib:library:visual',
  name: 'Visual Library',
  description: 'Fixture library for visual regression',
  defaultBackend: 'urn:sqlib:backend:visual',
  dateCreated: CREATED,
  dateModified: MODIFIED,
};

export const BACKEND = {
  id: 'urn:sqlib:backend:visual',
  name: 'Visual Backend',
  description: 'HTTP SPARQL backend',
  backendType: 'http',
  endpoint: 'http://localhost:7878/sparql',
  authEnvKey: null,
  oxigraphConfig: null,
  dateCreated: CREATED,
  dateModified: MODIFIED,
};

// --- Query -----------------------------------------------------------------

export const QUERY = {
  id: 'urn:sqlib:query:visual',
  name: 'Countries By Population',
  description: 'Fixture query with one saved version',
  defaultBackend: BACKEND.id,
  currentVersion: 'urn:sqlib:query-version:visual-v1',
  // Projected by the server from the version it points at. The IRI's `-v1`
  // suffix is incidental — real ones are `urn:sqlib:query-version:<uuid>` and
  // carry no number, which is why the number is sent rather than parsed.
  currentVersionNumber: 1,
  isPartOf: [LIBRARY.id],
  dateCreated: CREATED,
  dateModified: MODIFIED,
};

const QUERY_STRING = `PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX wd: <http://www.wikidata.org/entity/>

SELECT ?country ?population WHERE {
  ?country wdt:P31 wd:Q6256 ;
           wdt:P1082 ?population .
}
ORDER BY DESC(?population)
LIMIT 10`;

export const QUERY_VERSION = {
  id: QUERY.currentVersion,
  version: 1,
  queryString: QUERY_STRING,
  comment: 'Initial version',
  isPartOf: QUERY.id,
  // The IRI the server stores and returns. It read 'SELECT' until the leaf's
  // queryType was projected from the entity model, which types it ldkit.IRI —
  // the fixture had been describing a shape the API never sends.
  queryType: 'https://sparql-query-lib/query-type/select',
  defaultBackend: BACKEND.id,
  limitParameters: null,
  offsetParameters: null,
  inferredInputs: null,
  inferredOutputs: null,
  dateCreated: CREATED,
  dateModified: MODIFIED,
};

export const QUERY_VERSION_EXPANDED = {
  queryVersion: QUERY_VERSION,
  limitParameters: [],
  offsetParameters: [],
  inputs: [],
  outputs: [],
  inputTuples: [],
  outputTuples: [],
  tupleMembers: [],
};

/** Two rows, mixed term types — exercises the RDF term colouring in results. */
export const QUERY_RESULTS = {
  head: { vars: ['country', 'population'] },
  results: {
    bindings: [
      {
        country: { type: 'uri', value: 'http://www.wikidata.org/entity/Q148' },
        population: { type: 'literal', value: '1411778724', datatype: 'http://www.w3.org/2001/XMLSchema#integer' },
      },
      {
        country: { type: 'uri', value: 'http://www.wikidata.org/entity/Q668' },
        population: { type: 'literal', value: '1380004385', datatype: 'http://www.w3.org/2001/XMLSchema#integer' },
      },
    ],
  },
};

// --- Rule and data block ---------------------------------------------------

const RULE_SET_ID = 'urn:sqlib:rule-set:visual';

/*
 * Rules and data blocks are validated against two different strict schemas:
 * the list endpoints use the generated `ruleSchema` / `dataBlockSchema`
 * (`rulesetMembership`, no `comment`), while the expanded rule-set version
 * inlines its own shape (`comment`, no `rulesetMembership`). Strict means a
 * stray key is a hard parse error, so each form is spelled out separately
 * rather than reused — see `contracts/src/generated/{rule,datablock}.ts` and
 * `ruleset-version.ts`.
 */
export const RULE = {
  id: 'urn:sqlib:rule:visual',
  name: 'Ancestor Closure',
  description: 'Fixture rule with one saved version',
  currentVersion: 'urn:sqlib:rule-version:visual-v1',
  isPartOf: [LIBRARY.id],
  rulesetMembership: [RULE_SET_ID],
  dateCreated: CREATED,
  dateModified: MODIFIED,
};

/** Same rule, in the shape the expanded rule-set version expects. */
const RULE_EXPANDED_FORM = {
  id: RULE.id,
  name: RULE.name,
  description: RULE.description,
  currentVersion: RULE.currentVersion,
  isPartOf: RULE.isPartOf,
  dateCreated: CREATED,
  dateModified: MODIFIED,
};

export const RULE_VERSION = {
  id: RULE.currentVersion,
  isPartOf: RULE.id,
  version: 1,
  immutable: false,
  comment: 'Initial version',
  ruleString: `PREFIX : <http://example.org/>

RULE :ancestorClosure {
  ?x :ancestorOf ?z
} WHERE {
  ?x :parentOf ?y .
  ?y :ancestorOf ?z .
}`,
  normalizedInsert: `PREFIX : <http://example.org/>

INSERT { ?x :ancestorOf ?z }
WHERE { ?x :parentOf ?y . ?y :ancestorOf ?z }`,
  grammarType: 'srl',
  grammarValid: true,
  validationError: null,
  grammarValidations: null,
  dateCreated: CREATED,
  dateModified: MODIFIED,
};

export const DATA_BLOCK = {
  id: 'urn:sqlib:data-block:visual',
  name: 'Family Seed Data',
  description: 'Fixture data block',
  currentVersion: 'urn:sqlib:data-block-version:visual-v1',
  isPartOf: [LIBRARY.id],
  rulesetMembership: [RULE_SET_ID],
  dateCreated: CREATED,
  dateModified: MODIFIED,
};

/** Same data block, in the shape the expanded rule-set version expects. */
const DATA_BLOCK_EXPANDED_FORM = {
  id: DATA_BLOCK.id,
  name: DATA_BLOCK.name,
  description: DATA_BLOCK.description,
  currentVersion: DATA_BLOCK.currentVersion,
  isPartOf: DATA_BLOCK.isPartOf,
  dateCreated: CREATED,
  dateModified: MODIFIED,
};

export const DATA_BLOCK_VERSION = {
  id: DATA_BLOCK.currentVersion,
  isPartOf: DATA_BLOCK.id,
  version: 1,
  immutable: false,
  comment: 'Initial version',
  dataString: `PREFIX : <http://example.org/>

DATA {
  :alice :parentOf :bob .
  :bob :parentOf :carol .
}`,
  normalizedInsertData: null,
  grammarType: 'srl',
  grammarValid: true,
  validationError: null,
  grammarValidations: null,
  dateCreated: CREATED,
  dateModified: MODIFIED,
};

// --- Rule set --------------------------------------------------------------

export const RULE_SET = {
  id: RULE_SET_ID,
  name: 'Family Closure Rules',
  description: 'Fixture rule set with one rule and one data block',
  currentVersion: 'urn:sqlib:rule-set-version:visual-v1',
  isPartOf: [LIBRARY.id],
  rules: [RULE.id],
  dataBlocks: [DATA_BLOCK.id],
  dateCreated: CREATED,
  dateModified: MODIFIED,
};

export const RULE_SET_VERSION = {
  id: RULE_SET.currentVersion,
  isPartOf: RULE_SET.id,
  version: 1,
  immutable: false,
  comment: 'Initial version',
  hasRule: [RULE_VERSION.id],
  hasDataBlock: [DATA_BLOCK_VERSION.id],
  stratificationReport: JSON.stringify({
    stratifiable: true,
    strata: [{ index: 0, rules: [RULE_VERSION.id] }],
  }),
  dateCreated: CREATED,
  dateModified: MODIFIED,
};

export const RULE_SET_VERSION_EXPANDED = {
  ruleSetVersion: RULE_SET_VERSION,
  rules: [{ ruleVersion: RULE_VERSION, rule: RULE_EXPANDED_FORM }],
  dataBlocks: [{ dataBlockVersion: DATA_BLOCK_VERSION, dataBlock: DATA_BLOCK_EXPANDED_FORM }],
};

const QUAD = '<http://example.org/alice> <http://example.org/ancestorOf> <http://example.org/carol> .';

/** A converged two-iteration run — enough to render every results sub-panel. */
export const RULE_SET_EXECUTION = {
  status: 'converged',
  iterations: [
    {
      index: 0,
      signature: 'sig-0',
      tripleCount: 3,
      delta: 1,
      rules: [
        {
          ruleVersionId: RULE_VERSION.id,
          programSource: 'normalized',
          durationMs: 12,
          triplesInserted: 1,
          triplesDeleted: 0,
          quadSamples: [QUAD],
          insertedQuads: [QUAD],
          deletedQuads: [],
          timedOut: false,
        },
      ],
    },
    {
      index: 1,
      signature: 'sig-1',
      tripleCount: 3,
      delta: 0,
      rules: [
        {
          ruleVersionId: RULE_VERSION.id,
          programSource: 'normalized',
          durationMs: 8,
          triplesInserted: 0,
          triplesDeleted: 0,
          quadSamples: [],
          insertedQuads: [],
          deletedQuads: [],
          timedOut: false,
        },
      ],
    },
  ],
  dataBlocks: [
    {
      dataBlockVersionId: DATA_BLOCK_VERSION.id,
      programSource: 'normalized',
      durationMs: 4,
      tripleDelta: 2,
    },
  ],
  finalGraphNQuads: `<http://example.org/alice> <http://example.org/parentOf> <http://example.org/bob> .
<http://example.org/bob> <http://example.org/parentOf> <http://example.org/carol> .
${QUAD}`,
  cycle: null,
  maxIterations: null,
};

// --- Query group -----------------------------------------------------------

const GROUP_ID = 'urn:sqlib:query-group:visual';
const START_NODE = 'urn:sqlib:startnode:visual';
const END_NODE = 'urn:sqlib:endnode:visual';
const QUERY_NODE = 'urn:sqlib:node:visual';
const START_CONTROL_PORT = 'urn:sqlib:control-output:visual-start';
/*
 * A QueryInputTuple, because what the Start node *saves* is the group's inputs:
 * `legalSourcePortKinds` refuses a QueryOutputTuple as the source of a
 * VARIABLE_BINDINGS edge leaving Start. Declared as an output tuple, as it was
 * until now, this fixture described a group the canvas marks broken on sight —
 * and this is the fixture the `query-group-canvas` baselines are taken from.
 */
const START_TUPLE_PORT = 'urn:sqlib:input-tuple:visual-start';
const NODE_INPUT_PORT = 'urn:sqlib:input-tuple:visual-params';
const NODE_OUTPUT_PORT = 'urn:sqlib:triples-quads:visual-rdf';

export const QUERY_GROUP = {
  id: GROUP_ID,
  name: 'Country Enrichment Flow',
  description: 'Fixture group: start → query node → end',
  isPartOf: LIBRARY.id,
  currentVersion: `${GROUP_ID}:v1`,
  dateCreated: CREATED,
  dateModified: MODIFIED,
};

export const QUERY_GROUP_VERSION = {
  id: QUERY_GROUP.currentVersion,
  version: 1,
  startNode: START_NODE,
  endNode: END_NODE,
  executionNodes: [QUERY_NODE],
  edges: ['urn:sqlib:edge:visual-control', 'urn:sqlib:edge:visual-data', 'urn:sqlib:edge:visual-rdf'],
  // Fixed coordinates, so the canvas does not re-layout differently per run.
  canvasData: JSON.stringify({
    nodes: [
      { id: START_NODE, position: { x: 40, y: 160 } },
      { id: QUERY_NODE, position: { x: 360, y: 140 } },
      { id: END_NODE, position: { x: 700, y: 160 } },
    ],
  }),
  comment: 'Initial layout',
  dateCreated: CREATED,
  dateModified: MODIFIED,
  isPartOf: GROUP_ID,
};

export const QUERY_GROUP_VERSION_EXPANDED = {
  queryGroupVersion: QUERY_GROUP_VERSION,
  startNode: {
    id: START_NODE,
    outputs: [START_CONTROL_PORT, START_TUPLE_PORT],
    dateCreated: CREATED,
    dateModified: MODIFIED,
  },
  endNode: {
    id: END_NODE,
    inputs: [NODE_OUTPUT_PORT],
    mediaType: 'application/sparql-results+json',
    dateCreated: CREATED,
    dateModified: MODIFIED,
  },
  executionNodes: [
    {
      id: QUERY_NODE,
      inputs: [NODE_INPUT_PORT],
      outputs: [NODE_OUTPUT_PORT],
      queryId: QUERY_VERSION.id,
      backendId: BACKEND.id,
      backendConfig: null,
      nodeType: 'QueryNode',
      dateCreated: CREATED,
      dateModified: MODIFIED,
    },
  ],
  edges: [
    {
      id: 'urn:sqlib:edge:visual-control',
      sourceNodeId: START_NODE,
      targetNodeId: QUERY_NODE,
      dataFlowType: 'CONTROL_FLOW',
      // Control flow orders execution and carries no data, so it takes no
      // endpoint ports. The anchor stays on the node for the canvas to draw a
      // handle from; the edge does not name it.
      sourceOutputId: null,
      targetInputId: null,
    },
    {
      id: 'urn:sqlib:edge:visual-data',
      sourceNodeId: START_NODE,
      targetNodeId: QUERY_NODE,
      dataFlowType: 'VARIABLE_BINDINGS',
      sourceOutputId: START_TUPLE_PORT,
      targetInputId: NODE_INPUT_PORT,
    },
    {
      id: 'urn:sqlib:edge:visual-rdf',
      sourceNodeId: QUERY_NODE,
      targetNodeId: END_NODE,
      dataFlowType: 'RDF_GRAPH',
      sourceOutputId: NODE_OUTPUT_PORT,
      targetInputId: NODE_OUTPUT_PORT,
    },
  ],
  tupleMembers: [],
  inputTuples: [
    { id: NODE_INPUT_PORT, name: 'Country Params', memberEntries: [] },
    { id: START_TUPLE_PORT, name: 'Start Params', memberEntries: [] },
  ],
  outputTuples: [],
  inputs: [],
  outputs: [],
  rdfOutputs: [
    {
      id: NODE_OUTPUT_PORT,
      name: 'Country RDF',
      description: 'Fixture RDF output',
      ioType: 'output',
      outputType: 'RDF_GRAPH',
      triplesOrQuads: null,
      specifiedGraph: null,
      dateCreated: CREATED,
      dateModified: MODIFIED,
    },
  ],
  booleanOutputs: [],
  queryIdInputs: [],
  /*
   * The version the node names, without which it carries a blocking "the saved
   * group did not describe this query version" — the error ring and validation
   * badge that have been in the `query-group-canvas` baselines all along.
   *
   * `inferredInputs` alone: the query declares the tuple it is parameterised
   * by, and this one is a SELECT (`queryType` above), so claiming the node's
   * RDF port as its inferred output would trade one untruth for another. That
   * port is the group's, which is what a port left out of the version's
   * interface means.
   */
  queryVersions: [{ ...QUERY_VERSION, inferredInputs: [NODE_INPUT_PORT] }],
};

// --- Benchmarks ------------------------------------------------------------

export const BENCHMARK_EXPERIMENT = {
  id: 'urn:sqlib:benchmark:visual',
  name: 'Country Query Benchmark',
  description: 'Fixture experiment with one completed run',
  status: 'ready',
  currentVersion: 'urn:sqlib:benchmark-version:visual-v1',
  dateCreated: CREATED,
  dateModified: MODIFIED,
};

export const BENCHMARK_VERSION = {
  id: BENCHMARK_EXPERIMENT.currentVersion,
  isPartOf: BENCHMARK_EXPERIMENT.id,
  version: 1,
  immutable: true,
  subjectSpecs: [{ subject: QUERY.id, inputs: [], backends: [BACKEND.id] }],
  repeats: 3,
  executionStrategy: 'sequential',
  timeWindow: null,
  maxConcurrency: 1,
  warmupRuns: 1,
  cooldownMs: 0,
  timeoutMs: 30000,
  retryCount: 0,
  retryDelayMs: 0,
  randomizeOrder: false,
  abortOnError: false,
  dateCreated: CREATED,
  dateModified: MODIFIED,
};

export const BENCHMARK_RUN = {
  id: 'urn:sqlib:benchmark-run:visual',
  // What the runner stamps on every run it writes: the data structure
  // definition its observations are shaped by (`BenchmarkRunner.ts`).
  structure: 'https://sparql-query-lib/BenchmarkObservationDSD',
  definedBy: BENCHMARK_VERSION.id,
  runStatus: 'completed',
  tasksTotal: 3,
  tasksCompleted: 3,
  keywords: ['fixture'],
  startedAt: '2026-01-02T10:00:00Z',
  endedAt: '2026-01-02T10:00:12Z',
  dateCreated: MODIFIED,
  dateModified: MODIFIED,
};

export const BENCHMARK_OBSERVATIONS = [0, 1, 2].map((runIndex) => ({
  id: `urn:sqlib:benchmark-observation:visual-${runIndex}`,
  dataSet: BENCHMARK_RUN.id,
  subject: QUERY.id,
  backend: BACKEND.id,
  argumentSet: 'urn:sqlib:argument-set:visual',
  runIndex,
  durationMs: 120 + runIndex * 15,
  resultCount: 10,
  success: true,
  errorMessage: null,
  errorType: null,
  backendDurationMs: 100 + runIndex * 12,
  queueDelayMs: 2,
  timestamp: `2026-01-02T10:00:0${runIndex + 1}Z`,
}));

// --- Router ----------------------------------------------------------------

type Handler = (route: Route) => unknown;

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

/**
 * Route table, matched in order against the URL path. First match wins, so
 * the more specific patterns come first.
 */
const ROUTES: Array<[RegExp, Handler]> = [
  // Queries
  [/\/queries\/[^/]+\/v\/\d+$/, (r) => json(r, QUERY_VERSION_EXPANDED)],
  [/\/queries\/[^/]+\/v$/, (r) => json(r, [QUERY_VERSION])],
  [/\/queries\/[^/]+$/, (r) => json(r, QUERY)],
  [/\/queries$/, (r) => json(r, [QUERY])],

  // Query groups
  [/\/query-groups\/[^/]+\/v\/\d+\/validate$/, (r) => json(r, { valid: true, errors: [], warnings: [] })],
  [/\/query-groups\/[^/]+\/v\/\d+$/, (r) => json(r, QUERY_GROUP_VERSION_EXPANDED)],
  [/\/query-groups\/[^/]+\/v$/, (r) => json(r, [QUERY_GROUP_VERSION])],
  [/\/query-groups\/[^/]+$/, (r) => json(r, QUERY_GROUP)],
  [/\/query-groups$/, (r) => json(r, [QUERY_GROUP])],

  // Rules and data blocks
  [/\/rules\/[^/]+\/versions\/\d+$/, (r) => json(r, RULE_VERSION)],
  [/\/rules\/[^/]+\/versions$/, (r) => json(r, [RULE_VERSION])],
  [/\/rules\/[^/]+$/, (r) => json(r, RULE)],
  [/\/rules$/, (r) => json(r, [RULE])],
  [/\/data-blocks\/[^/]+\/versions\/\d+$/, (r) => json(r, DATA_BLOCK_VERSION)],
  [/\/data-blocks\/[^/]+\/versions$/, (r) => json(r, [DATA_BLOCK_VERSION])],
  [/\/data-blocks\/[^/]+$/, (r) => json(r, DATA_BLOCK)],
  [/\/data-blocks$/, (r) => json(r, [DATA_BLOCK])],

  // Rule sets
  [/\/rule-sets\/[^/]+\/execute$/, (r) => json(r, RULE_SET_EXECUTION)],
  [/\/rule-sets\/[^/]+\/versions\/\d+$/, (r) => json(r, RULE_SET_VERSION_EXPANDED)],
  [/\/rule-sets\/[^/]+\/versions$/, (r) => json(r, [RULE_SET_VERSION])],
  [/\/rule-sets\/[^/]+\/srl$/, (r) => json(r, {
    srl: 'PREFIX : <http://example/>\n\nRULE { ?a :ancestor ?b } WHERE { ?a :parent ?b }\n',
    ruleCount: 1,
    dataBlockCount: 0,
    tupleSeeds: '',
    tuplesEnabled: false,
    warnings: [],
  })],
  [/\/rule-sets\/[^/]+$/, (r) => json(r, RULE_SET)],
  [/\/rule-sets$/, (r) => json(r, [RULE_SET])],

  // Benchmarks
  [/\/benchmark-experiments\/runs\/[^/]+\/node-observations$/, (r) => json(r, [])],
  /*
   * Empty because the fixture's benchmark is a query: passes belong to a rules
   * request, and answering with rows the run could not have produced would put
   * a Passes column on a screen no rule set reached. Routed explicitly rather
   * than left to the empty-array default, so the shape is stated where the
   * other two observation routes are.
   */
  [/\/benchmark-experiments\/runs\/[^/]+\/iteration-observations$/, (r) => json(r, [])],
  [/\/benchmark-experiments\/runs\/[^/]+\/observations$/, (r) => json(r, BENCHMARK_OBSERVATIONS)],
  [/\/benchmark-experiments\/runs\/[^/]+$/, (r) => json(r, BENCHMARK_RUN)],
  [/\/benchmark-experiments\/[^/]+\/v\/\d+\/runs$/, (r) => json(r, [BENCHMARK_RUN])],
  [/\/benchmark-experiments\/[^/]+\/v\/\d+$/, (r) => json(r, BENCHMARK_VERSION)],
  [/\/benchmark-experiments\/[^/]+\/v$/, (r) => json(r, [BENCHMARK_VERSION])],
  [/\/benchmark-experiments\/[^/]+$/, (r) => json(r, BENCHMARK_EXPERIMENT)],
  [/\/benchmark-experiments$/, (r) => json(r, [BENCHMARK_EXPERIMENT])],

  // Core entities
  [/\/libraries\/[^/]+$/, (r) => json(r, LIBRARY)],
  [/\/libraries$/, (r) => json(r, [LIBRARY])],
  /*
   * Health, before the by-id route below: `/backends/probes` matches `[^/]+`
   * too, and answering it with a backend object is a parse error the client
   * logs — which is what the smoke spec's "no console errors" check catches.
   * Empty because nothing here has been probed: `never_probed` is a real state
   * and the one a fixture deployment is in.
   */
  [/\/backends\/probes$/, (r) => json(r, { probes: [] })],
  [/\/backends\/[^/]+\/references$/, (r) => json(r, { libraries: [], queries: [], queryGroups: [] })],
  [/\/backends\/[^/]+$/, (r) => json(r, BACKEND)],
  [/\/backends$/, (r) => json(r, [BACKEND])],

  // Execution
  [/\/(sparql|execute)$/, (r) => json(r, QUERY_RESULTS)],
  [/\/argument-sets/, (r) => json(r, [])],

  /*
   * Validation and detection. These respond with objects, and the client
   * parses them with strict schemas — the empty-array default below would be
   * a parse error, which surfaces as an error toast in the screenshot.
   */
  [/\/validate-rule-data$/, (r) => json(r, { valid: true, normalized: RULE_VERSION.normalizedInsert })],
  [/\/validate$/, (r) => json(r, { valid: true })],
  [/\/detect-inputs$/, (r) => json(r, { valuesInputs: [], limitParameters: [], offsetParameters: [] })],
  [/\/detect-outputs$/, (r) => json(r, ['country', 'population'])],
  [/\/format$/, (r) => json(r, { formatted: QUERY_STRING })],
];

export type MockOptions = {
  /** Extra routes, matched before the defaults. Same [pattern, handler] shape. */
  extraRoutes?: Array<[RegExp, Handler]>;
};

/**
 * Intercept every API call and answer from the fixtures above.
 *
 * Anything not in the route table gets an empty array with a 200 rather than a
 * connection error, because an unmocked call surfaces as an error toast in the
 * corner of the screenshot and would fail the baseline for the wrong reason.
 */
export async function mockEntityApi(page: Page, options: MockOptions = {}) {
  const routes = [...(options.extraRoutes ?? []), ...ROUTES];

  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    // Let the app's own assets through; only API traffic is mocked.
    if (url.origin !== API_ORIGIN) {
      await route.fallback();
      return;
    }
    const match = routes.find(([pattern]) => pattern.test(url.pathname));
    if (match) {
      await match[1](route);
      return;
    }
    await json(route, []);
  });
}
