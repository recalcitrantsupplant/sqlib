import { test, expect, type Page } from '@playwright/test';
import { mockCallableLibrary } from './fixtures/callables';

/**
 * The "Connect your own assistant" panel — door B's entire story.
 *
 * The user already has a client and a subscription, and `/mcp` already serves
 * the same tools. Everything worth testing here is that we tell them so
 * accurately: the right endpoint, a config they can paste, and the one caveat
 * that matters.
 */

async function openBuild(page: Page) {
  await page.goto('/build', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="connect-assistant"]');
}

test.describe('Connect your assistant', () => {
  test.beforeEach(async ({ page }) => {
    await mockCallableLibrary(page);
    await openBuild(page);
  });

  test('shows the MCP endpoint, on the same origin as the API', async ({ page }) => {
    // /mcp is served beside the API in every deployment mode, so it is the API
    // base URL plus a path — not a separate host to configure.
    await expect(page.locator('[data-testid="mcp-endpoint"]')).toHaveText(/\/mcp$/);
    await expect(page.locator('[data-testid="mcp-endpoint"]')).toContainText('localhost:3000');
  });

  test('gives a config per client, and switches between them', async ({ page }) => {
    const snippet = page.locator('[data-testid="client-config"]');

    await expect(snippet).toContainText('mcpServers');
    await expect(snippet).toContainText('"type": "http"');

    await page.locator('[data-testid="client-cli"]').click();
    // Claude Code is a command, not a JSON file — a panel that offered the same
    // snippet for all three would be wrong for two of them.
    await expect(snippet).toContainText('claude mcp add --transport http');
    await expect(snippet).not.toContainText('mcpServers');

    await page.locator('[data-testid="client-cursor"]').click();
    await expect(snippet).toContainText('mcpServers');
  });

  test('the config carries the real endpoint, not a placeholder', async ({ page }) => {
    const endpoint = (await page.locator('[data-testid="mcp-endpoint"]').textContent())?.trim();
    await expect(page.locator('[data-testid="client-config"]')).toContainText(endpoint!);
  });

  test('says the endpoint is unauthenticated rather than leaving it to be found out', async ({ page }) => {
    await expect(page.locator('[data-testid="connect-warning"]')).toContainText('unauthenticated');
    await expect(page.locator('[data-testid="connect-warning"]')).toContainText('trusted network');
  });

  test('copies the endpoint and confirms it did', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.locator('[data-testid="copy-endpoint"]').click();

    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toMatch(/\/mcp$/);
  });

  test('copies the whole config', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.locator('[data-testid="copy-config"]').click();

    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toContain('mcpServers');
    // Confirmation the click landed, since a silent copy is indistinguishable
    // from a broken button.
    await expect(page.locator('[data-testid="copy-config"]')).toContainText('Copied');
  });
});
