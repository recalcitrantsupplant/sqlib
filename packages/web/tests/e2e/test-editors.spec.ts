/**
 * The tests screen reads its documents as documents.
 *
 * Three things this covers, all of which were textareas and `<pre>` blocks
 * before: a subject's rules render as highlighted code; the peek over them
 * opens on what the document *says* rather than on its prologue, and expands to
 * the whole thing on a click; and the named-tuples box follows the rule set's
 * own `tuplesEnabled` rather than being offered to every rule set.
 *
 * Also the subject chooser's own geometry. Its menu is an ordinary
 * absolutely-positioned element, so a menu that escapes the panel turns the
 * panel into a horizontal scroller — and reka scrolling a highlighted row into
 * view then drags the whole column sideways and cuts the section labels off the
 * left. That is what "renders funny" was.
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import { mockSidebarCollections } from './fixtures/collections';

const library = {
  id: 'urn:sqlib:library:editors',
  name: 'Editors Library',
  description: null,
  defaultBackend: null,
  dateCreated: '2024-01-01T00:00:00Z',
  dateModified: '2024-01-01T00:00:00Z',
};

/*
 * Long names on purpose: they are what made the menu want to be wider than the
 * field it hangs from, which is the shape the overflow bug needed.
 */
const ruleSets = Array.from({ length: 12 }, (_, index) => ({
  id: `urn:sqlib:rule-set:editors-${index}`,
  name: `Reachability rules ${index} — transitive closure over :knows`,
  description: null,
  currentVersion: `urn:sqlib:rule-set-version:editors-${index}-v1`,
  isPartOf: [library.id],
  dateCreated: '2024-01-01T00:00:00Z',
  dateModified: '2024-01-01T00:00:00Z',
}));

const SRL = [
  'PREFIX : <http://example/>',
  'PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>',
  'PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>',
  '',
  'RULE reach {',
  '  CONSTRUCT { ?a :reaches ?b }',
  '  WHERE { ?a :edge ?b }',
  '}',
].join('\n');

const json = (route: Route, body: unknown) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

async function mockTestsScreen(page: Page, { tuplesEnabled }: { tuplesEnabled: boolean }) {
  await mockSidebarCollections(page, { libraries: [library], ruleSets });
  await page.route('**/tests*', async (route: Route) =>
    route.request().method() === 'GET' ? json(route, []) : route.fallback());
  await page.route('**/rule-sets/*/versions*', (route: Route) => json(route, []));
  await page.route('**/rule-sets/*/srl*', (route: Route) => json(route, {
    srl: SRL,
    ruleCount: 1,
    dataBlockCount: 0,
    tupleSeeds: '',
    tuplesEnabled,
    warnings: [],
  }));
  await page.route('**/data-graphs*', (route: Route) => json(route, []));
  await page.route('**/argument-sets*', (route: Route) => json(route, []));
}

/** Open the subject chooser and take the first rule set it offers. */
async function chooseFirstSubject(page: Page) {
  await page.getByTestId('test-subject').click();
  await page.getByTestId('test-subject-option').first().click();
  await expect(page.getByTestId('test-subject-preview')).toBeVisible();
}

test.describe('Tests screen editors', () => {
  test('peeks past the prologue, and expands to the whole document', async ({ page }) => {
    await mockTestsScreen(page, { tuplesEnabled: false });
    await page.goto('/?section=tests&new=test');
    await chooseFirstSubject(page);

    const peek = page.getByTestId('test-subject-preview');
    const state = page.getByTestId('test-subject-preview-state');

    // Collapsed: the three PREFIX lines are gone and the header says so, so
    // the few lines on offer are spent on what this rule set actually does.
    await expect(state).toHaveText(/3 prefixes hidden · click to expand/);
    await expect(peek).toContainText('RULE reach');
    await expect(peek).not.toContainText('rdf-schema');

    // The code is highlighted rather than being one grey block: `:reaches` is
    // an IRI and is painted as one.
    await expect(peek.locator('.cm-line').first()).toBeVisible();

    // Clicking the body — not just the chevron — opens it, because the whole
    // peek is the affordance.
    await page.getByTestId('test-subject-preview-peek').click();
    await expect(state).toHaveText('8 lines');
    await expect(peek).toContainText('rdf-schema');
  });

  test('offers named tuples only to a rule set that uses them', async ({ page }) => {
    await mockTestsScreen(page, { tuplesEnabled: false });
    await page.goto('/?section=tests&new=test');
    await chooseFirstSubject(page);

    // Absent rather than disabled, with nothing standing in its place: the
    // switch that would change this lives on the rule set, not here.
    await expect(page.getByTestId('test-tuple-seeds')).toHaveCount(0);
  });

  test('offers named tuples when the rule set does use them', async ({ page }) => {
    await mockTestsScreen(page, { tuplesEnabled: true });
    await page.goto('/?section=tests&new=test');
    await chooseFirstSubject(page);

    await expect(page.getByTestId('test-tuple-seeds')).toBeVisible();
  });

  test('puts the inputs above the subject document', async ({ page }) => {
    await mockTestsScreen(page, { tuplesEnabled: true });
    await page.goto('/?section=tests&new=test');
    await chooseFirstSubject(page);

    // What goes in, then the thing it goes into, then what should come out.
    const inputs = await page.getByTestId('test-data-graph').boundingBox();
    const document = await page.getByTestId('test-subject-preview').boundingBox();
    const expectation = await page.getByTestId('test-expected').boundingBox();
    expect(inputs!.y).toBeLessThan(document!.y);
    expect(document!.y).toBeLessThan(expectation!.y);
  });

  test('opens the subject menu under its field, without moving the panel', async ({ page }) => {
    await mockTestsScreen(page, { tuplesEnabled: false });
    await page.goto('/?section=tests&new=test');

    const field = page.getByTestId('test-subject');
    await expect(field).toBeVisible();
    await field.click();
    await expect(page.getByTestId('test-subject-option').first()).toBeVisible();

    const fieldBox = (await field.boundingBox())!;
    const menuBox = (await page.locator('.search-select__menu').boundingBox())!;

    // Hanging off the field, not off the viewport: the menu once rendered
    // full-width at the bottom of the page because its positioning context
    // was missing.
    expect(Math.abs(menuBox.x - fieldBox.x)).toBeLessThan(2);
    expect(Math.abs(menuBox.width - fieldBox.width)).toBeLessThan(2);
    expect(menuBox.y).toBeGreaterThan(fieldBox.y);

    // And the panel it lives in has nothing to scroll sideways, so nothing
    // can drag it there.
    const column = await page.evaluate(() => {
      const element = document.querySelector('.editor-column') as HTMLElement;
      return { scrollLeft: element.scrollLeft, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
    });
    expect(column.scrollLeft).toBe(0);
    expect(column.scrollWidth).toBeLessThanOrEqual(column.clientWidth);
  });

  /*
   * reka's listbox filter binds Home and End on the input and calls
   * preventDefault, so the ordinary way to wipe a filter — select to the start,
   * type over it — did nothing in a chooser.
   */
  test('leaves Home and End to the text box, so Shift+Home selects what you typed', async ({ page }) => {
    await mockTestsScreen(page, { tuplesEnabled: false });
    await page.goto('/?section=tests&new=test');

    const field = page.getByTestId('test-subject');
    await field.click();
    await field.fill('reach');

    await field.press('Shift+Home');
    const selected = await field.evaluate((element) => {
      const input = element as HTMLInputElement;
      return input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0);
    });
    expect(selected).toBe('reach');

    // And typing over that selection replaces it, which is the point of making it.
    await field.press('d');
    await expect(field).toHaveValue('d');
  });

  test('gives the subject field the same box as the fields beside it', async ({ page }) => {
    await mockTestsScreen(page, { tuplesEnabled: false });
    await page.goto('/?section=tests&new=test');
    await chooseFirstSubject(page);

    // It used to carry a `control` class defined only in the caller's scoped
    // stylesheet, so it rendered with no border at the browser's default
    // height beside two fields that had both. Measured against the expectation
    // select, which is still a plain `control` — the graph, backend and
    // argument-set fields are choosers like this one now, so measuring against
    // one of those would only prove the component matches itself.
    const control = await page.getByTestId('test-expectation-kind').boundingBox();
    const subject = await page.getByTestId('test-subject').boundingBox();
    expect(Math.abs(subject!.height - control!.height)).toBeLessThan(2);

    const border = await page.getByTestId('test-subject').evaluate(
      (element) => getComputedStyle(element).borderTopWidth,
    );
    expect(border).not.toBe('0px');
  });
});
