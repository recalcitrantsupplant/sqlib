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

/** A rail section, by the query parameter the rail itself writes. */
export async function openSection(page: Page, section: string): Promise<void> {
  await page.goto(`/?section=${section}`, { waitUntil: 'domcontentloaded' });
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

/** A library's row on the splash, which carries its rename and delete. */
export function splashLibraryRow(page: Page, libraryName: string) {
  return page.locator('.library-row').filter({ hasText: libraryName });
}
