import { expect, type Locator, type Page, type Route } from '@playwright/test';
import { mockSidebarCollections } from './fixtures/collections';
import type {
  Backend,
  Library,
  Query,
  QueryVersion,
  QueryVersionExpanded,
  QueryVersionExpandedWithIriMap,
  QueryGroup,
} from '@sparql-query-lib/contracts';

const isoNow = () => new Date().toISOString();

function makeEtag(kind: string, value: string) {
  return `"${kind}-${value}"`;
}

// Imported rather than only re-exported: `export ... from` does not bind the
// names locally, and this module uses most of them itself.
import {
  ARGUMENT_SET_ID,
  ARGUMENT_SET_NAME,
  ARGUMENT_SET_VERSION_ID,
  ARGUMENT_SET_CITY,
  ARGUMENT_SET_COUNTRY,
  FOREIGN_ARGUMENT_SET_ID,
  FOREIGN_ARGUMENT_SET_NAME,
  LIBRARY_ID,
  LIBRARY_NAME,
  BACKEND_ID,
  EXISTING_QUERY_ID,
  EXISTING_QUERY_VERSION_ID,
  EXISTING_QUERY_NAME,
  GROUP_ID,
  GROUP_NAME,
  START_NODE_ID,
  END_NODE_ID,
  QUERY_NODE_ID,
  CONTROL_EDGE_ID,
  DATA_EDGE_ID,
  OUTPUT_EDGE_ID,
  START_CONTROL_PORT,
  START_TUPLE_PORT,
  NODE_INPUT_PORT,
  NODE_OUTPUT_PORT,
  RULE_SET_ID,
  RULE_SET_NAME,
  RULE_SET_VERSION_1_ID,
  RULE_SET_VERSION_2_ID,
  UPDATE_QUERY_ID,
  UPDATE_QUERY_NAME,
  UPDATE_QUERY_VERSION_ID,
  buildIriMap,
  createMockState,
  buildVersionCreateResponse,
  wrapExecutionResponse,
  SELECT_SIMPLE_QUERY,
} from './fixtures/query-group-mock-state';

import type {
  StoredQueryVersion,
  StoredArgumentRow,
  StoredArgumentSet,
  StoredArgumentSetVersion,
  MockState,
  ExecutionResponseFixture,
  SetupMockApiOptions,
} from './fixtures/query-group-mock-state';

export type {
  StoredQueryVersion,
  StoredArgumentRow,
  StoredArgumentTupleBinding,
  StoredArgumentSet,
  StoredArgumentSetVersion,
  MockState,
  ExecutionResponseFixture,
  NodeDetailFixture,
  SetupMockApiOptions,
  ValidationResponseFixture,
} from './fixtures/query-group-mock-state';
export {
  ARGUMENT_SET_ID,
  ARGUMENT_SET_NAME,
  ARGUMENT_SET_VERSION_ID,
  ARGUMENT_SET_CITY,
  ARGUMENT_SET_COUNTRY,
  FOREIGN_ARGUMENT_SET_ID,
  FOREIGN_ARGUMENT_SET_NAME,
  LIBRARY_ID,
  LIBRARY_NAME,
  BACKEND_ID,
  EXISTING_QUERY_ID,
  EXISTING_QUERY_VERSION_ID,
  EXISTING_QUERY_NAME,
  GROUP_ID,
  GROUP_NAME,
  START_NODE_ID,
  END_NODE_ID,
  QUERY_NODE_ID,
  CONTROL_EDGE_ID,
  DATA_EDGE_ID,
  OUTPUT_EDGE_ID,
  START_CONTROL_PORT,
  START_TUPLE_PORT,
  NODE_INPUT_PORT,
  NODE_OUTPUT_PORT,
  RULE_SET_ID,
  RULE_SET_NAME,
  RULE_SET_VERSION_1_ID,
  RULE_SET_VERSION_2_ID,
  UPDATE_QUERY_ID,
  UPDATE_QUERY_NAME,
  UPDATE_QUERY_VERSION_ID,
  buildIriMap,
  createMockState,
  buildVersionCreateResponse,
  wrapExecutionResponse,
  SELECT_SIMPLE_QUERY,
};

export const SELECT_ALL_SHORTCUT = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';


const decodeId = (raw: string) => decodeURIComponent(raw);

const getUrlSegments = (route: Route) => new URL(route.request().url()).pathname.split('/').filter(Boolean);

const findQueryByVersion = (state: MockState, versionId: string) => {
  const [queryId] = Object.entries(state.queryVersions).find(([, versions]) =>
    versions.some((entry) => entry.id === versionId),
  ) ?? [null, null];
  if (!queryId) {
    return null;
  }
  const query = state.queries.find((entry) => entry.id === queryId) ?? null;
  const version = state.queryVersions[queryId].find((entry) => entry.id === versionId) ?? null;
  if (!query || !version) {
    return null;
  }
  return { query, version };
};

const buildQueryVersionExpanded = (
  version: StoredQueryVersion,
): QueryVersionExpanded => ({
  queryVersion: {
    id: version.id,
    version: version.version,
    queryString: version.queryString,
    comment: version.comment,
    isPartOf: version.isPartOf,
    /*
     * Passed through rather than nulled. The server derives a version's type
     * from its query string and several canvas rules key on it — the flow type
     * an edge is recommended, which media types are played up, and whether a
     * patch node will accept the assignment at all. A mock that answers `null`
     * for every version makes all of those unreachable from a spec. Versions
     * that declare none still answer none, which is what the seeded SELECT does.
     */
    queryType: version.queryType ?? null,
    defaultBackend: version.defaultBackend ?? null,
    limitParameters: null,
    offsetParameters: null,
    inferredInputs: null,
    inferredOutputs: null,
    dateCreated: version.dateCreated ?? null,
    dateModified: version.dateModified ?? null,
  },
  limitParameters: [],
  offsetParameters: [],
  inputs: [],
  outputs: [],
  inputTuples: [],
  outputTuples: [],
  tupleMembers: [],
});

/**
 * A version as the server would write it, not as the client sent it.
 *
 * `ArgumentSetService` stores a binding as an entity and reads it back with an
 * id, its signature filled in, and rows carrying synthesised ids and positions
 * — so a client that sent `{ values }` alone gets more back than it posted.
 * Echoing the body instead would let a spec assert on a response no server can
 * produce, which is the whole failure mode the mock-drift guard exists for.
 */
type PostedArgumentSetBody = {
  name?: string;
  description?: string | null;
  tupleBindings?: Array<{
    tupleSignature?: string;
    variables?: string[];
    rows?: Array<{ values?: StoredArgumentRow['values'] }>;
    tupleSetVersions?: string[];
  }>;
  scalarBindings?: unknown[];
  graphBindings?: unknown[];
};

const buildArgumentSetVersion = (
  setId: string,
  version: number,
  body: PostedArgumentSetBody,
): StoredArgumentSetVersion => {
  const now = isoNow();
  return {
    id: `${setId}:v${version}`,
    isPartOf: setId,
    version,
    tupleBindings: (body.tupleBindings ?? []).map((binding, index) => {
      const variables = binding.variables ?? [];
      const bindingId = `${setId}:binding:${version}:${index}`;
      return {
        id: bindingId,
        tupleSignature: binding.tupleSignature ?? variables.join('|'),
        variables,
        rows: (binding.rows ?? []).map((row, position) => ({
          id: `${bindingId}:row:${position}`,
          position,
          values: row.values ?? {},
        })),
        ...(binding.tupleSetVersions?.length ? { tupleSetVersions: binding.tupleSetVersions } : {}),
      };
    }),
    scalarBindings: body.scalarBindings ?? [],
    dateCreated: now,
    dateModified: now,
  };
};

const defaultExecutionResponse: ExecutionResponseFixture = {
  contentType: 'application/sparql-results+json',
  body: {
    head: { vars: ['country', 'population'] },
    results: {
      bindings: [
        {
          country: { type: 'uri', value: 'https://example.org/country/1' },
          population: { type: 'literal', value: '5000000' },
        },
      ],
    },
  },
  /*
   * The one execution node the seeded group has, reporting what it did. Start
   * and End nodes are never here: the engine treats them as control-flow
   * markers and runs no hooks for them (`ExecutionEngine.execute`), so a
   * fixture that named them would describe a run no server performs.
   */
  nodes: [
    {
      nodeId: QUERY_NODE_ID,
      status: 'ok',
      durationMs: 24,
      rowCount: 1,
    },
  ],
};

export async function setupMockApi(page: Page, state: MockState, options: SetupMockApiOptions = {}) {
  const json = (route: Route, status: number, body: unknown, headers: Record<string, string> = {}) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
      headers,
    });

  const resolveExecutionResponse = (): ExecutionResponseFixture => {
    const { executionResponse } = options;
    if (typeof executionResponse === 'function') {
      return executionResponse();
    }
    if (executionResponse) {
      return executionResponse;
    }
    return defaultExecutionResponse;
  };

  // Empty defaults for the rules-suite collections this helper does not model.
  // The sidebar loads all seven in one Promise.all, so an unmocked rules
  // endpoint takes libraries and queries down with it.
  await mockSidebarCollections(page);

  await page.route('**/backends', async (route) => {
    if (route.request().method() === 'GET') {
      await json(route, 200, state.backends);
      return;
    }
    await route.fallback();
  });

  await page.route('**/libraries', async (route) => {
    if (route.request().method() === 'GET') {
      await json(route, 200, state.libraries);
      return;
    }
    await route.fallback();
  });

  await page.route('**/queries/*/v/*/validate', (route) => route.fallback());

  await page.route('**/queries/*/v/*', async (route) => {
    const segments = getUrlSegments(route);
    const id = decodeId(segments[1] ?? '');
    const versionNumber = Number(segments[3]);
    const versions = state.queryVersions[id] ?? [];
    const version = versions.find((entry) => entry.version === versionNumber);
    if (!version) {
      await json(route, 404, { error: 'Version not found' });
      return;
    }
    const expanded = buildQueryVersionExpanded(version);
    await json(route, 200, expanded, {
      ETag: makeEtag('query-version', `${id}-${versionNumber}`),
    });
  });

  await page.route('**/queries/*/v', async (route) => {
    const segments = getUrlSegments(route);
    const id = decodeId(segments[1] ?? '');
    const versions = state.queryVersions[id] ?? [];
    if (route.request().method() === 'GET') {
      await json(route, 200, versions);
      return;
    }
    if (route.request().method() === 'POST') {
      const payload = route.request().postDataJSON();
      const next = state.nextQueryVersion[id] ?? 1;
      const newVersionId = `${id}:v${next}`;
      const now = isoNow();
      const stored: StoredQueryVersion = {
        id: newVersionId,
        version: next,
        queryString: payload.queryVersion.queryString,
        comment: payload.queryVersion.comment ?? null,
        isPartOf: id,
        defaultBackend: payload.queryVersion.defaultBackend ?? null,
        dateCreated: now,
        dateModified: now,
      };
      if (!state.queryVersions[id]) {
        state.queryVersions[id] = [];
      }
      state.queryVersions[id].push(stored);
      state.nextQueryVersion[id] = next + 1;
      state.queryVersions[id].sort((a, b) => a.version - b.version);
      const queryIndex = state.queries.findIndex((entry) => entry.id === id);
      if (queryIndex >= 0) {
        state.queries[queryIndex] = {
          ...state.queries[queryIndex],
          currentVersion: newVersionId,
          dateModified: now,
        };
      }
      const responsePayload: QueryVersionExpandedWithIriMap = {
        ...buildQueryVersionExpanded(stored),
        iriMap: {},
      };
      await json(route, 201, responsePayload, {
        ETag: makeEtag('query-version', newVersionId),
      });
      return;
    }
    await route.fallback();
  });

  await page.route('**/queries/*', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    const segments = getUrlSegments(route);
    const id = decodeId(segments[1] ?? '');
    const query = state.queries.find((entry) => entry.id === id);
    if (!query) {
      await json(route, 404, { error: 'Not found' });
      return;
    }
    await json(route, 200, query, {
      ETag: makeEtag('query', id),
    });
  });

  await page.route('**/queries', async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      await json(route, 200, state.queries);
      return;
    }
    if (method === 'POST') {
      const payload = route.request().postDataJSON();
      const now = isoNow();
      const newId = `urn:sqlib:query:auto-${Date.now()}`;
      const newQuery: Query = {
        id: newId,
        name: payload.name,
        description: payload.description ?? null,
        defaultBackend: payload.defaultBackend ?? null,
        currentVersion: null,
        isPartOf: Array.isArray(payload.isPartOf) ? payload.isPartOf : [payload.isPartOf],
        dateCreated: now,
        dateModified: now,
      };
      state.queries.push(newQuery);
      state.queryVersions[newId] = [];
      state.nextQueryVersion[newId] = 1;
      await json(route, 201, newQuery, {
        ETag: makeEtag('query', newId),
      });
      return;
    }
    await route.fallback();
  });

  /*
   * Argument sets.
   *
   * Regexes rather than globs because these paths only differ from each other
   * by a query string or one more segment, and because `**\/argument-sets`
   * would also swallow `/query-groups/:id/argument-sets` — Playwright matches
   * the most recently registered route first, which is too subtle a thing to
   * rest five specs on. The library listing therefore names its query
   * parameter, and the group-scoped pair names the group.
   *
   * `POST /argument-sets` (the rail's standalone create) is deliberately not
   * routed: nothing on the canvas calls it, and a mocked route no spec drives
   * is mock surface that can rot unnoticed.
   */
  const findArgumentSet = (setId: string) => state.argumentSets.find((entry) => entry.id === setId) ?? null;

  const publishArgumentSetVersion = (set: StoredArgumentSet, version: StoredArgumentSetVersion) => {
    const versions = state.argumentSetVersions[set.id] ?? [];
    state.argumentSetVersions[set.id] = [...versions, version];
    state.nextArgumentSetVersion[set.id] = version.version + 1;
    set.currentVersionId = version.id;
    set.currentVersion = version;
    // The set-level bindings mirror its current version, as the expansion does.
    set.tupleBindings = version.tupleBindings;
    set.scalarBindings = version.scalarBindings;
    set.dateModified = isoNow();
  };

  await page.route(/\/argument-sets\?libraryId=/, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    const libraryId = decodeId(new URL(route.request().url()).searchParams.get('libraryId') ?? '');
    await json(route, 200, state.argumentSets.filter((set) => set.libraryId === libraryId));
  });

  await page.route(/\/argument-sets\/[^/]+\/v\/\d+$/, async (route) => {
    const segments = getUrlSegments(route);
    const setId = decodeId(segments[segments.length - 3] ?? '');
    const versionNumber = Number(segments[segments.length - 1]);
    const version = (state.argumentSetVersions[setId] ?? []).find((entry) => entry.version === versionNumber);
    if (!version) {
      await json(route, 404, { error: 'Version not found' });
      return;
    }
    await json(route, 200, version);
  });

  await page.route(/\/argument-sets\/[^/]+\/v$/, async (route) => {
    const segments = getUrlSegments(route);
    const setId = decodeId(segments[segments.length - 2] ?? '');
    const set = findArgumentSet(setId);
    if (!set) {
      await json(route, 404, { error: 'Not found' });
      return;
    }
    if (route.request().method() === 'GET') {
      await json(route, 200, state.argumentSetVersions[setId] ?? []);
      return;
    }
    if (route.request().method() === 'POST') {
      const next = state.nextArgumentSetVersion[setId] ?? 1;
      const version = buildArgumentSetVersion(setId, next, route.request().postDataJSON());
      publishArgumentSetVersion(set, version);
      await json(route, 201, version);
      return;
    }
    await route.fallback();
  });

  await page.route(/\/argument-sets\/[^/]+$/, async (route) => {
    const segments = getUrlSegments(route);
    const setId = decodeId(segments[segments.length - 1] ?? '');
    const set = findArgumentSet(setId);
    if (route.request().method() === 'DELETE') {
      state.argumentSets = state.argumentSets.filter((entry) => entry.id !== setId);
      delete state.argumentSetVersions[setId];
      await json(route, 200, { deleted: true });
      return;
    }
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    if (!set) {
      await json(route, 404, { error: 'Not found' });
      return;
    }
    await json(route, 200, set);
  });

  await page.route(/\/query-groups\/[^/]+\/argument-sets$/, async (route) => {
    const segments = getUrlSegments(route);
    const groupId = decodeId(segments[segments.length - 2] ?? '');
    if (route.request().method() === 'GET') {
      await json(route, 200, state.argumentSets.filter((set) => set.targetId === groupId));
      return;
    }
    if (route.request().method() === 'POST') {
      const payload = route.request().postDataJSON();
      const group = state.queryGroups.find((entry) => entry.id === groupId);
      if (!group) {
        await json(route, 404, { error: `QueryGroup ${groupId} not found` });
        return;
      }
      const now = isoNow();
      const setId = `urn:sqlib:argument-set:auto-${state.argumentSets.length + 1}`;
      const version = buildArgumentSetVersion(setId, 1, payload);
      const set: StoredArgumentSet = {
        id: setId,
        name: payload.name,
        description: payload.description ?? null,
        // Provenance the client never sends: the route it posted to is what
        // says the set belongs to this group, and the library is derived from
        // the group rather than accepted (`ArgumentSetService.createForTarget`).
        scope: 'queryGroup',
        targetId: groupId,
        libraryId: typeof group.isPartOf === 'string' ? group.isPartOf : LIBRARY_ID,
        currentVersionId: version.id,
        currentVersion: version,
        tupleBindings: version.tupleBindings,
        scalarBindings: version.scalarBindings,
        dateCreated: now,
        dateModified: now,
      };
      state.argumentSets.push(set);
      state.argumentSetVersions[setId] = [version];
      state.nextArgumentSetVersion[setId] = 2;
      await json(route, 201, set, { ETag: makeEtag('argument-set', setId) });
      return;
    }
    await route.fallback();
  });

  /*
   * The rules suite, to the extent a query group needs it: a RuleSetNode is
   * assigned from the rule sets of the group's library, and the selector reads
   * the list and then each rule set's versions.
   */
  await page.route('**/rule-sets', async (route) => {
    if (route.request().method() === 'GET') {
      await json(route, 200, state.ruleSets);
      return;
    }
    await route.fallback();
  });

  await page.route('**/rule-sets/*/versions', async (route) => {
    const segments = getUrlSegments(route);
    const ruleSetId = decodeId(segments[1] ?? '');
    if (route.request().method() === 'GET') {
      await json(route, 200, state.ruleSetVersions[ruleSetId] ?? []);
      return;
    }
    await route.fallback();
  });

  await page.route('**/rule-sets/*', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    const segments = getUrlSegments(route);
    const ruleSetId = decodeId(segments[1] ?? '');
    const ruleSet = state.ruleSets.find((entry) => entry.id === ruleSetId);
    if (!ruleSet) {
      await json(route, 404, { error: 'Not found' });
      return;
    }
    await json(route, 200, ruleSet, { ETag: makeEtag('rule-set', ruleSetId) });
  });

  await page.route('**/query-groups/*/v/*/validate', async (route) => {
    const { validationResponse } = options;
    const fixture = typeof validationResponse === 'function' ? validationResponse() : validationResponse;
    await json(route, 200, {
      valid: true,
      errors: [],
      warnings: [],
      issues: [],
      ...fixture,
    });
  });

  await page.route('**/query-groups/*/v/*', async (route) => {
    const segments = getUrlSegments(route);
    const groupId = decodeId(segments[1] ?? '');
    const versionNumber = Number(segments[3]);
    const expanded = state.queryGroupExpanded[groupId]?.[versionNumber];
    if (!expanded) {
      await json(route, 404, { error: 'Version not found' });
      return;
    }
    /*
     * With the version, the names its nodes are labelled by. The server sends
     * an `iriMap` here (query versions → query name, rule set versions → rule
     * set name); a mock that omitted it left every reloaded node showing its
     * IRI or "Unknown", which is not what the app does.
     */
    await json(route, 200, { ...expanded, iriMap: buildIriMap(state) }, {
      ETag: makeEtag('query-group-version', `${groupId}-${versionNumber}`),
    });
  });

  await page.route('**/query-groups/*/v', async (route) => {
    const segments = getUrlSegments(route);
    const groupId = decodeId(segments[1] ?? '');
    if (route.request().method() === 'GET') {
      const versions = (state.queryGroupVersions[groupId] ?? []).slice().sort((a, b) => b.version - a.version);
      await json(route, 200, versions);
      return;
    }
    if (route.request().method() === 'POST') {
      const payload = route.request().postDataJSON();
      const next = state.nextQueryGroupVersion[groupId] ?? 1;
      const versionId = `${groupId}:v${next}`;
      const now = isoNow();
      // Built in the fixture module so a unit test can replay it — see the note
      // on `buildVersionCreateResponse`.
      const expandedBase = buildVersionCreateResponse(payload, {
        groupId,
        versionId,
        versionNumber: next,
        now,
        // What the nodes it saved point at, so the reloaded version resolves
        // them the way the GET does.
        queryVersions: state.queryVersions,
      });
      const summary = expandedBase.queryGroupVersion;
      state.queryGroupVersions[groupId] = [...(state.queryGroupVersions[groupId] ?? []), summary];
      if (!state.queryGroupExpanded[groupId]) {
        state.queryGroupExpanded[groupId] = {};
      }
      state.queryGroupExpanded[groupId][next] = expandedBase;
      state.nextQueryGroupVersion[groupId] = next + 1;
      await json(route, 201, {
        ...expandedBase,
        iriMap: payload.iriMap ?? {},
      }, {
        ETag: makeEtag('query-group-version', versionId),
      });
      return;
    }
    await route.fallback();
  });

  await page.route('**/query-groups/*', async (route) => {
    const method = route.request().method();
    const segments = getUrlSegments(route);
    const groupId = decodeId(segments[1] ?? '');
    if (method === 'GET') {
      const group = state.queryGroups.find((entry) => entry.id === groupId);
      if (!group) {
        await json(route, 404, { error: 'Not found' });
        return;
      }
      await json(route, 200, group, {
        ETag: makeEtag('query-group', groupId),
      });
      return;
    }
    if (method === 'PATCH') {
      const payload = route.request().postDataJSON();
      const groupIndex = state.queryGroups.findIndex((entry) => entry.id === groupId);
      if (groupIndex === -1) {
        await json(route, 404, { error: 'Not found' });
        return;
      }
      const group = state.queryGroups[groupIndex];
      const updated: QueryGroup = {
        ...group,
        ...payload.queryGroup,
        dateModified: isoNow(),
      };
      state.queryGroups[groupIndex] = updated;
      await json(route, 200, updated, {
        ETag: makeEtag('query-group', groupId),
      });
      return;
    }
    await route.fallback();
  });

  await page.route('**/query-groups', async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      await json(route, 200, state.queryGroups);
      return;
    }
    if (method === 'POST') {
      const payload = route.request().postDataJSON();
      const now = isoNow();
      const newId = payload.id ?? `urn:sqlib:query-group:auto-${Date.now()}`;
      const newGroup: QueryGroup = {
        id: newId,
        name: payload.name,
        description: payload.description ?? null,
        currentVersion: null,
        isPartOf: payload.isPartOf,
        dateCreated: now,
        dateModified: now,
      };
      state.queryGroups.push(newGroup);
      state.queryGroupVersions[newId] = [];
      state.queryGroupExpanded[newId] = {};
      state.nextQueryGroupVersion[newId] = 1;
      await json(route, 201, newGroup, {
        ETag: makeEtag('query-group', newId),
      });
      return;
    }
    await route.fallback();
  });

  await page.route('**/detect-outputs', async (route) => {
    if (route.request().method() === 'POST') {
      await json(route, 200, []);
      return;
    }
    await route.fallback();
  });

  await page.route('**/execute', async (route) => {
    const fixture = resolveExecutionResponse();
    // The shape of the reply is the request's to decide, not the fixture's: a run
    // that asks for node detail can only be answered with the envelope.
    const requested = route.request().postDataJSON() as { nodeDetail?: string } | null;
    const { status, contentType, body } = wrapExecutionResponse(fixture, {
      nodeDetail: Boolean(requested?.nodeDetail),
    });
    await route.fulfill({ status, contentType, body });
  });
}

export async function bootstrapQueryGroupCanvas(page: Page, options?: SetupMockApiOptions) {
  const state = createMockState();
  await setupMockApi(page, state, options);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  return state;
}

export async function openAddQueryDialog(page: Page, libraryName: string) {
  const librariesSection = page.locator('.section-header').filter({ hasText: 'Libraries' });
  const libraryToggle = librariesSection.locator('.section-toggle');
  await ensureExpanded(libraryToggle, librariesSection.locator('.arrow'));

  const libraryRow = page.locator('.library-item').filter({ hasText: libraryName });
  const libraryButton = libraryRow.locator('.library-toggle');
  await ensureExpanded(libraryButton, libraryRow.locator('.library-toggle .arrow'));

  const queriesCategory = libraryRow.locator('.subitem-category').filter({ hasText: 'Queries' });
  const categoryButton = queriesCategory.locator('.category-header');
  await ensureExpanded(categoryButton, queriesCategory.locator('.category-header .arrow'));

  await queriesCategory.hover();
  const addButton = page.getByRole('button', { name: 'Add Query' }).first();
  await addButton.click();
  await page.waitForSelector('[role="dialog"]');
}

export async function ensureExpanded(toggle: Locator, arrow: Locator) {
  if (!(await hasExpandedClass(arrow))) {
    await toggle.click();
    await expect(arrow).toHaveClass(/expanded/);
  }
}

export async function hasExpandedClass(arrow: Locator) {
  const classes = await arrow.getAttribute('class');
  return classes?.split(' ').includes('expanded') ?? false;
}

export async function selectSidebarQueryGroup(page: Page, libraryName: string, groupName: string) {
  const librariesSection = page.locator('.section-header').filter({ hasText: 'Libraries' });
  const libraryRow = page.locator('.library-item').filter({ hasText: libraryName });
  await ensureExpanded(librariesSection.locator('.section-toggle'), librariesSection.locator('.arrow'));
  await ensureExpanded(libraryRow.locator('.library-toggle'), libraryRow.locator('.library-toggle .arrow'));
  const queryGroupsCategory = libraryRow.locator('.subitem-category').filter({ hasText: 'Query Groups' });
  await ensureExpanded(queryGroupsCategory.locator('.category-header'), queryGroupsCategory.locator('.category-header .arrow'));
  await libraryRow.locator('.item-button').filter({ hasText: groupName }).click();
  await page.waitForSelector('.querygroup-work-area');
}

export async function selectSidebarQuery(page: Page, libraryName: string, queryName: string) {
  const librariesSection = page.locator('.section-header').filter({ hasText: 'Libraries' });
  const libraryRow = page.locator('.library-item').filter({ hasText: libraryName });
  await ensureExpanded(librariesSection.locator('.section-toggle'), librariesSection.locator('.arrow'));
  await ensureExpanded(libraryRow.locator('.library-toggle'), libraryRow.locator('.library-toggle .arrow'));
  const queriesCategory = libraryRow.locator('.subitem-category').filter({ hasText: 'Queries' });
  await ensureExpanded(queriesCategory.locator('.category-header'), queriesCategory.locator('.category-header .arrow'));
  await libraryRow.locator('.item-button').filter({ hasText: queryName }).first().click();
  await page.waitForSelector('.query-work-area');
}

/**
 * Select a canvas node, which is not the same as clicking its middle.
 *
 * A collapsed node is almost entirely its own `.node-toggle` button, and that
 * button carries `@click.stop` so opening a node does not also select it. A
 * click at the element's centre — Playwright's default — therefore lands on the
 * toggle, expands the node and never reaches VueFlow's `@node-click`, which is
 * what wires `graph.selectNode`. The inspector then stays on "Nothing
 * selected", which reads as a broken canvas but is the toggle doing its job.
 *
 * Clicking just inside the node's top-left corner misses the toggle (and the
 * connection handles, which sit at the vertical middle of each side) and
 * selects, open or closed.
 */
export async function selectQueryNode(page: Page, nodeId: string) {
  const nodeById = page.locator(`[data-id="${nodeId}"]`);
  const node = (await nodeById.count())
    ? nodeById.first()
    : page.locator('.vue-flow__node').filter({ hasText: 'Query' }).first();
  await node.click({ position: { x: 3, y: 3 } });
  await expect(node).toHaveClass(/selected/);
}

/**
 * Select a canvas edge, which means clicking a point that is on its own line.
 *
 * An edge is a stroked path, so its bounding box is mostly not the edge —
 * Playwright's default click at the centre lands on whatever else is drawn
 * there, and on this canvas that is reliably the *other* edge joining the same
 * two nodes (`QueryGroupCanvasEdge` bows parallel edges apart, but their boxes
 * still overlap). `force` does not help: it skips the hit test rather than
 * moving the point.
 *
 * So the point comes from the path itself. VueFlow draws a transparent
 * `.vue-flow__edge-interaction` path along the same route for exactly this
 * purpose, 20px wide here; walking along it for a spot where `elementFromPoint`
 * answers with this edge is what a user does by eye. The label is
 * `pointer-events: none` by design, so it cannot stand in for the line.
 */
export async function selectCanvasEdge(page: Page, edgeId: string) {
  const interaction = page.locator(`.vue-flow__edge[data-id="${edgeId}"] .vue-flow__edge-interaction`);
  await interaction.waitFor();

  const point = await interaction.evaluate((path, id) => {
    const geometry = path as unknown as SVGGeometryElement;
    const matrix = geometry.getScreenCTM();
    const length = geometry.getTotalLength();
    if (!matrix || !length) return null;
    // Along the line rather than at one spot: the midpoint of a bowed edge can
    // still sit under its neighbour, and the ends sit under the nodes.
    for (const fraction of [0.5, 0.4, 0.6, 0.3, 0.7, 0.25, 0.75]) {
      const at = geometry.getPointAtLength(length * fraction).matrixTransform(matrix);
      const hit = document.elementFromPoint(at.x, at.y);
      if (hit?.closest('.vue-flow__edge')?.getAttribute('data-id') === id) {
        return { x: at.x, y: at.y };
      }
    }
    return null;
  }, edgeId);

  if (!point) throw new Error(`No clickable point found on edge ${edgeId}`);
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('.canvas-editor .panel-header__subtitle')).toHaveText(edgeId);
}

/** The canvas object editor lives in the inspector's Editor tab, not Details. */
export async function openCanvasEditorTab(page: Page) {
  await page.getByRole('button', { name: 'Editor', exact: true }).click();
}

/**
 * Drag a node across the canvas.
 *
 * Grabbed at its top-left corner, which is the one part of a collapsed node
 * that is neither its toggle button nor a connection handle.
 */
export async function moveNodeBy(page: Page, nodeId: string, dx: number, dy: number) {
  const node = page.locator(`[data-id="${nodeId}"]`);
  const box = await node.boundingBox();
  if (!box) throw new Error(`Node ${nodeId} is not on screen`);
  await page.mouse.move(box.x + 4, box.y + 4);
  await page.mouse.down();
  await page.mouse.move(box.x + 4 + dx, box.y + 4 + dy, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await node.boundingBox())?.y).not.toBe(box.y);
}

/**
 * The centre of a connection handle, measured only once it has stopped moving.
 *
 * VueFlow pans and zooms by writing a transform onto the viewport, and the
 * controls that do it — fit-view especially — return long before that
 * transform has settled. A `boundingBox()` read in that window returns where
 * the handle *was*: the press that follows lands on the pane instead, VueFlow
 * reads it as a canvas drag, and the connection is never attempted. On a fast
 * machine the transform finishes within the same tick and nothing is noticed;
 * on a loaded 2-vCPU runner it does not.
 *
 * Polling the box until two consecutive reads agree, rather than hovering the
 * handle and letting Playwright's actionability do it: `hover()` does contain
 * exactly this stability check, but it also triggers the handle's own hover
 * transition, so the box read immediately afterwards is mid-animation and the
 * press misses by a few pixels. Measured 8 failures in 25 that way. Reading is
 * the only thing that can measure without disturbing what it measures.
 */
export async function settledHandleCentre(handle: Locator) {
  let previous = '';
  await expect
    .poll(
      async () => {
        const box = await handle.boundingBox();
        const current = box ? `${box.x},${box.y},${box.width},${box.height}` : '';
        const settled = current !== '' && current === previous;
        previous = current;
        return settled;
      },
      { message: 'the connection handle never stopped moving' },
    )
    .toBe(true);

  const box = await handle.boundingBox();
  if (!box) throw new Error('A connection handle is not on screen');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Draw an edge between two nodes, the way a user does.
 *
 * Two things this needs that a naive drag does not do. VueFlow starts a
 * connection on `pointerdown` over a handle and finishes it on `pointerup` over
 * another, but only if it saw a `pointermove` over the target in between — a
 * single jump from press to release leaves `onConnect` unfired and the drag
 * discarded in silence. And the handle has to be the topmost element at the
 * point clicked: on the seeded layout the End node sits over the query node's
 * source handle, so a press there lands on the End node and drags *it*. Hence
 * `moveNodeBy` before connecting, which is what a user does by eye.
 */
export async function connectNodes(page: Page, sourceNodeId: string, targetNodeId: string) {
  const source = page.locator(`[data-id="${sourceNodeId}"] .vue-flow__handle-right`);
  const target = page.locator(`[data-id="${targetNodeId}"] .vue-flow__handle-left`);
  const subtitle = page.locator('.canvas-editor .panel-header__subtitle');

  /*
   * One press-drag-release, measured fresh.
   *
   * Measuring inside the attempt rather than once above it is the point: a
   * fit-view that is still animating puts the handle somewhere other than
   * where it was read, and every later attempt would inherit that same wrong
   * coordinate. `settledHandleCentre` waits each handle out before reading it.
   */
  const drag = async () => {
    // Target first, source second, so the pointer finishes on the handle about
    // to be pressed.
    const end = await settledHandleCentre(target);
    const start = await settledHandleCentre(source);

    const covering = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x as number, y as number)?.className ?? '',
      [start.x, start.y],
    );
    if (!String(covering).includes('vue-flow__handle')) {
      throw new Error(`The source handle is covered by ${covering}`);
    }

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x - 20, start.y + 20, { steps: 3 });

    // Approach the target at two *different* points, a frame apart. VueFlow
    // samples the pointer on rAF, so a move dispatched in the same frame as
    // the release is coalesced away and `onConnect` never sees the pointer
    // over the target. Two positions with a frame between cannot be folded.
    await page.mouse.move(end.x - 4, end.y - 4, { steps: 10 });
    await page.evaluate(() => new Promise<number>((resolve) => requestAnimationFrame(resolve)));
    await page.mouse.move(end.x, end.y);
    await page.evaluate(() => new Promise<number>((resolve) => requestAnimationFrame(resolve)));
    await page.mouse.up();
  };

  /*
   * Retry the gesture, not the assertion.
   *
   * Two independent races live here, and the frame budget belongs to the
   * browser: the viewport can still be animating when a handle is measured
   * (fixed above, by measuring late), and the release can land in the same
   * frame as the last move (made unlikely above, not impossible). Both end the
   * same way — no edge, no error, nothing to wait for. Measured on this suite:
   * stale coordinates accounted for roughly 2 failures in 72 under CI-like
   * contention, and the coalesced release for about 1 in 376 unthrottled.
   *
   * A user who drags and sees no edge drags again, so the harness does too.
   * This does not weaken the test: the assertion below is unchanged and still
   * requires a real edge, so a product that cannot connect two nodes fails
   * here exactly as loudly — it just takes three tries to say so.
   */
  for (let attempt = 0; attempt < 3; attempt++) {
    await drag();
    const connected = await subtitle
      .filter({ hasText: /^urn:ui-temp:edge-/ })
      .first()
      .waitFor({ state: 'attached', timeout: 2000 })
      .then(() => true, () => false);
    if (connected) break;
  }

  // The new edge is selected by `onConnect`, which is what puts the inspector
  // on it — so waiting for the editor to name an edge is waiting for the
  // connection to have been made.
  await expect(subtitle).toHaveText(/^urn:ui-temp:edge-/);
}

/**
 * Point the selected node at a query, through the inspector's dropdowns.
 *
 * The modal this used to drive is gone: assignment is the same fuzzy
 * `SearchSelect` the backend field uses, with the version as a second one
 * beneath it. Omitting `versionLabel` takes whatever the query picker chose,
 * which is that query's current version.
 */
export async function chooseQueryInInspector(page: Page, queryName: string, versionLabel?: string) {
  const queryField = page.getByTestId('node-query-select');
  await queryField.click();
  await queryField.fill(queryName);
  await page
    .getByTestId('node-query-select-option')
    .filter({ hasText: queryName })
    .first()
    .click();

  if (versionLabel) {
    const versionField = page.getByTestId('node-query-version-select');
    await versionField.click();
    await page
      .getByTestId('node-query-version-select-option')
      .filter({ hasText: new RegExp(`\\bv${versionLabel}\\b`) })
      .first()
      .click();
  }
}

/** Assign the first query the inspector offers, whichever it is. */
export async function chooseFirstQueryInInspector(page: Page) {
  const queryField = page.getByTestId('node-query-select');
  await queryField.click();
  await page.getByTestId('node-query-select-option').first().click();
}

/**
 * Save the work area's draft as the next version.
 *
 * Saving is one button now (`SaveBar`), labelled with the version it will
 * create; the old "Save Options → Save New Version" menu is gone. A saved
 * It asks for nothing: the version note is written on the version's own row
 * in the Details tab, once the version exists.
 */
export async function saveWorkAreaVersion(page: Page, scopeSelector: string) {
  await page.locator(scopeSelector).locator('[data-testid="save"]').click();
}

export async function saveQueryGroupNewVersion(page: Page) {
  await saveWorkAreaVersion(page, '.querygroup-work-area');
}

export async function createQueryVersionWithCode(page: Page, queryName: string, queryString: string) {
  await openAddQueryDialog(page, LIBRARY_NAME);
  await page.locator('#name').fill(queryName);
  await page.getByRole('button', { name: 'Create Query' }).click();

  const queryEditor = page.locator('.query-work-area .cm-content').first();
  await queryEditor.click();
  await page.keyboard.press(SELECT_ALL_SHORTCUT);
  await page.keyboard.type(queryString);
  await expect(queryEditor).toContainText(queryString.slice(0, 20));

  await saveWorkAreaVersion(page, '.query-work-area');
  await expect(page.locator('.query-work-area [data-testid="version-pill"]')).toContainText('v1');
}

export async function assignQueryVersionToGroupCanvas(
  page: Page,
  queryName: string,
  options: { versionLabel?: string; expectedGroupVersion?: string } = {},
) {
  const { versionLabel, expectedGroupVersion = '2' } = options;
  await selectSidebarQueryGroup(page, LIBRARY_NAME, GROUP_NAME);
  const groupVersionPill = page.locator('.querygroup-work-area [data-testid="version-pill"]');
  await page.locator('.vue-flow__node').first().waitFor();
  await openCanvasEditorTab(page);
  await selectQueryNode(page, QUERY_NODE_ID);
  await chooseQueryInInspector(page, queryName, versionLabel);
  await saveQueryGroupNewVersion(page);
  await expect(groupVersionPill).toContainText(`v${expectedGroupVersion}`);
}

export async function executeQueryGroupAndOpenResults(page: Page) {
  const executeResponse = page.waitForResponse(
    (response) => response.url().includes('/execute') && response.request().method() === 'POST',
  );
  await page.getByTestId('run-bar-run').click();
  await executeResponse;
  // Execution moves the inspector to its Results tab (`activeResultsTab`).
  const resultsTab = page.getByRole('button', { name: 'Results', exact: true });
  await expect(resultsTab).toHaveClass(/active/);
}
