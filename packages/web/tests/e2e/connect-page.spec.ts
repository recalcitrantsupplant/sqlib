import { test, expect } from '@playwright/test';

/**
 * The Connect screen.
 *
 * This page has one job — get a URL into somebody's chat client — and every
 * way it can fail is quiet. A URL rendered from an unset config reads as a
 * plausible string and points nowhere; a one-click link that loses the URL in
 * an unescaped query string opens an empty form; a check that reports a healthy
 * server as unreachable sends the user looking for a firewall problem that does
 * not exist. So the assertions here are about what the page *says*, not how it
 * looks — the screenshot test covers that.
 */

const MCP_URL = /\/mcp$/;

test.describe('Connect', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/connect', { waitUntil: 'domcontentloaded' });
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

  test('reports what answered, not just that something did', async ({ page }) => {
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

    await page.getByTestId('test-connection').click();
    await expect(page.getByTestId('test-result')).toContainText('sqlib-mcp');
    await expect(page.getByTestId('test-result')).toContainText('2 tools');
    await expect(page.getByTestId('test-result')).toContainText('read-only');
  });

  test('says plainly that the endpoint is unauthenticated', async ({ page }) => {
    await expect(page.getByTestId('connect-warning')).toContainText('no authentication');
  });
});
