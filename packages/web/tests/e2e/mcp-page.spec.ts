import { test, expect } from '@playwright/test';

/**
 * The MCP screen.
 *
 * This page has one job, getting a URL into somebody's chat client, and every
 * way it can fail is quiet. A URL rendered from an unset config reads as a
 * plausible string and points nowhere; a one-click link that loses the URL in an
 * unescaped query string opens an empty form. So the assertions here are about
 * what the page says, not how it looks. The screenshot test covers that.
 */

const MCP_URL = /\/mcp$/;

test.describe('MCP', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/mcp-server', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="mcp-endpoint"]');
  });

  test('shows the server URL, and it ends at /mcp', async ({ page }) => {
    await expect(page.getByTestId('mcp-endpoint')).toHaveText(MCP_URL);
  });

  test("opens Claude's Add custom connector dialog prefilled with that URL", async ({ page }) => {
    const endpoint = (await page.getByTestId('mcp-endpoint').textContent())!.trim();
    const href = await page.getByTestId('claude-deeplink').getAttribute('href');
    const link = new URL(href!);
    expect(`${link.origin}${link.pathname}`).toBe('https://claude.ai/customize/connectors');
    expect(link.searchParams.get('modal')).toBe('add-custom-connector');
    expect(link.searchParams.get('connectorUrl')).toBe(endpoint);
  });

  test('leads with ChatGPT, which has no install link at all', async ({ page }) => {
    await expect(page.getByTestId('client-chatgpt')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('client-steps')).toContainText('Connectors');
  });

  test('gives the clients that take one a snippet with the URL in it', async ({ page }) => {
    const endpoint = (await page.getByTestId('mcp-endpoint').textContent())!.trim();
    await page.getByTestId('client-claude-code').click();
    await expect(page.getByTestId('client-config')).toContainText(`claude mcp add --transport http sqlib ${endpoint}`);

    await page.getByTestId('client-claude-desktop').click();
    await expect(page.getByTestId('client-config')).toContainText(endpoint);
  });
});
