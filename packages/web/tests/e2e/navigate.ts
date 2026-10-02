/**
 * Getting somewhere, now that the artifact tree is gone.
 *
 * `/` is the splash screen: the app's name, the sections this deployment has,
 * and the libraries. Everything a spec used to reach by expanding the tree —
 * a query, a rule set, a backend, the Add Library dialog — is reached through
 * the rail and the section sidebars instead, and these are the three moves
 * that takes. They live here rather than in each spec because a dozen of them
 * had their own copy of the tree walk and all dozen broke together.
 */
import { expect, type Page } from '@playwright/test';

/** `/`, with the splash rendered. */
export async function openSplash(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="app-splash"]');
}

/** A rail section, at the address the rail itself navigates to. */
export async function openSection(page: Page, section: string): Promise<void> {
  await page.goto(`/${section}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="entity-list-sidebar"]');
}

/** A saved entity, opened from the sidebar of the section that lists it. */
export async function openSavedEntity(page: Page, section: string, entityId: string): Promise<void> {
  await openSection(page, section);
  await page.locator(`[data-entity-id="${entityId}"]`).first().click();
}

/**
 * The Add Library dialog.
 *
 * The library switcher at the head of the rail is the only door to it since
 * the tree went — which is the point of it being there.
 */
export async function openCreateLibraryDialog(page: Page): Promise<void> {
  await page.locator('[data-testid="library-switcher"]').click();
  await page.locator('[data-testid="library-create"]').click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

/**
 * Open the splash's library list, which sits behind the Libraries card.
 *
 * The landing screen leads with the grid: a deployment has a handful of
 * libraries and you pick one and forget it, so the list is a disclosure rather
 * than a block everyone reads past.
 */
export async function openSplashLibraries(page: Page): Promise<void> {
  const panel = page.locator('[data-testid="splash-libraries-panel"]');
  // The card toggles, so a second call would close what the first opened —
  // and a spec that opens the rename dialog twice does exactly that.
  if (await panel.count() === 0) {
    await page.locator('[data-testid="splash-libraries"]').click();
  }
  await expect(panel).toBeVisible();
}

/** A library's row on the splash, which carries its rename and delete. */
export function splashLibraryRow(page: Page, libraryName: string) {
  return page.locator('.library-row').filter({ hasText: libraryName });
}

/*
 * The workspace's addresses (`src/lib/sectionRoutes.ts`): `/<section>` and
 * `/<section>/<record id>`. The id is matched encoded or not, because which
 * the address bar shows is the router's choice, not the app's.
 */
function idPattern(id: string): string {
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return `(?:${escape(id)}|${escape(encodeURIComponent(id))})`;
}

/** The URL of a section, with or without a record open in it. */
export function sectionUrl(section: string): RegExp {
  return new RegExp(`/${section}(?:[/?#]|$)`);
}

/** The URL of one saved record in a section. */
export function recordUrl(section: string, id: string): RegExp {
  return new RegExp(`/${section}/${idPattern(id)}(?:[?#]|$)`);
}

/** The URL of an unsaved record — any, or the one with this id. */
export function scratchUrl(section?: string, id?: string): RegExp {
  const where = section ? `/${section}/` : '/[a-zA-Z]+/';
  return new RegExp(`${where}${id ? idPattern(id) : '(?:urn:ui-temp:|urn%3Aui-temp%3A)'}`);
}
