import { test, expect, type Page, type Route } from '@playwright/test';
import { mockEntityApi, QUERY } from './fixtures/entities';

/**
 * The Arguments tab, as argument sets became versioned entities.
 *
 * The assertions worth making are the ones the redesign turns on: a set has a
 * scratch life before it has a name on the server, saving it is one button
 * rather than Save-then-New-Version-then-Freeze, and `Run with` — not a pin
 * checkbox — decides what executes.
 */

/** A query with one VALUES clause and a LIMIT parameter to fill. */
const DETECTED = {
  valuesInputs: [['city']],
  limitParameters: ['pageSize'],
  offsetParameters: [],
  correlatedExistsInputs: [],
};

type StoredBody = { tupleBindings?: unknown[]; scalarBindings?: unknown[] };
type StoredSet = ReturnType<typeof argumentSet>;

let created: StoredSet[] = [];
let versionPatches: unknown[] = [];

const switcher = (page: Page) => page.locator('[data-testid="argument-set-switcher"]');
const state = (page: Page) => page.locator('[data-testid="argument-set-state"]');
const save = (page: Page) => page.locator('[data-testid="arguments-save"]');
const discard = (page: Page) => page.locator('[data-testid="arguments-discard"]');
const runOptions = (page: Page) => page.locator('[data-testid="argument-run-option"]');
const values = (page: Page) => page.locator('[data-testid="argument-value"]');

function argumentSet(name: string, id: string, body: StoredBody = {}) {
  const version = {
    id: `${id}:v1`,
    isPartOf: id,
    version: 1,
    // Frozen on create, like every other version the library stores.
    immutable: true,
    tupleBindings: body.tupleBindings ?? [],
    scalarBindings: body.scalarBindings ?? [],
    dateCreated: '2026-08-14T00:00:00Z',
    dateModified: '2026-08-14T00:00:00Z',
  };
  return {
    id,
    name,
    description: null,
    scope: 'query' as const,
    targetId: QUERY.id,
    currentVersionId: version.id,
    currentVersion: version,
    tupleBindings: version.tupleBindings,
    scalarBindings: version.scalarBindings,
    dateCreated: '2026-08-14T00:00:00Z',
    dateModified: '2026-08-14T00:00:00Z',
  };
}

async function openArguments(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.nav-sidebar');
  await page.locator('.library-toggle').first().click();
  await page.locator('.category-header').filter({ hasText: 'Queries' }).first().click();
  await page.locator('.item-button').filter({ hasText: QUERY.name }).first().click();
  await expect(page.locator('.query-work-area')).toBeVisible();
  await page.locator('[data-testid="arguments-tab"]').click();
}

async function startScratchSet(page: Page) {
  await switcher(page).click();
  await page.locator('[data-testid="argument-new-scratch"]').click();
  await expect(state(page)).toHaveText('Scratch');
}

test.describe('Query arguments', () => {
  test.beforeEach(async ({ page }) => {
    created = [];
    versionPatches = [];

    await mockEntityApi(page, {
      extraRoutes: [
        [/\/detect-inputs$/, async (route: Route) => {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(DETECTED),
          });
        }],
        [/\/argument-sets\/[^/]+\/v\/\d+$/, async (route: Route) => {
          if (route.request().method() === 'PATCH') {
            versionPatches.push(route.request().postDataJSON());
          }
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(created.at(-1)?.currentVersion ?? null),
          });
        }],
        [/\/argument-sets\/[^/]+\/v$/, async (route: Route) => {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(created.at(-1) ? [created.at(-1).currentVersion] : []),
          });
        }],
        [/\/argument-sets\/[^/]+$/, async (route: Route) => {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(created.at(-1) ?? null),
          });
        }],
        [/\/queries\/[^/]+\/argument-sets$/, async (route: Route) => {
          if (route.request().method() === 'POST') {
            const body = route.request().postDataJSON() as StoredBody & { name: string };
            const set = argumentSet(body.name, `urn:sqlib:argument-set:${created.length + 1}`, body);
            created.push(set);
            await route.fulfill({
              status: 201,
              contentType: 'application/json',
              body: JSON.stringify(set),
            });
            return;
          }
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(created),
          });
        }],
      ],
    });

    await openArguments(page);
  });

  test('opens with no set, and says so rather than inventing one', async ({ page }) => {
    await expect(switcher(page)).toHaveText(/No argument set/);
    // Nothing to discard or save when there is nothing unsaved.
    await expect(save(page)).toHaveCount(0);
    await expect(discard(page)).toHaveCount(0);
  });

  test('the body is the query signature — scalars and each VALUES clause', async ({ page }) => {
    await startScratchSet(page);
    await expect(page.locator('.arguments-content .scalars')).toContainText('LIMIT');
    await expect(page.locator('.arguments-content .col-name input')).toHaveValue('pageSize');
    await expect(page.locator('[data-testid="argument-clause"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="argument-clause"]')).toContainText('VALUES ?city');
  });

  test('a scratch set lives in the browser until it is saved', async ({ page }) => {
    await startScratchSet(page);
    await expect(page.locator('.arguments-content, .tab-pane').getByText('lives in this browser').first()).toBeVisible();
    await page.locator('[data-testid="argument-add-row"]').click();
    await values(page).first().fill('http://example.org/perth');

    const stored = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem('sparql-query-lib-argument-set-drafts') ?? '[]'),
    );
    expect(stored).toHaveLength(1);
    expect(stored[0].kind).toBe('scratch');
    expect(stored[0].tupleBindings[0].rows[0].values.city.value).toBe('http://example.org/perth');
  });

  test('Save v1 creates the set and its version in one call', async ({ page }) => {
    await startScratchSet(page);
    await page.locator('[data-testid="argument-add-row"]').click();
    await values(page).first().fill('http://example.org/perth');

    await expect(save(page)).toHaveText('Save v1');
    await save(page).click();

    await expect(state(page)).toHaveText('v1');
    expect(created).toHaveLength(1);
    // No freeze round-trip. Saving used to create the version and then
    // PATCH it immutable, because the server created it mutable and refused to
    // execute it that way; versions are frozen on create now, so the create is
    // the whole save.
    expect(versionPatches).toEqual([]);
    // Nothing unsaved left, so the footer goes away.
    await expect(save(page)).toHaveCount(0);

    const stored = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem('sparql-query-lib-argument-set-drafts') ?? '[]'),
    );
    expect(stored).toEqual([]);
  });

  test('Run with offers the draft and every saved version, never a freeze', async ({ page }) => {
    await startScratchSet(page);
    await page.locator('[data-testid="argument-add-row"]').click();
    await values(page).first().fill('http://example.org/perth');
    await save(page).click();
    await expect(state(page)).toHaveText('v1');

    // Editing a saved set opens a draft, and Run with grows the option.
    await values(page).first().fill('http://example.org/hobart');
    await expect(state(page)).toHaveText('Draft');
    await expect(runOptions(page)).toHaveText(['Draft', 'v1']);

    await expect(page.getByText('Freeze')).toHaveCount(0);
    await expect(page.getByText(/freeze it before executing/i)).toHaveCount(0);
    await expect(page.getByText('Pin for execution')).toHaveCount(0);
  });

  test('Discard throws the draft away and leaves the saved version standing', async ({ page }) => {
    await startScratchSet(page);
    await page.locator('[data-testid="argument-add-row"]').click();
    await values(page).first().fill('http://example.org/perth');
    await save(page).click();
    await expect(state(page)).toHaveText('v1');

    await values(page).first().fill('http://example.org/hobart');
    await expect(state(page)).toHaveText('Draft');
    await discard(page).click();

    await expect(state(page)).toHaveText('v1');
    await expect(discard(page)).toHaveCount(0);
  });
});
