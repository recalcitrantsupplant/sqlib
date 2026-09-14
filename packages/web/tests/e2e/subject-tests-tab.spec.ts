/**
 * The Tests tab on a callable's own record page.
 *
 * A test names a subject, and until now only the rules screen let you see the
 * tests that name *this* one; from a query or a group you had to go to the
 * Tests section and read every row looking for the subject. The tab is the same
 * entities and the same store, filtered — `SubjectTestsPanel` — so the two
 * views cannot disagree about what exists (#152).
 *
 * What is worth pinning here is the wiring rather than the panel, which has its
 * own unit tests: which screens declare the tab, that each one filters to its
 * own subject, that a row opens the test rather than doing something local, and
 * that a scratch item has no tab at all — a test points at a saved subject, so
 * an unsaved one has no tests and can acquire none.
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import {
  createMockState,
  setupMockApi,
  selectSidebarQuery,
  selectSidebarQueryGroup,
} from './query-group-test-helpers';
import {
  EXISTING_QUERY_ID,
  EXISTING_QUERY_NAME,
  GROUP_ID,
  GROUP_NAME,
  LIBRARY_ID,
  LIBRARY_NAME,
} from './fixtures/query-group-mock-state';

const QUERY_TEST_ID = 'urn:sqlib:test:countries-return-rows';
const QUERY_TEST_NAME = 'Countries query returns rows';
const GROUP_TEST_ID = 'urn:sqlib:test:flow-ends-with-rdf';
const GROUP_TEST_NAME = 'Flow ends with RDF';
const ETL_JOB_ID = 'urn:sqlib:etl-job:orders';
const ETL_TEST_ID = 'urn:sqlib:test:orders-map-decimals';
const ETL_TEST_NAME = 'Orders map DECIMAL columns';

/**
 * A test as `GET /tests` sends it — every field `testSchema` demands, and none
 * it refuses, since the client parses the listing `.strict()`.
 */
function storedTest(id: string, name: string, subject: string, subjectKind: string) {
  return {
    id,
    name,
    description: null,
    subject,
    subjectKind,
    criterion: null,
    currentVersion: `${id}:v1`,
    currentVersionNumber: 1,
    isPartOf: [LIBRARY_ID],
    tags: [],
    dateCreated: '2026-01-01T00:00:00.000Z',
    dateModified: '2026-01-01T00:00:00.000Z',
  };
}

const TESTS = [
  storedTest(QUERY_TEST_ID, QUERY_TEST_NAME, EXISTING_QUERY_ID, 'query'),
  storedTest(GROUP_TEST_ID, GROUP_TEST_NAME, GROUP_ID, 'queryGroup'),
  storedTest(ETL_TEST_ID, ETL_TEST_NAME, ETL_JOB_ID, 'etlJob'),
];

/**
 * One saved pipeline, with no versions.
 *
 * A version would only be needed to fill the SQL editor, which this spec never
 * reads — and `loadEtlJob` skips `applyVersion` entirely when the list is
 * empty. What matters is that the job is *saved*, since that is the whole
 * condition the tab hangs on.
 */
const ETL_JOB = {
  id: ETL_JOB_ID,
  name: 'Orders pipeline',
  description: null,
  currentVersionId: null,
  libraryIds: [LIBRARY_ID],
  dateCreated: '2026-01-01T00:00:00.000Z',
  dateModified: '2026-01-01T00:00:00.000Z',
};

const json = (route: Route, body: unknown) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

/**
 * The group helper models everything but tests, so the listing is registered
 * after it: Playwright matches the most recently registered handler first.
 *
 * The detail and version routes exist because clicking a row *navigates* to the
 * Tests section, and a work area that cannot load its entity is a page error
 * rather than the assertion this spec means to make.
 */
async function bootstrap(page: Page, tests: unknown[] = TESTS, path = '/') {
  const state = createMockState();
  await setupMockApi(page, state);

  await page.route('**/tests*', async (route: Route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const url = new URL(route.request().url());
    // The tab filters client-side off the whole listing, but the route honours
    // `subject` anyway: a mock that ignored a parameter the API implements
    // would let a spec pass against a server that could not answer it.
    const subject = url.searchParams.get('subject');
    const body = subject ? tests.filter((t) => (t as { subject: string }).subject === subject) : tests;
    return json(route, body);
  });
  await page.route('**/tests/*/versions*', (route: Route) => json(route, []));

  // The ETL section is not part of the group helper's world.
  await page.route('**/etl-jobs', (route: Route) =>
    route.request().method() === 'GET' ? json(route, [ETL_JOB]) : route.fallback());
  await page.route('**/etl-jobs/*/versions*', (route: Route) => json(route, []));
  await page.route(/\/etl-jobs\/[^/?]+$/, async (route: Route) =>
    route.request().method() === 'GET' ? json(route, ETL_JOB) : route.fallback());

  await page.route(/\/tests\/[^/?]+$/, async (route: Route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const id = decodeURIComponent(route.request().url().split('/tests/')[1] ?? '');
    const found = tests.find((t) => (t as { id: string }).id === id);
    return found ? json(route, found) : route.fulfill({ status: 404, body: '{}' });
  });

  await page.goto(path);
  await page.waitForLoadState('networkidle');
}

const testsTab = (page: Page) => page.getByTestId('tests-tab');
const testRows = (page: Page) => page.getByTestId('subject-test-row');

test.describe('Tests tab on a callable record page', () => {
  test('a query lists the tests that name it, and not the group’s', async ({ page }) => {
    await bootstrap(page);
    await selectSidebarQuery(page, LIBRARY_NAME, EXISTING_QUERY_NAME);

    await testsTab(page).click();
    await expect(testRows(page)).toHaveCount(1);
    await expect(testRows(page).first()).toContainText(QUERY_TEST_NAME);
    // The verdict is unknown in this session, and "not run" is not a failure.
    await expect(page.getByTestId('subject-test-verdict')).toHaveText('not run');
  });

  test('a query group lists the tests that name it, and not the query’s', async ({ page }) => {
    await bootstrap(page);
    await selectSidebarQueryGroup(page, LIBRARY_NAME, GROUP_NAME);

    await testsTab(page).click();
    await expect(testRows(page)).toHaveCount(1);
    await expect(testRows(page).first()).toContainText(GROUP_TEST_NAME);
  });

  /*
   * ETL ships off by default (#132); CI turns it on at job scope for exactly
   * this reason, and with `ssr: false` the flag is baked into the client bundle
   * at build time — so this needs FEATURE_ETL set for `build.sh`, not only for
   * the run.
   */
  test('a saved ETL pipeline lists the tests that name it', async ({ page }) => {
    await bootstrap(page, TESTS, `/?section=etl&etlJob=${ETL_JOB_ID}`);
    await page.waitForSelector('.etl-playground');

    await testsTab(page).click();
    await expect(testRows(page)).toHaveCount(1);
    await expect(testRows(page).first()).toContainText(ETL_TEST_NAME);
  });

  test('a row opens that test in the Tests section', async ({ page }) => {
    await bootstrap(page);
    await selectSidebarQuery(page, LIBRARY_NAME, EXISTING_QUERY_NAME);

    await testsTab(page).click();
    await testRows(page).first().locator('.test-open').click();

    /*
     * The whole point of the row: the tab says which tests exist, and the
     * Tests section is where one is read or edited. Asserted through the URL
     * because that is what a reload has to reproduce.
     */
    await expect(page).toHaveURL(/section=tests/);
    // Vue Router leaves the IRI's colons alone, so the id is matched as written.
    await expect(page).toHaveURL(new RegExp(`test=${QUERY_TEST_ID}`));
  });

  test('says so when nothing tests this subject', async ({ page }) => {
    await bootstrap(page, [TESTS[1]]);
    await selectSidebarQuery(page, LIBRARY_NAME, EXISTING_QUERY_NAME);

    await testsTab(page).click();
    await expect(testRows(page)).toHaveCount(0);
    await expect(page.getByTestId('subject-tests-empty')).toContainText('No tests yet');
  });

  test('a scratch query has no Tests tab at all', async ({ page }) => {
    await bootstrap(page, TESTS, '/?section=queries');
    await page.waitForSelector('[data-testid="entity-list-sidebar"]');
    await page.getByTestId('new-scratch').click();
    await page.waitForSelector('.query-work-area');

    /*
     * Absent rather than empty: a test names a saved subject, so a scratch
     * query has no tests and cannot acquire one until it is saved. A tab that
     * could only ever say "none" is a tab that has to be clicked to learn
     * nothing.
     */
    await expect(page.getByTestId('details-tab')).toBeVisible();
    await expect(testsTab(page)).toHaveCount(0);
  });
});
