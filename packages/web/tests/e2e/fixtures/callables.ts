/**
 * A library with something worth summarising, for the Build screen.
 *
 * `fixtures/entities.ts` gives one query whose expanded version has empty
 * inputs and outputs, which is exactly the case where a signature table looks
 * fine while rendering nothing. These fixtures cover the shapes the Build
 * screen is about: a multi-member VALUES tuple, a LIMIT parameter with a
 * default, an ASK, a CONSTRUCT, a group that composes two nodes, and a query
 * with no arguments at all.
 *
 * Everything is frozen — fixed IRIs, fixed dates — so a run today matches a run
 * next month.
 */
import type { Page, Route } from '@playwright/test';

import { API_ORIGIN } from '../api-origin';

const CREATED = '2026-01-01T00:00:00Z';
const MODIFIED = '2026-01-02T00:00:00Z';
const XSD = 'http://www.w3.org/2001/XMLSchema#';
const TYPE = 'https://sparql-query-lib/query-type/';

export const LIBRARY = {
  id: 'urn:sqlib:library:storefront',
  name: 'Storefront',
  description: 'The read side of a storefront',
  defaultBackend: 'urn:sqlib:backend:storefront',
  dateCreated: CREATED,
  dateModified: MODIFIED,
};

export const OTHER_LIBRARY = {
  id: 'urn:sqlib:library:warehouse',
  name: 'Warehouse',
  description: 'A second library, so the scope picker has something to pick',
  defaultBackend: null,
  dateCreated: CREATED,
  dateModified: MODIFIED,
};

export const BACKEND = {
  id: 'urn:sqlib:backend:storefront',
  name: 'Storefront GDB',
  description: null,
  backendType: 'http',
  endpoint: 'http://localhost:7878/sparql',
  authEnvKey: null,
  queryMethod: null,
  oxigraphConfig: null,
  dateCreated: CREATED,
  dateModified: MODIFIED,
};

export const RULE_SET = {
  id: 'urn:sqlib:rule-set:pricing',
  name: 'Pricing',
  description: 'Applied by the storefront backend',
  currentVersion: 'urn:sqlib:rule-set-version:pricing-v2',
  isPartOf: [LIBRARY.id],
  rules: ['urn:sqlib:rule:a', 'urn:sqlib:rule:b'],
  dataBlocks: [],
  dateCreated: CREATED,
  dateModified: MODIFIED,
};

interface QuerySpec {
  id: string;
  name: string;
  description: string | null;
  version: number;
  queryType: string;
  /** Tuples of [variableName, datatype IRI or null]. */
  tuples: Array<Array<[string, string | null]>>;
  limits: Array<{ name: string; defaultValue: number | null }>;
  outputs: string[];
}

const QUERY_SPECS: QuerySpec[] = [
  {
    id: 'urn:sqlib:query:product-search',
    name: 'Product search',
    description: 'Full-text over titles and tags',
    version: 2,
    queryType: `${TYPE}select`,
    tuples: [[['term', `${XSD}string`]]],
    limits: [{ name: 'limit', defaultValue: 20 }],
    outputs: ['?product', '?title', '?price'],
  },
  {
    id: 'urn:sqlib:query:stock-check',
    name: 'Is in stock',
    description: 'ASK — cheap pre-checkout gate',
    version: 4,
    queryType: `${TYPE}ask`,
    // Two members in one tuple: a caller supplies product and qty together.
    tuples: [[['product', `${XSD}anyURI`], ['qty', `${XSD}integer`]]],
    limits: [],
    outputs: [],
  },
  {
    id: 'urn:sqlib:query:product-graph',
    name: 'Product graph',
    description: 'CONSTRUCT — product plus related nodes',
    version: 1,
    queryType: `${TYPE}construct`,
    tuples: [[['product', `${XSD}anyURI`]]],
    limits: [],
    outputs: [],
  },
  {
    id: 'urn:sqlib:query:catalogue-facets',
    name: 'Catalogue facets',
    description: 'Counts per category, no args',
    version: 6,
    queryType: `${TYPE}select`,
    tuples: [],
    limits: [],
    outputs: ['?category', '?count'],
  },
];

export const QUERIES = QUERY_SPECS.map((spec) => ({
  id: spec.id,
  name: spec.name,
  description: spec.description,
  // Version IRIs are minted `urn:sqlib:query-version:<uuid>` — the entity's own
  // prefix with a `:vN` suffix is a shape the API never produces. The number
  // travels as `currentVersionNumber`, which is how the real one arrives.
  currentVersion: `urn:sqlib:query-version:${spec.id.split(':').pop()}`,
  currentVersionNumber: spec.version,
  defaultBackend: BACKEND.id,
  isPartOf: [LIBRARY.id],
  dateCreated: CREATED,
  dateModified: MODIFIED,
  argumentSets: null,
}));

function versionFor(spec: QuerySpec) {
  return {
    id: `urn:sqlib:query-version:${spec.id.split(':').pop()}`,
    isPartOf: spec.id,
    version: spec.version,
    immutable: true,
    queryString: 'SELECT * WHERE { ?s ?p ?o }',
    comment: null,
    queryType: spec.queryType,
    limitParameters: null,
    offsetParameters: null,
    inferredInputs: null,
    inferredOutputs: null,
    dateCreated: CREATED,
    dateModified: MODIFIED,
    defaultBackend: BACKEND.id,
  };
}

function expandedFor(spec: QuerySpec) {
  const inputs: unknown[] = [];
  const tupleMembers: unknown[] = [];
  const inputTuples = spec.tuples.map((members, tupleIndex) => {
    const memberEntries = members.map(([name, datatype], memberIndex) => {
      const inputId = `${spec.id}:in:${name}`;
      const memberId = `${spec.id}:tm:${tupleIndex}-${memberIndex}`;
      inputs.push({
        id: inputId,
        variableName: name,
        allowedTypes: datatype ? [datatype] : null,
        dateCreated: CREATED,
        dateModified: MODIFIED,
      });
      tupleMembers.push({
        id: memberId,
        position: memberIndex,
        variable: inputId,
        dateCreated: CREATED,
        dateModified: MODIFIED,
      });
      return memberId;
    });
    return {
      id: `${spec.id}:tuple:${tupleIndex}`,
      name: null,
      memberEntries,
      dateCreated: CREATED,
      dateModified: MODIFIED,
    };
  });

  return {
    queryVersion: versionFor(spec),
    limitParameters: spec.limits.map((limit) => ({
      id: `${spec.id}:limit:${limit.name}`,
      name: limit.name,
      value: null,
      defaultValue: limit.defaultValue,
      dateCreated: CREATED,
      dateModified: MODIFIED,
    })),
    offsetParameters: [],
    inputs,
    outputs: spec.outputs.map((variableName) => ({
      id: `${spec.id}:out:${variableName}`,
      variableName,
      description: null,
      dateCreated: CREATED,
      dateModified: MODIFIED,
    })),
    inputTuples,
    outputTuples: [],
    tupleMembers,
  };
}

const GROUP_ID = 'urn:sqlib:query-group:order-detail';

export const QUERY_GROUP = {
  id: GROUP_ID,
  name: 'Order detail',
  description: 'One row per order, line count folded in',
  currentVersion: 'urn:sqlib:group-version:order-detail',
  currentVersionNumber: 1,
  isPartOf: LIBRARY.id,
  dateCreated: CREATED,
  dateModified: MODIFIED,
  argumentSets: null,
};

const GROUP_VERSION = {
  id: QUERY_GROUP.currentVersion,
  version: 1,
  immutable: true,
  startNode: `${GROUP_ID}:start`,
  endNode: `${GROUP_ID}:end`,
  executionNodes: [`${GROUP_ID}:node-1`, `${GROUP_ID}:node-2`],
  edges: [],
  canvasData: null,
  comment: null,
  dateCreated: CREATED,
  dateModified: MODIFIED,
  isPartOf: GROUP_ID,
};

const GROUP_VERSION_EXPANDED = {
  queryGroupVersion: GROUP_VERSION,
  executionNodes: [],
  startNode: null,
  endNode: null,
  edges: [],
  /*
   * queryNodeSchema is strict, so a node stub is not enough — a partial node
   * fails the parse and the whole group silently drops out of the table.
   */
  queryNodes: [1, 2].map((index) => ({
    id: `${GROUP_ID}:node-${index}`,
    queryId: QUERIES[0]!.id,
    backendId: BACKEND.id,
    inputs: null,
    outputs: null,
    backendConfig: null,
    nodeType: 'QueryNode',
    dateCreated: CREATED,
    dateModified: MODIFIED,
  })),
  dynamicQueryNodes: [],
  ruleSetNodes: [],
  startNodes: [],
  endNodes: [],
  tupleMembers: [
    {
      id: `${GROUP_ID}:tm:0`,
      position: 0,
      variable: `${GROUP_ID}:in:orderId`,
      dateCreated: CREATED,
      dateModified: MODIFIED,
    },
  ],
  inputTuples: [
    {
      id: `${GROUP_ID}:tuple:0`,
      name: null,
      memberEntries: [`${GROUP_ID}:tm:0`],
      dateCreated: CREATED,
      dateModified: MODIFIED,
    },
  ],
  outputTuples: [],
  inputs: [
    {
      id: `${GROUP_ID}:in:orderId`,
      variableName: 'orderId',
      allowedTypes: null,
      dateCreated: CREATED,
      dateModified: MODIFIED,
    },
  ],
  // Covers Product search's `term`? No — deliberately not. These outputs feed
  // nothing in this library, so the Composition tab has a real negative case.
  outputs: [
    { id: `${GROUP_ID}:out:orderId`, variableName: '?orderId', description: null, dateCreated: CREATED, dateModified: MODIFIED },
    { id: `${GROUP_ID}:out:status`, variableName: '?status', description: null, dateCreated: CREATED, dateModified: MODIFIED },
  ],
  rdfOutputs: [],
  booleanOutputs: [],
  queryIdInputs: [],
  queryVersions: [],
};

export const EXECUTION_RESULTS = {
  head: { vars: ['product', 'title', 'price'] },
  results: {
    bindings: [
      {
        product: { type: 'uri', value: 'http://example.org/product/1' },
        title: { type: 'literal', value: 'Wool jumper' },
        price: { type: 'literal', value: '84.00' },
      },
    ],
  },
};

/*
 * The export bundle the library page reads.
 *
 * Written out rather than derived, because the page's contract is with the
 * bundle *format* — a template's text plus the span of each parameter slot —
 * and a fixture that computed the spans would agree with a page that computed
 * them the same wrong way.
 */
const SEARCH_TEXT =
  'PREFIX : <http://example.org/>\nSELECT ?product ?title ?price WHERE {\n  VALUES ?term { UNDEF }\n  ?product :title ?title ;\n           :price ?price .\n  FILTER(CONTAINS(?title, ?term))\n}\nORDER BY DESC(?price)\nLIMIT 0001';
const STOCK_TEXT =
  'PREFIX : <http://example.org/>\nASK {\n  VALUES ?product { UNDEF }\n  ?product :inStock true\n}';
const GRAPH_TEXT =
  'PREFIX : <http://example.org/>\nCONSTRUCT { ?product :title ?title }\nWHERE {\n  VALUES ?product { UNDEF }\n  ?product :title ?title\n}';

function slotOf(text: string, keyword = 'VALUES') {
  const start = text.indexOf(keyword);
  return { start, end: text.indexOf('}', start) + 1 };
}

function templateOf(text: string, vars: string[]) {
  const { start, end } = slotOf(text);
  return { text, slots: [{ start, end, vars }], prefixes: [['', 'http://example.org/'] as [string, string]] };
}

export const EXPORT_TAGS = [
  { id: 'urn:sqlib:tag:catalogue', name: 'catalogue', color: '#2159c9', isPartOf: LIBRARY.id },
  { id: 'urn:sqlib:tag:stock', name: 'stock', color: '#1b7f4b', isPartOf: LIBRARY.id },
];

export const EXPORT_BUNDLE = {
  bundle: {
    version: 1 as const,
    library: { id: LIBRARY.id, name: LIBRARY.name },
    generatedAt: '2026-08-26T00:00:00Z',
    queries: {
      'product-search': {
        template: templateOf(SEARCH_TEXT, ['term']),
        queryType: 'SELECT' as const,
        limitParameters: ['1'],
        offsetParameters: [],
        pageParameters: [
          {
            name: '1',
            kind: 'limit' as const,
            start: SEARCH_TEXT.indexOf('LIMIT 0001'),
            end: SEARCH_TEXT.indexOf('LIMIT 0001') + 'LIMIT 0001'.length,
          },
        ],
        inferredInputs: [['term']],
        textHash: 'sha256-unchecked',
        sourceQuery: 'urn:sqlib:query:product-search',
        description: 'Products whose title contains a search term, most expensive first.',
        tags: ['urn:sqlib:tag:catalogue'],
        examples: [
          {
            name: 'jumper',
            arguments: [
              {
                head: { vars: ['term'] },
                arguments: { bindings: [{ term: { type: 'literal', value: 'jumper' } }] },
              },
            ],
            limits: [{ name: '1', value: 10 }],
          },
          {
            name: 'wool',
            dataDependent: true,
            arguments: [
              {
                head: { vars: ['term'] },
                arguments: { bindings: [{ term: { type: 'literal', value: 'wool' } }] },
              },
            ],
            expected: '{"head":{"vars":["product"]},"results":{"bindings":[]}}',
            expectedFormat: 'application/sparql-results+json',
          },
        ],
      },
      'is-in-stock': {
        template: templateOf(STOCK_TEXT, ['product']),
        queryType: 'ASK' as const,
        limitParameters: [],
        offsetParameters: [],
        inferredInputs: [['product']],
        textHash: 'sha256-unchecked',
        sourceQuery: 'urn:sqlib:query:is-in-stock',
        description: 'Whether a product is currently in stock.',
        tags: ['urn:sqlib:tag:stock'],
        examples: [],
      },
      'product-graph': {
        template: templateOf(GRAPH_TEXT, ['product']),
        queryType: 'CONSTRUCT' as const,
        limitParameters: [],
        offsetParameters: [],
        inferredInputs: [['product']],
        textHash: 'sha256-unchecked',
        sourceQuery: 'urn:sqlib:query:product-graph',
        description: 'A compact graph for one product.',
        tags: [],
        examples: [],
      },
    },
  },
  skipped: [
    { id: 'urn:sqlib:query:half-written', name: 'Half written', reason: 'The query has no current version.' },
  ],
};

/** Every POST the spec sends, so a test can assert what the client did. */
export interface RecordedWrite {
  method: string;
  pathname: string;
  body: unknown;
}

export async function mockCallableLibrary(page: Page): Promise<RecordedWrite[]> {
  const writes: RecordedWrite[] = [];

  const json = (route: Route, payload: unknown) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });

  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== API_ORIGIN) {
      await route.fallback();
      return;
    }

    const { pathname } = url;

    if (request.method() !== 'GET') {
      let body: unknown = null;
      try {
        body = request.postDataJSON();
      } catch {
        body = request.postData();
      }
      writes.push({ method: request.method(), pathname, body });

      if (/\/execute$/.test(pathname)) {
        await json(route, EXECUTION_RESULTS);
        return;
      }
      // A saved version comes back as the expanded shape.
      const match = /\/queries\/([^/]+)\/v$/.exec(pathname);
      if (match) {
        const spec = QUERY_SPECS.find((candidate) => candidate.id === decodeURIComponent(match[1]!));
        await json(route, {
          ...expandedFor(spec ?? QUERY_SPECS[0]!),
          iriMap: {},
        });
        return;
      }
      await json(route, {});
      return;
    }

    // Query version detail, then the version list, then the entity.
    const versionDetail = /\/queries\/([^/]+)\/v\/\d+$/.exec(pathname);
    if (versionDetail) {
      const spec = QUERY_SPECS.find((candidate) => candidate.id === decodeURIComponent(versionDetail[1]!));
      await json(route, spec ? expandedFor(spec) : {});
      return;
    }
    const versionList = /\/queries\/([^/]+)\/v$/.exec(pathname);
    if (versionList) {
      const spec = QUERY_SPECS.find((candidate) => candidate.id === decodeURIComponent(versionList[1]!));
      await json(route, spec ? [versionFor(spec)] : []);
      return;
    }
    if (/\/queries$/.test(pathname)) {
      await json(route, QUERIES);
      return;
    }

    if (/\/query-groups\/[^/]+\/v\/\d+$/.test(pathname)) {
      await json(route, GROUP_VERSION_EXPANDED);
      return;
    }
    if (/\/query-groups\/[^/]+\/v$/.test(pathname)) {
      await json(route, [GROUP_VERSION]);
      return;
    }
    if (/\/query-groups$/.test(pathname)) {
      await json(route, [QUERY_GROUP]);
      return;
    }

    if (/\/libraries\/[^/]+\/export-bundle$/.test(pathname)) {
      await json(route, EXPORT_BUNDLE);
      return;
    }
    if (/\/tags$/.test(pathname)) {
      await json(route, EXPORT_TAGS);
      return;
    }
    if (/\/libraries$/.test(pathname)) {
      await json(route, [LIBRARY, OTHER_LIBRARY]);
      return;
    }
    if (/\/backends$/.test(pathname)) {
      await json(route, [BACKEND]);
      return;
    }
    if (/\/rule-sets$/.test(pathname)) {
      await json(route, [RULE_SET]);
      return;
    }

    await json(route, []);
  });

  return writes;
}

/** Seed a browser-local draft before the app mounts. */
export async function seedDraft(page: Page, overrides: Record<string, unknown> = {}) {
  await page.addInitScript((draft) => {
    localStorage.setItem('sparql-query-lib-callable-drafts', JSON.stringify([draft]));
  }, {
    id: 'urn:sqlib:query:product-detail',
    libraryId: LIBRARY.id,
    type: 'query',
    name: 'Product detail',
    description: 'Single product with category',
    queryString: 'SELECT ?title WHERE { ?product <http://example.org/title> ?title }',
    resultKind: 'BINDINGS',
    inputTuples: [['product']],
    limitParameters: [],
    offsetParameters: [],
    outputs: ['?title', '?price'],
    basedOn: 'urn:sqlib:query:product-search',
    updatedAt: MODIFIED,
    ...overrides,
  });
}
