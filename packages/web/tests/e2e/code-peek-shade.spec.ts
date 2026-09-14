/**
 * The peek's shade means one thing: the text carries on past the bottom edge.
 *
 * These two cases are the ones unit specs cannot reach, because both turn on
 * layout. A jsdom body has no height, so `scrollHeight` is `clientHeight` is
 * zero and the measurement that draws the shade never fires; and nothing wraps,
 * which is exactly the case the line count gets wrong.
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import { mockSidebarCollections } from './fixtures/collections';

const library = {
  id: 'urn:sqlib:library:peek',
  name: 'Peek Library',
  description: null,
  defaultBackend: null,
  dateCreated: '2024-01-01T00:00:00Z',
  dateModified: '2024-01-01T00:00:00Z',
};

const ruleSets = [{
  id: 'urn:sqlib:rule-set:peek',
  name: 'Peek rules',
  description: null,
  currentVersion: 'urn:sqlib:rule-set-version:peek-v1',
  isPartOf: [library.id],
  dateCreated: '2024-01-01T00:00:00Z',
  dateModified: '2024-01-01T00:00:00Z',
}];

/*
 * Six rules, blank-separated, written with full IRIs so each one wraps — which
 * is how the fault looked in the app: six rules in a box showing two, with the
 * clip landing on the blank line between them and fading nothing.
 */
const SIX_RULES = Array.from({ length: 6 }, (_, index) =>
  `RULE { ?a <http://www.w3.org/2000/01/rdf-schema#subClassOf${index}> ?c . } ` +
  `WHERE { ?a <http://www.w3.org/2000/01/rdf-schema#subClassOf> ?b . ` +
  `?b <http://www.w3.org/2000/01/rdf-schema#subClassOf> ?c . }`,
).join('\n\n');

/** Two lines, one of them a prefix: nothing to save by hiding half of it. */
const TINY = 'PREFIX : <http://example/>\nRULE { :s :p 2 . } WHERE { :x :xv ?v . }';

const json = (route: Route, body: unknown) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

async function openSubjectPeek(page: Page, srl: string) {
  await mockSidebarCollections(page, { libraries: [library], ruleSets });
  await page.route('**/tests*', async (route: Route) =>
    route.request().method() === 'GET' ? json(route, []) : route.fallback());
  await page.route('**/rule-sets/*/versions*', (route: Route) => json(route, []));
  await page.route('**/rule-sets/*/srl*', (route: Route) => json(route, {
    srl,
    ruleCount: srl.split('\n\n').length,
    dataBlockCount: 0,
    tupleSeeds: '',
    tuplesEnabled: false,
    warnings: [],
  }));
  await page.route('**/data-graphs*', (route: Route) => json(route, []));
  await page.route('**/argument-sets*', (route: Route) => json(route, []));

  await page.goto('/?section=tests&new=test');
  await page.getByTestId('test-subject').click();
  await page.getByTestId('test-subject-option').first().click();
  await expect(page.getByTestId('test-subject-preview')).toBeVisible();
}

test.describe('CodePeek shade', () => {
  test('shades a body that wraps past the edge, though its line count fits', async ({ page }) => {
    await openSubjectPeek(page, SIX_RULES);
    const peek = page.getByTestId('test-subject-preview');

    // Six lines in a six-line box, so the count says nothing is hidden. The
    // wrap is what puts them past the edge, and only measuring finds it.
    await expect(peek.locator('.peek-shade')).toHaveCount(1);
    await expect(page.getByTestId('test-subject-preview-state')).toContainText('click to expand');
  });

  test('drops the blank lines, so the clip lands on ink', async ({ page }) => {
    await openSubjectPeek(page, SIX_RULES);
    const lines = page.getByTestId('test-subject-preview').locator('.cm-line');

    // A fade over a blank line reads as the end of the document — which is what
    // it was saying with four rules still below it.
    for (const text of await lines.allTextContents()) {
      expect(text.trim()).not.toBe('');
    }
  });

  test('shows a document that fits whole, and does not fade it', async ({ page }) => {
    await openSubjectPeek(page, TINY);
    const peek = page.getByTestId('test-subject-preview');

    // The fault: one line of body under a 1.5-line gradient, fading 150% of the
    // content it was drawn over, to say a prefix had been taken off the top.
    await expect(peek).toContainText('PREFIX');
    await expect(peek.locator('.peek-shade')).toHaveCount(0);
    await expect(page.getByTestId('test-subject-preview-state')).toHaveText('');
  });
});
