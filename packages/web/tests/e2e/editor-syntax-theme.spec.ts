import { test, expect, type Page, type Route } from '@playwright/test';
import { mockSidebarCollections } from './fixtures/collections';

/**
 * Editor syntax highlighting follows the app theme, and uses the RDF tokens.
 *
 * `assets/css/codemirror-theme.css` styles the editor *chrome* from tokens, so
 * that already followed the theme; syntax colours could not, because CodeMirror
 * emits them under generated class names (`.ͼ1`, `.ͼ2`, …) that no CSS selector
 * can reach. `src/lib/codemirrorHighlight.ts` fixes that with a HighlightStyle
 * whose colours are `var(--…)` references, so the browser re-resolves them when
 * `.dark` goes on the root. See issue #35.
 *
 * This asserts the mechanism end to end rather than the shade: a token's painted
 * colour must equal what `tokens.css` currently says, in both themes — which
 * catches the style being dropped, out-lived by the default one, or resolved
 * once at build time.
 */

const LIBRARY = {
  id: 'urn:sqlib:library:test-1',
  name: 'Test Library',
  description: 'A test library',
  defaultBackend: null,
  dateCreated: '2024-01-01T00:00:00Z',
  dateModified: '2024-01-01T00:00:00Z',
};

/** The value `tokens.css` resolves a custom property to, right now, in the browser. */
const token = (page: Page, name: string) =>
  page.evaluate(
    (prop) => getComputedStyle(document.documentElement).getPropertyValue(prop).trim(),
    name,
  );

/**
 * The painted colour of the first editor token whose text matches.
 *
 * By text rather than by class: the classes are the generated ones this test
 * exists because of. CodeMirror splits a document into one span per styled
 * range, so `<http://example.org/p>` is its own span.
 */
async function tokenColor(page: Page, text: string): Promise<string> {
  const span = page.locator('.cm-content span', { hasText: text }).last();
  await expect(span).toBeVisible();
  return span.evaluate((el) => getComputedStyle(el).color);
}

/** `color` comes back as `rgb(r, g, b)`; tokens are authored as hex or a var. */
async function resolvedTokenColor(page: Page, name: string): Promise<string> {
  const value = await token(page, name);
  return page.evaluate((color) => {
    const probe = document.createElement('span');
    probe.style.color = color;
    document.body.appendChild(probe);
    const painted = getComputedStyle(probe).color;
    probe.remove();
    return painted;
  }, value);
}

const setTheme = (page: Page, dark: boolean) =>
  page.evaluate((on) => document.documentElement.classList.toggle('dark', on), dark);

test.describe('Editor syntax highlighting', () => {
  test.beforeEach(async ({ page }) => {
    await mockSidebarCollections(page);
    await page.addInitScript(() => {
      window.localStorage.setItem('sparql-query-lib-scratch-migrated', '2026-08-06T00:00:00Z');
    });
    await page.route('**//localhost:3000/libraries', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([LIBRARY]) });
    });
    await page.route('**//localhost:3000/queries', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
    });

    await page.goto('/?section=queries', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="entity-list-sidebar"]');

    const editor = page.locator('.cm-content');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('SELECT ?s WHERE { ?s <http://example.org/p> "lit" }');
    await expect(editor).toContainText('example.org');
  });

  test('paints RDF terms with the RDF tokens, not CodeMirror defaults', async ({ page }) => {
    await setTheme(page, false);

    expect(await tokenColor(page, 'http://example.org/p')).toBe(await resolvedTokenColor(page, '--rdf-iri'));
    expect(await tokenColor(page, '?s')).toBe(await resolvedTokenColor(page, '--rdf-var'));
    expect(await tokenColor(page, 'lit')).toBe(await resolvedTokenColor(page, '--rdf-literal'));
    expect(await tokenColor(page, 'SELECT')).toBe(await resolvedTokenColor(page, '--syntax-keyword'));
  });

  test('re-paints when the theme flips, without rebuilding the editor', async ({ page }) => {
    await setTheme(page, false);
    const lightIri = await tokenColor(page, 'http://example.org/p');
    const lightVar = await tokenColor(page, '?s');

    await setTheme(page, true);
    const darkIri = await tokenColor(page, 'http://example.org/p');

    // The point of the fix: same editor, same document, different colour.
    expect(darkIri).not.toBe(lightIri);
    expect(darkIri).toBe(await resolvedTokenColor(page, '--rdf-iri'));
    expect(await tokenColor(page, '?s')).not.toBe(lightVar);
    expect(await tokenColor(page, '?s')).toBe(await resolvedTokenColor(page, '--rdf-var'));
  });
});
