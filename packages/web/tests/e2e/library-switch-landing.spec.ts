import { test, expect, type Page, type Route } from './fixtures/test';
import { mockEntityApi, LIBRARY, QUERY, QUERY_GROUP, RULE_SET } from './fixtures/entities';
import { recordUrl, sectionUrl } from './navigate';

/**
 * A library picked in the switcher lands every entity screen on the new
 * library's first row. With no rows, the screen shows its empty state.
 *
 * Before this, the workspace kept the old library's record open under the new
 * library's list, and the notebook screen opened an empty notebook.
 */

const json = (route: Route, body: unknown) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

const ACTIVE_LIBRARY_KEY = 'sparql-query-lib-active-library';

const OTHER = { ...LIBRARY, id: 'urn:sqlib:library:other', name: 'Other Library' };
const EMPTY = { ...LIBRARY, id: 'urn:sqlib:library:empty', name: 'Empty Library' };

/* Two queries in the other library, named so that name order is not list order by id. */
const OTHER_QUERY_B = { ...QUERY, id: 'urn:sqlib:query:other-b', name: 'Beta query', isPartOf: [OTHER.id] };
const OTHER_QUERY_A = { ...QUERY, id: 'urn:sqlib:query:other-a', name: 'Alpha query', isPartOf: [OTHER.id] };
const OTHER_GROUP = { ...QUERY_GROUP, id: 'urn:sqlib:query-group:other', name: 'Other group', isPartOf: OTHER.id };
const OTHER_RULE_SET = { ...RULE_SET, id: 'urn:sqlib:rule-set:other', name: 'Other rule set', isPartOf: [OTHER.id] };

const NOTEBOOK = {
  id: 'urn:sqlib:notebook:visual', name: 'Visual notebook', description: null,
  currentVersion: null, currentVersionNumber: null, isPartOf: [LIBRARY.id],
};
const OTHER_NOTEBOOK_B = { ...NOTEBOOK, id: 'urn:sqlib:notebook:other-b', name: 'Beta notebook', isPartOf: [OTHER.id] };
const OTHER_NOTEBOOK_A = { ...NOTEBOOK, id: 'urn:sqlib:notebook:other-a', name: 'Alpha notebook', isPartOf: [OTHER.id] };

const inLibrary = (entity: { isPartOf: string | string[] }, library: string | null) =>
  !library || ([] as string[]).concat(entity.isPartOf).includes(library);

/** A list route that answers with the rows of the `?library=` it is asked for. */
function scopedList(rows: Array<{ isPartOf: string | string[] }>) {
  return (route: Route) => {
    const library = new URL(route.request().url()).searchParams.get('library');
    return json(route, rows.filter((row) => inLibrary(row, library)));
  };
}

/** A by-id route over the rows given. */
function byId(rows: Array<{ id: string }>) {
  return (route: Route) => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop() ?? '');
    const row = rows.find((candidate) => candidate.id === id);
    return row ? json(route, row) : route.fulfill({ status: 404, body: '{}' });
  };
}

async function setUp(page: Page) {
  const queries = [QUERY, OTHER_QUERY_B, OTHER_QUERY_A];
  const groups = [QUERY_GROUP, OTHER_GROUP];
  const ruleSets = [RULE_SET, OTHER_RULE_SET];
  const notebooks = [NOTEBOOK, OTHER_NOTEBOOK_B, OTHER_NOTEBOOK_A];
  await mockEntityApi(page, {
    extraRoutes: [
      [/\/libraries$/, (route) => json(route, [LIBRARY, OTHER, EMPTY])],
      [/\/queries$/, scopedList(queries)],
      [/\/queries\/[^/]+$/, byId(queries)],
      [/\/query-groups$/, scopedList(groups)],
      [/\/query-groups\/[^/]+$/, byId(groups)],
      [/\/rule-sets$/, scopedList(ruleSets)],
      [/\/rules$/, scopedList([])],
      [/\/data-blocks$/, scopedList([])],
      [/\/notebooks$/, scopedList(notebooks)],
      [/\/notebooks\/[^/]+$/, byId(notebooks)],
    ],
  });
  await page.addInitScript(([key, id]) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem(key as string, id as string);
      sessionStorage.setItem('seeded', '1');
    }
  }, [ACTIVE_LIBRARY_KEY, LIBRARY.id]);
}

async function switchTo(page: Page, library: { id: string; name: string }) {
  await page.locator('[data-testid="library-switcher"]').click();
  await page.locator(`[data-testid="library-option-${library.id}"]`).click();
  await expect(page.locator('[data-testid="library-switcher"]'))
    .toHaveAttribute('aria-label', `Library — ${library.name}`);
}

/** The saved notebook the address names, or null. */
const openNotebook = (page: Page) => new URL(page.url()).searchParams.get('notebook');

const CASES = [
  { section: 'queries', from: QUERY.id, first: OTHER_QUERY_A.id, noun: 'query' },
  { section: 'queryGroups', from: QUERY_GROUP.id, first: OTHER_GROUP.id, noun: 'group' },
  { section: 'rules', from: RULE_SET.id, first: OTHER_RULE_SET.id, noun: 'rule set' },
] as const;

for (const { section, from, first, noun } of CASES) {
  test(`${section}: a library switch opens the new library's first row`, async ({ page }) => {
    await setUp(page);
    await page.goto(`/${section}/${encodeURIComponent(from)}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator(`[data-entity-id="${from}"]`).first()).toBeVisible();

    await switchTo(page, OTHER);

    await expect(page).toHaveURL(recordUrl(section, first));
    await expect(page.locator('[data-testid="saved-row"]').first()).toHaveAttribute('data-entity-id', first);
    // It stays: the old record must not pull the library back.
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid="library-switcher"]'))
      .toHaveAttribute('aria-label', `Library — ${OTHER.name}`);
  });

  test(`${section}: a switch to an empty library shows the empty state`, async ({ page }) => {
    await setUp(page);
    await page.goto(`/${section}/${encodeURIComponent(from)}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator(`[data-entity-id="${from}"]`).first()).toBeVisible();

    await switchTo(page, EMPTY);

    await expect(page.locator('[data-testid="section-overview"]')).toBeVisible();
    await expect(page.locator('[data-testid="section-overview"]')).toContainText(`No ${noun} open`);
    await expect(page).toHaveURL(sectionUrl(section));
    expect(new URL(page.url()).searchParams.get('library')).toBe(EMPTY.id);
  });
}

test('a record link from another library still opens that record', async ({ page }) => {
  await setUp(page);
  await page.goto(`/queries/${encodeURIComponent(OTHER_QUERY_B.id)}`, { waitUntil: 'domcontentloaded' });

  await expect(page.locator('[data-testid="library-switcher"]'))
    .toHaveAttribute('aria-label', `Library — ${OTHER.name}`);
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(recordUrl('queries', OTHER_QUERY_B.id));
});

test('notebooks: a library switch opens the new library\'s first saved notebook', async ({ page }) => {
  await setUp(page);
  await page.goto(`/notebook?library=${encodeURIComponent(LIBRARY.id)}&notebook=${encodeURIComponent(NOTEBOOK.id)}`, {
    waitUntil: 'domcontentloaded',
  });
  await expect.poll(() => openNotebook(page)).toBe(NOTEBOOK.id);

  await switchTo(page, OTHER);

  await expect.poll(() => openNotebook(page)).toBe(OTHER_NOTEBOOK_A.id);
});

test('notebooks: a switch to an empty library shows the empty notebook', async ({ page }) => {
  await setUp(page);
  await page.goto(`/notebook?library=${encodeURIComponent(LIBRARY.id)}&notebook=${encodeURIComponent(NOTEBOOK.id)}`, {
    waitUntil: 'domcontentloaded',
  });
  await expect.poll(() => openNotebook(page)).toBe(NOTEBOOK.id);

  await switchTo(page, EMPTY);

  await expect(page.getByText('An empty notebook')).toBeVisible();
  await page.waitForTimeout(300);
  expect(openNotebook(page)).toBeNull();
});

/*
 * Grouped by tag, which is the default, the first row the list draws is the
 * first row under the first tag heading, not the first by name. The new
 * library's tags and its heading rows load after the main list, so the
 * landing must wait for them. Slow answers here make that race certain.
 */
const TAG = { id: 'urn:sqlib:tag:other-core', name: 'Core', color: '#2f6feb', isPartOf: OTHER.id };
const TAGGED_QUERY = { ...QUERY, id: 'urn:sqlib:query:other-zeta', name: 'Zeta query', isPartOf: [OTHER.id], tags: [TAG.id] };
const UNTAGGED_QUERY = { ...QUERY, id: 'urn:sqlib:query:other-alpha', name: 'Alpha query', isPartOf: [OTHER.id], tags: [] };

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function setUpTagged(page: Page, slowMs: number) {
  const queries = [{ ...QUERY, tags: [] }, TAGGED_QUERY, UNTAGGED_QUERY];
  await mockEntityApi(page, {
    extraRoutes: [
      [/\/libraries$/, (route) => json(route, [LIBRARY, OTHER, EMPTY])],
      [/\/tags\/counts$/, async (route) => {
        await delay(slowMs);
        const library = new URL(route.request().url()).searchParams.get('library');
        return json(route, library === OTHER.id ? { [TAG.id]: 1 } : {});
      }],
      [/\/tags$/, async (route) => {
        await delay(slowMs);
        const library = new URL(route.request().url()).searchParams.get('library');
        return json(route, library === OTHER.id ? [TAG] : []);
      }],
      [/\/queries$/, async (route) => {
        const params = new URL(route.request().url()).searchParams;
        const library = params.get('library');
        const withTag = params.getAll('withTag');
        if (withTag.length > 0) await delay(slowMs);
        const rows = queries
          .filter((row) => inLibrary(row, library))
          .filter((row) => withTag.every((tag) => row.tags.includes(tag)))
          .sort((a, b) => a.name.localeCompare(b.name));
        return json(route, rows);
      }],
      [/\/queries\/[^/]+$/, byId(queries)],
    ],
  });
  await page.addInitScript(([key, id]) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem(key as string, id as string);
      sessionStorage.setItem('seeded', '1');
    }
  }, [ACTIVE_LIBRARY_KEY, LIBRARY.id]);
}

for (const slowMs of [0, 150, 400]) {
  test(`grouped by tag: a switch opens the first row under the first heading (${slowMs} ms tags)`, async ({ page }) => {
    await setUpTagged(page, slowMs);
    await page.goto(`/queries/${encodeURIComponent(QUERY.id)}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator(`[data-entity-id="${QUERY.id}"]`).first()).toBeVisible();

    await switchTo(page, OTHER);

    await expect(page).toHaveURL(recordUrl('queries', TAGGED_QUERY.id));
    await expect(page.locator('[data-testid="saved-row"]').first()).toHaveAttribute('data-entity-id', TAGGED_QUERY.id);
  });
}

/*
 * Every paged entity screen, grouped by tag, switched from the menu. Each
 * kind has an untagged row that sorts first by name and a tagged row that the
 * list draws first, under its tag heading.
 */
const BASE = {
  description: null,
  currentVersion: null,
  currentVersionNumber: 1,
  dateCreated: '2026-01-01T00:00:00Z',
  dateModified: '2026-01-02T00:00:00Z',
};

type KindCase = {
  section: string;
  path: string;
  /** The library a row is in, as the kind's list route takes and returns it. */
  libraryParam: string;
  make: (id: string, name: string, library: string, tags: string[]) => Record<string, unknown>;
  /** False where the list cannot group by tag; its first row is then the first by name. */
  grouped: boolean;
};

const KIND_CASES: KindCase[] = [
  { section: 'queries', path: 'queries', libraryParam: 'library',
    make: (id, name, library, tags) => ({ ...QUERY, id, name, isPartOf: [library], tags }), grouped: true },
  { section: 'queryGroups', path: 'query-groups', libraryParam: 'library',
    make: (id, name, library, tags) => ({ ...QUERY_GROUP, id, name, isPartOf: library, tags }), grouped: true },
  { section: 'rules', path: 'rule-sets', libraryParam: 'library',
    make: (id, name, library, tags) => ({ ...RULE_SET, id, name, isPartOf: [library], tags }), grouped: true },
  { section: 'dataGraphs', path: 'data-graphs', libraryParam: 'library',
    make: (id, name, library, tags) => ({ ...BASE, id, name, isPartOf: [library], tags }), grouped: true },
  { section: 'tests', path: 'tests', libraryParam: 'library',
    make: (id, name, library, tags) => ({
      ...BASE, id, name, isPartOf: [library], tags, subject: QUERY.id, subjectKind: 'query',
    }), grouped: true },
  { section: 'tupleSets', path: 'tuple-sets', libraryParam: 'library',
    make: (id, name, library, tags) => ({ ...BASE, id, name, isPartOf: [library], tags }), grouped: false },
  { section: 'argumentSets', path: 'argument-sets', libraryParam: 'libraryId',
    make: (id, name, library, tags) => ({
      id, name, description: null, scope: null, targetId: null, libraryId: library, tags,
      currentVersionId: null, currentVersionNumber: 1, tupleBindings: [], scalarBindings: [],
    }), grouped: false },
];

function libraryOf(row: Record<string, unknown>): string {
  return String(([] as unknown[]).concat(row.isPartOf ?? row.libraryId)[0]);
}

for (const kind of KIND_CASES) {
  const title = kind.grouped
    ? 'grouped by tag: a menu switch opens the first row under the first heading'
    : 'not groupable: a menu switch opens the first row by name';
  test(`${kind.section}, ${title}`, async ({ page }) => {
    const start = kind.make(`urn:sqlib:${kind.path}:start`, 'Start row', LIBRARY.id, []);
    const tagged = kind.make(`urn:sqlib:${kind.path}:zeta`, 'Zeta row', OTHER.id, [TAG.id]);
    const untagged = kind.make(`urn:sqlib:${kind.path}:alpha`, 'Alpha row', OTHER.id, []);
    const rows = [start, tagged, untagged];
    const listRoute = new RegExp(`/${kind.path}$`);
    const itemRoute = new RegExp(`/${kind.path}/[^/]+$`);

    await mockEntityApi(page, {
      extraRoutes: [
        [/\/libraries$/, (route) => json(route, [LIBRARY, OTHER, EMPTY])],
        [/\/tags\/counts$/, async (route) => {
          await delay(150);
          const library = new URL(route.request().url()).searchParams.get('library');
          return json(route, library === OTHER.id ? { [TAG.id]: 1 } : {});
        }],
        [/\/tags$/, async (route) => {
          await delay(150);
          const library = new URL(route.request().url()).searchParams.get('library');
          return json(route, library === OTHER.id ? [TAG] : []);
        }],
        [listRoute, async (route) => {
          const params = new URL(route.request().url()).searchParams;
          const library = params.get(kind.libraryParam);
          const withTag = params.getAll('withTag');
          if (withTag.length > 0) await delay(150);
          return json(route, rows
            .filter((row) => !library || libraryOf(row) === library)
            .filter((row) => withTag.every((tag) => (row.tags as string[]).includes(tag)))
            .sort((a, b) => String(a.name).localeCompare(String(b.name))));
        }],
        [itemRoute, byId(rows as Array<{ id: string }>)],
      ],
    });
    await page.addInitScript(([key, id]) => {
      if (!sessionStorage.getItem('seeded')) {
        localStorage.setItem(key as string, id as string);
        sessionStorage.setItem('seeded', '1');
      }
    }, [ACTIVE_LIBRARY_KEY, LIBRARY.id]);

    await page.goto(`/${kind.section}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator(`[data-entity-id="${start.id}"]`).first()).toBeVisible();

    await switchTo(page, OTHER);

    const first = kind.grouped ? tagged : untagged;
    await expect(page).toHaveURL(recordUrl(kind.section, String(first.id)));
    await expect(page.locator('[data-testid="saved-row"]').first()).toHaveAttribute('data-entity-id', String(first.id));
  });
}
