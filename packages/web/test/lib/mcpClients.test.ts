/**
 * The MCP page's facts, tested away from the page.
 *
 * Each of these is a silent failure in the field: a URL derived with a double
 * slash or a missing `/mcp` sends every user to a dead endpoint and tells them
 * the connector is broken. None of it is visible from a screenshot.
 */
import { describe, it, expect } from 'vitest';
import { MCP_CLIENTS, claudeConnectorLink, mcpEndpoint } from '@/lib/mcpClients';

describe('mcpEndpoint', () => {
  it('derives /mcp beside the API, which is where every shipped mode serves it', () => {
    expect(mcpEndpoint({ apiBaseUrl: 'https://sqlib.example' })).toBe('https://sqlib.example/mcp');
  });

  it('does not double the slash on a configured base that ends in one', () => {
    expect(mcpEndpoint({ apiBaseUrl: 'https://sqlib.example/' })).toBe('https://sqlib.example/mcp');
  });

  it('prefers an explicit MCP URL, for a public server on its own host', () => {
    expect(mcpEndpoint({ apiBaseUrl: 'http://localhost:3000', mcpUrl: 'https://mcp.example/mcp' })).toBe(
      'https://mcp.example/mcp'
    );
  });

  it('treats blank and whitespace as unset rather than as an empty URL', () => {
    expect(mcpEndpoint({ apiBaseUrl: 'https://a.example', mcpUrl: '   ' })).toBe('https://a.example/mcp');
  });
});

describe('claudeConnectorLink', () => {
  /*
   * The route is the assertion that matters, and it is here because it already
   * broke once. The link pointed at `claude.ai/settings/connectors`, which
   * Anthropic turned into a stub reading "Connectors have moved to Customize"
   * some time before September 2026. Nothing failed: the button still opened a
   * real page on the right domain, and only a screenshot showed it was a dead
   * end. A test that names the current documented path turns the next move into
   * a failing test instead.
   */
  it('opens the documented Add custom connector dialog', () => {
    const link = new URL(claudeConnectorLink('https://sqlib.example/mcp'));
    expect(`${link.origin}${link.pathname}`).toBe('https://claude.ai/customize/connectors');
    expect(link.searchParams.get('modal')).toBe('add-custom-connector');
  });

  it('prefills with the documented parameter names, the URL escaped', () => {
    // `connectorName` and `connectorUrl`, not the retired `mcpName` and
    // `mcpServerUrl`: with those, the link landed on the Settings stub.
    const link = claudeConnectorLink('https://sqlib.example/mcp?x=1', 'sqlib demo');
    const params = new URL(link).searchParams;
    expect(params.get('connectorName')).toBe('sqlib demo');
    expect(params.get('connectorUrl')).toBe('https://sqlib.example/mcp?x=1');
    expect(link).toContain(`connectorUrl=${encodeURIComponent('https://sqlib.example/mcp?x=1')}`);
    expect(link).not.toMatch(/mcpName|mcpServerUrl/);
  });
});

describe('the client list', () => {
  it('leads with ChatGPT, the one with no install link at all', () => {
    expect(MCP_CLIENTS[0]!.id).toBe('chatgpt');
  });

  it('gives every client either steps or a snippet to copy, and no empty tab', () => {
    for (const client of MCP_CLIENTS) {
      expect(client.steps.length, `${client.id} has no steps`).toBeGreaterThan(0);
    }
  });

  it('puts the endpoint into every snippet it builds', () => {
    for (const client of MCP_CLIENTS) {
      if (!client.snippet) continue;
      expect(client.snippet('https://sqlib.example/mcp'), client.id).toContain('https://sqlib.example/mcp');
    }
  });
});
