import { test, expect, type Page, type Request } from '@playwright/test';
import {
  ARGUMENT_SET_CITY,
  ARGUMENT_SET_COUNTRY,
  ARGUMENT_SET_NAME,
  ARGUMENT_SET_VERSION_ID,
  bootstrapQueryGroupCanvas,
  FOREIGN_ARGUMENT_SET_NAME,
  GROUP_ID,
  GROUP_NAME,
  LIBRARY_NAME,
  selectSidebarQueryGroup,
} from './query-group-test-helpers';

/*
 * Argument-set authoring and parameterised execution (#47 item 4).
 *
 * The flows before this one all ran the group with nothing in it. A group's
 * arguments are the other half of running one: what the caller supplies, where
 * a query gets its signature from detected VALUES clauses and a group gets it
 * from the input tuples its **start node** declares. Same panel, same
 * composable, same three lives (scratch → draft → saved version) — and one
 * thing that is only true here, which is what these specs are for: which of
 * the two shapes `POST /execute` accepts a run takes, and when.
 *
 * The mock grew the `/argument-sets` routes for this; nothing had ever asked
 * it for one. Its answers are checked by the client's own Zod parse rather than
 * by these assertions: a response of the wrong shape throws inside
 * `useApiClient` and the panel renders empty, so a spec that sees values at all
 * has already proved the shape.
 */

const switcher = (page: Page) => page.locator('[data-testid="argument-set-switcher"]');
const setState = (page: Page) => page.locator('[data-testid="argument-set-state"]');
const clauses = (page: Page) => page.locator('[data-testid="argument-clause"]');
const values = (page: Page) => page.locator('[data-testid="argument-value"]');
const saveArguments = (page: Page) => page.locator('[data-testid="arguments-save"]');

const openGroupArguments = async (page: Page) => {
  await selectSidebarQueryGroup(page, LIBRARY_NAME, GROUP_NAME);
  await page.locator('.vue-flow__node').first().waitFor();
  await page.getByRole('button', { name: 'Arguments', exact: true }).click();
  await expect(switcher(page)).toBeVisible();
};

const startScratchSet = async (page: Page) => {
  await switcher(page).click();
  await page.locator('[data-testid="argument-new-scratch"]').click();
  await expect(setState(page)).toHaveText('Scratch');
};

const chooseSavedSet = async (page: Page, name: string) => {
  await switcher(page).click();
  await page.locator('.set-row').filter({ hasText: name }).click();
  await expect(switcher(page)).toContainText(name);
};

/** One row of city/country, typed into the clause the start node declares. */
const fillOneRow = async (page: Page, city: string, country: string) => {
  await page.locator('[data-testid="argument-add-row"]').click();
  await values(page).nth(0).fill(city);
  await values(page).nth(1).fill(country);
  // The panel debounces its writes to the local draft, and the run reads that.
  await expect(values(page).nth(1)).toHaveValue(country);
};

const executeRequest = (page: Page) =>
  page.waitForRequest(
    (request: Request) => request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/execute'),
  );

const runGroup = async (page: Page) => {
  const request = executeRequest(page);
  await page.getByTestId('run-bar-run').click();
  return (await request).postDataJSON();
};

test.describe('Query group arguments (mocked)', () => {
  test('the signature is the start node’s input tuples, not detected VALUES', async ({ page }) => {
    await bootstrapQueryGroupCanvas(page);
    await openGroupArguments(page);

    // Nothing is selected on open, and the panel says so rather than picking
    // the one saved set for you — running with values nobody chose is worse
    // than running with none.
    await expect(switcher(page)).toHaveText(/No argument set/);
    await expect(page.getByText('No argument set open')).toBeVisible();

    await startScratchSet(page);

    /*
     * One clause, over the two variables `Start Params` carries. A query would
     * get this from `POST /detection/inputs` over its text; a group has no text
     * to detect, and the start node is the declaration.
     */
    await expect(clauses(page)).toHaveCount(1);
    await expect(clauses(page).first()).toContainText('VALUES (?city ?country)');

    /*
     * An empty set is "no values" until it has some — useless against a group
     * that asks for a tuple, rather than wrong (`compatibility`). Typing a row
     * is what makes the verdict, and the verdict is computed against the start
     * node's declaration, so this is the group's signature answering.
     */
    await expect(page.locator('.signature-verdict')).toHaveText('no values');
    await fillOneRow(page, 'https://example.org/city/perth', 'https://example.org/country/au');
    await expect(page.locator('.signature-verdict')).toHaveText('matches the group signature');
  });

  test('a set authored here is created on the group, and comes back as its v1', async ({ page }) => {
    await bootstrapQueryGroupCanvas(page);
    await openGroupArguments(page);
    await startScratchSet(page);
    await fillOneRow(page, 'https://example.org/city/hobart', 'https://example.org/country/au');

    const created = page.waitForRequest(
      (request: Request) =>
        request.method() === 'POST'
        && new URL(request.url()).pathname.endsWith('/argument-sets'),
    );
    await expect(saveArguments(page)).toHaveText('Save v1');
    await saveArguments(page).click();

    // Posted to the group's own collection: that path is the whole of the set's
    // provenance, since the body carries neither a scope nor a target.
    const request = await created;
    expect(new URL(request.url()).pathname).toContain(encodeURIComponent(GROUP_ID));
    const body = request.postDataJSON();
    expect(body.name).toBeTruthy();
    expect(body.tupleBindings).toHaveLength(1);
    expect(body.tupleBindings[0].variables).toEqual(['city', 'country']);
    expect(body.tupleBindings[0].rows[0].values.city.value).toBe('https://example.org/city/hobart');

    // v1, and the body now reads from the server's copy rather than the draft:
    // the footer is gone because there is nothing unsaved left.
    await expect(setState(page)).toHaveText('v1');
    await expect(saveArguments(page)).toHaveCount(0);
    await expect(values(page).nth(0)).toHaveValue('https://example.org/city/hobart');
  });

  test('a saved set runs by id — the values stay on the server', async ({ page }) => {
    await bootstrapQueryGroupCanvas(page);
    await openGroupArguments(page);
    await chooseSavedSet(page, ARGUMENT_SET_NAME);

    await expect(setState(page)).toHaveText('v1');
    await expect(values(page).nth(0)).toHaveValue(ARGUMENT_SET_CITY);
    await expect(values(page).nth(1)).toHaveValue(ARGUMENT_SET_COUNTRY);

    const payload = await runGroup(page);
    /*
     * The version id, not the set id: a run names the immutable thing, so the
     * same call means the same rows tomorrow. And no inline `arguments` beside
     * it — `/execute` rejects both together, and the panel picks one.
     */
    expect(payload.argumentSetIds).toEqual([ARGUMENT_SET_VERSION_ID]);
    expect(payload.arguments).toBeUndefined();
  });

  test('a scratch set runs its values inline — there is no id to name yet', async ({ page }) => {
    await bootstrapQueryGroupCanvas(page);
    await openGroupArguments(page);
    await startScratchSet(page);
    await fillOneRow(page, 'https://example.org/city/perth', 'https://example.org/country/au');

    const payload = await runGroup(page);
    expect(payload.argumentSetIds).toBeUndefined();
    expect(payload.arguments).toEqual([
      {
        head: { vars: ['city', 'country'] },
        arguments: {
          bindings: [
            {
              city: { type: 'uri', value: 'https://example.org/city/perth' },
              country: { type: 'uri', value: 'https://example.org/country/au' },
            },
          ],
        },
      },
    ]);
  });

  test('editing a saved set runs the edit, not the version it came from', async ({ page }) => {
    await bootstrapQueryGroupCanvas(page);
    await openGroupArguments(page);
    await chooseSavedSet(page, ARGUMENT_SET_NAME);
    await expect(setState(page)).toHaveText('v1');

    await values(page).nth(0).fill('https://example.org/city/broome');
    // The first keystroke on a clean set opens a draft, and the draft is what
    // runs: naming v1 would execute rows that are no longer on screen.
    await expect(setState(page)).toHaveText('Draft');

    const payload = await runGroup(page);
    expect(payload.argumentSetIds).toBeUndefined();
    expect(payload.arguments[0].arguments.bindings[0].city.value).toBe('https://example.org/city/broome');

    // Both are still on offer, and pointing Run with back at v1 restores the id
    // form — the run target moves without the body being retyped.
    await expect(page.locator('[data-testid="argument-run-option"]')).toHaveText(['Draft', 'v1']);
  });

  test('sets made elsewhere in the library are offered too, with what they would not fill', async ({ page }) => {
    await bootstrapQueryGroupCanvas(page);
    await openGroupArguments(page);
    await switcher(page).click();

    /*
     * Scope is provenance, not a fence: a set made on the query next door is
     * listed here, because the switcher's job is to say what could run this
     * group. What stops the wrong one being picked by accident is the verdict
     * beside it — one `city` column cannot fill a two-variable tuple.
     */
    const foreign = page.locator('.set-row').filter({ hasText: FOREIGN_ARGUMENT_SET_NAME });
    await expect(foreign).toHaveCount(1);
    await expect(foreign).toContainText('arity 1 ≠ 2');
    await expect(page.locator('.set-row').filter({ hasText: ARGUMENT_SET_NAME }))
      .not.toContainText('arity');
  });

  test('the Code tab opens on the call the group would actually make', async ({ page }) => {
    await bootstrapQueryGroupCanvas(page);
    await openGroupArguments(page);
    await chooseSavedSet(page, ARGUMENT_SET_NAME);

    // The snippet is the same decision Execute makes, written down: a saved
    // version is named by id, so the caller does not carry the values.
    await page.getByRole('button', { name: 'Code', exact: true }).click();
    await expect(page.locator('[data-testid="code-variant-stored"]')).toHaveClass(/active/);
    await expect(page.locator('[data-testid="code-snippet"]')).toContainText(ARGUMENT_SET_VERSION_ID);

    // Inline is still offered — the choice is the caller's — and it carries the
    // values the panel is showing rather than an id.
    await page.locator('[data-testid="code-variant-inline"]').click();
    await expect(page.locator('[data-testid="code-snippet"]')).toContainText(ARGUMENT_SET_CITY);
    await expect(page.locator('[data-testid="code-snippet"]')).not.toContainText('argumentSetIds');
  });

  test('a set saved here is offered again after leaving the group and coming back', async ({ page }) => {
    await bootstrapQueryGroupCanvas(page);
    await openGroupArguments(page);
    await startScratchSet(page);
    await fillOneRow(page, 'https://example.org/city/darwin', 'https://example.org/country/au');
    await saveArguments(page).click();
    await expect(setState(page)).toHaveText('v1');

    // A reload throws the whole client away, drafts included — what the
    // switcher offers now is what the server holds and nothing else.
    await page.reload();
    await page.waitForLoadState('networkidle');
    await openGroupArguments(page);

    await chooseSavedSet(page, 'Untitled set');
    await expect(setState(page)).toHaveText('v1');
    await expect(values(page).nth(0)).toHaveValue('https://example.org/city/darwin');

    // And it runs by id from here, exactly as the seeded one does — a set is
    // not a different thing for having been authored in this session.
    const payload = await runGroup(page);
    expect(payload.argumentSetIds).toHaveLength(1);
    expect(payload.arguments).toBeUndefined();
  });
});
