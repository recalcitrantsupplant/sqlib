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

  test('offers a one-click link carrying that URL, escaped', async ({ page }) => {
    const endpoint = (await page.getByTestId('mcp-endpoint').textContent())!.trim();
    const href = await page.getByTestId('claude-deeplink').getAttribute('href');
    expect(href).toContain('claude.ai/settings/connectors');
    expect(href).toContain(encodeURIComponent(endpoint));
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

  test('reports what the server publishes, not that something answered', async ({ page }) => {
    // A stubbed server, because the point is the reporting: a real one would
    // make this a test of whichever mode the dev machine happens to run in.
    await page.route('**/mcp', async (route) => {
      const body = JSON.parse(route.request().postData() ?? '{}');
      if (body.method === 'initialize') {
        await route.fulfill({
          status: 200,
          headers: { 'content-type': 'application/json', 'mcp-session-id': 'test' },
          body: JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { serverInfo: { name: 'sqlib-mcp' } } }),
        });
        return;
      }
      if (body.method === 'tools/list') {
        await route.fulfill({
          status: 200,
          headers: { 'content-type': 'application/json' },
          // Execution present, writes absent: the read-only catalogue.
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: body.id,
            result: { tools: [{ name: 'queries_list' }, { name: 'execute_run' }] },
          }),
        });
        return;
      }
      await route.fulfill({ status: 202, body: '' });
    });

    await page.getByTestId('read-catalogue').click();
    await expect(page.getByTestId('catalogue-result')).toContainText('sqlib-mcp');
    await expect(page.getByTestId('catalogue-result')).toContainText('2 tools');
    await expect(page.getByTestId('catalogue-result')).toContainText('read-only');
  });

  /*
   * The disclaimer is the feature. The earlier version of this section was a
   * "Test connection" button, and a green tick on it read as "MCP works" while
   * proving only that a browser already talking to this app could reach a URL
   * on the same host. Whether a chat client can reach the server is decided on
   * someone else's network.
   */
  test('does not claim a chat client can reach the server', async ({ page }) => {
    await expect(page.getByTestId('catalogue-note')).toContainText('from this browser');
    await expect(page.getByTestId('catalogue-note')).toContainText(
      'Not a test of whether Claude or ChatGPT can reach it'
    );
  });

  test('says plainly that the endpoint is unauthenticated', async ({ page }) => {
    await expect(page.getByTestId('mcp-warning')).toContainText('no authentication');
  });
});
