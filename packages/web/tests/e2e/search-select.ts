import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Driving a `SearchSelect` — the fuzzy chooser that replaced the app's
 * `<select>` entity pickers.
 *
 * A chooser is a text box plus an inline menu, not a native select, so
 * `selectOption` does not apply: you click it open (or type to filter) and
 * click the row you want. These helpers keep that dance in one place, keyed by
 * the chooser's `test-id`, so a spec reads the way it did before.
 */

/** The chooser's text box, which is also what shows the current label. */
export function searchSelect(scope: Page | Locator, testId: string): Locator {
  return scope.getByTestId(testId);
}

/** Its option rows. Rendered only while the menu is open. */
export function searchSelectOptions(scope: Page | Locator, testId: string): Locator {
  return scope.getByTestId(`${testId}-option`);
}

/** Open the menu and return the rows, now visible. */
export async function openSearchSelect(scope: Page | Locator, testId: string): Promise<Locator> {
  await searchSelect(scope, testId).click();
  const options = searchSelectOptions(scope, testId);
  await expect(options.first()).toBeVisible();
  return options;
}

/**
 * Choose the row whose label is exactly `label`. Exact rather than substring
 * so "None" cannot pick "None of the above", the way `selectOption` behaved.
 */
export async function chooseSearchOption(
  scope: Page | Locator,
  testId: string,
  label: string,
): Promise<void> {
  await openSearchSelect(scope, testId);
  await searchSelectOptions(scope, testId).filter({ hasText: new RegExp(`^${escapeRegExp(label)}$`) })
    .first()
    .click();
}

/** Type into the chooser's filter, then take the best-ranked row. */
export async function filterAndChooseFirst(
  scope: Page | Locator,
  testId: string,
  query: string,
): Promise<void> {
  const input = searchSelect(scope, testId);
  await input.click();
  await input.fill(query);
  const options = searchSelectOptions(scope, testId);
  await expect(options.first()).toBeVisible();
  await options.first().click();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
