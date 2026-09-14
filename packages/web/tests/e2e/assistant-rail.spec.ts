import { test, expect, type Page, type Route } from '@playwright/test';
import { mockCallableLibrary } from './fixtures/callables';

/**
 * The Build screen's chat rail, against a mocked assistant stream.
 *
 * The claim under test is the one door A exists for: the conversation sits next
 * to the thing it edits, and what it writes appears beside you as a draft that
 * you save. Not that the chat is good — that is the model's business, and
 * door B gets the same model.
 */

const PROVIDER_KEY = 'sparql-query-lib-assistant-provider';
const DRAFTS_KEY = 'sparql-query-lib-callable-drafts';

/** Serialise events the way the server does, so the client's parser is exercised. */
function sseBody(events: Array<Record<string, unknown>>): string {
  return events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
}

async function mockAssistant(page: Page, events: Array<Record<string, unknown>>) {
  await page.route('**/assistant/sessions', async (route: Route) => {
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'session-test', createdAt: '2026-08-08T00:00:00Z', libraryId: null }),
    });
  });
  await page.route('**/assistant/sessions/*/messages', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: sseBody(events) });
  });
}

async function configureProvider(page: Page) {
  await page.addInitScript(
    ([key, value]: string[]) => window.localStorage.setItem(key!, value!),
    [PROVIDER_KEY, JSON.stringify({ provider: 'anthropic', model: 'claude-opus-5', apiKey: 'sk-test', baseUrl: '' })]
  );
}

async function openBuild(page: Page) {
  await page.goto('/build', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.chat-rail');
}

test.describe('Build assistant rail', () => {
  test.beforeEach(async ({ page }) => {
    await mockCallableLibrary(page);
  });

  test('says what is missing instead of offering a composer that does nothing', async ({ page }) => {
    await openBuild(page);

    await expect(page.locator('[data-testid="assistant-unconfigured"]')).toBeVisible();
    await expect(page.locator('[data-testid="composer-input"]')).toBeDisabled();
    // And the panel that fixes it is already open, rather than behind a button
    // the user has to guess at.
    await expect(page.locator('[data-testid="provider-panel"]')).toBeVisible();
  });

  test('enables the composer once a provider is configured', async ({ page }) => {
    await openBuild(page);

    await page.locator('[data-testid="provider-key"]').fill('sk-test');
    await expect(page.locator('[data-testid="composer-input"]')).toBeEnabled();
    await expect(page.locator('[data-testid="assistant-status"]')).toContainText('claude-opus-5');
  });

  test('asks a local endpoint for a URL rather than a key', async ({ page }) => {
    await openBuild(page);

    await page.locator('[data-testid="provider-select"]').selectOption('openai-compatible');
    await expect(page.locator('[data-testid="provider-base-url"]')).toBeVisible();
    await expect(page.locator('[data-testid="provider-key"]')).toHaveCount(0);
  });

  test('streams the reply and shows a receipt per tool call', async ({ page }) => {
    await configureProvider(page);
    await mockAssistant(page, [
      { type: 'token', text: 'Looking at your library… ' },
      { type: 'receipt', tool: 'queries.list', status: 'ok', artifacts: [] },
      { type: 'token', text: 'you have five.' },
      { type: 'done', reason: 'complete' },
    ]);
    await openBuild(page);

    await page.locator('[data-testid="composer-input"]').fill('what do I have?');
    await page.locator('[data-testid="assistant-send"]').click();

    await expect(page.locator('.assistant-text')).toContainText('Looking at your library… you have five.');
    await expect(page.locator('.chat-rail')).toContainText('queries.list');
    // The prompt is echoed as the user's turn, so the conversation reads.
    await expect(page.locator('.user-turn')).toContainText('what do I have?');
  });

  test('a staged draft lands in the library as a draft, not a saved query', async ({ page }) => {
    await configureProvider(page);
    await mockAssistant(page, [
      { type: 'receipt', tool: 'drafts.createQuery', status: 'ok', artifacts: [{ type: 'query', name: 'Countries', version: null }] },
      {
        type: 'changed',
        draft: {
          id: 'urn:ui-temp:from-assistant',
          kind: 'scratch',
          section: 'query',
          name: 'Countries',
          description: null,
          body: 'SELECT * WHERE { ?s ?p ?o }',
          basedOn: null,
          libraryId: 'unassigned',
          createdAt: '2026-08-08T00:00:00Z',
          updatedAt: '2026-08-08T00:00:00Z',
        },
      },
      { type: 'token', text: 'Staged it as a draft.' },
      { type: 'done', reason: 'complete' },
    ]);
    await openBuild(page);

    await page.locator('[data-testid="composer-input"]').fill('make me a query');
    await page.locator('[data-testid="assistant-send"]').click();

    // It appears beside the conversation, as a row, immediately.
    await expect(page.locator('.callable-row').filter({ hasText: 'Countries' })).toBeVisible();

    // And it is a *draft* — the receipt and the row agree, which is the rule
    // the single draft store exists to keep.
    const stored = await page.evaluate((key: string) => window.localStorage.getItem(key), DRAFTS_KEY);
    expect(stored).toContain('urn:ui-temp:from-assistant');
    expect(JSON.parse(stored!)[0]).toMatchObject({ kind: 'scratch', name: 'Countries' });
  });

  test('surfaces a capped turn rather than appearing to stop mid-thought', async ({ page }) => {
    await configureProvider(page);
    await mockAssistant(page, [
      { type: 'token', text: 'Working…' },
      { type: 'done', reason: 'step-cap', message: 'Stopped after 12 steps.' },
    ]);
    await openBuild(page);

    await page.locator('[data-testid="composer-input"]').fill('do something enormous');
    await page.locator('[data-testid="assistant-send"]').click();

    await expect(page.locator('[data-testid="assistant-error"]')).toContainText('Stopped after 12 steps.');
  });

  test('shows a failed tool call rather than swallowing it', async ({ page }) => {
    await configureProvider(page);
    await mockAssistant(page, [
      { type: 'receipt', tool: 'queries.get', status: 'error', error: 'id: is required', artifacts: [] },
      { type: 'token', text: 'Let me try that again.' },
      { type: 'done', reason: 'complete' },
    ]);
    await openBuild(page);

    await page.locator('[data-testid="composer-input"]').fill('get it');
    await page.locator('[data-testid="assistant-send"]').click();

    // A failure the user cannot see is a failure they will re-ask for.
    await expect(page.locator('.chat-rail')).toContainText('queries.get');
  });
});
