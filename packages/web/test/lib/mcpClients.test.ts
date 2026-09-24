/**
 * The MCP page's facts, tested away from the page.
 *
 * Each of these is a silent failure in the field: a URL derived with a double
 * slash or a missing `/mcp` sends every user to a dead endpoint and tells them
 * the connector is broken; a check that cannot read an SSE answer reports a
 * healthy server as unreachable. None of it is visible from a screenshot.
 */
import { describe, it, expect } from 'vitest';
import {
  MCP_CLIENTS,
  claudeConnectorLink,
  describeCatalogue,
  mcpEndpoint,
  parseRpcMessage,
} from '@/lib/mcpClients';

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
  it('points at the documented connectors page', () => {
    expect(claudeConnectorLink('https://sqlib.example/mcp')).toContain(
      'https://claude.ai/customize/connectors'
    );
  });

  it('carries the URL through the query string, escaped', () => {
    const link = claudeConnectorLink('https://sqlib.example/mcp');
    expect(link).toContain(`mcpServerUrl=${encodeURIComponent('https://sqlib.example/mcp')}`);
    // Unescaped, the host would read the rest of the URL as its own parameters.
    expect(link).not.toContain('mcpServerUrl=https://');
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

describe('parseRpcMessage', () => {
  it('reads a plain JSON answer', () => {
    expect(parseRpcMessage('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}')).toMatchObject({
      result: { ok: true },
    });
  });

  it('reads the same message out of an SSE stream', () => {
    const stream = ': keep-alive\nevent: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n\n';
    expect(parseRpcMessage(stream)).toMatchObject({ result: { ok: true } });
  });

  it('returns null rather than throwing on a body that is neither', () => {
    expect(parseRpcMessage('')).toBeNull();
    expect(parseRpcMessage('<html>proxy error</html>')).toBeNull();
    expect(parseRpcMessage('{not json')).toBeNull();
  });
});

describe('describeCatalogue', () => {
  it('reads the mode from a write being present, not from a tool count', () => {
    expect(describeCatalogue(['queries_list', 'execute_run']).writable).toBe(false);
    expect(describeCatalogue(['queries_list', 'queries_create']).writable).toBe(true);
  });

  it('calls a catalogue with execution but no writes read-only, because it is', () => {
    expect(describeCatalogue(['execute_run', 'sparql_proxyQuery', 'rules_execute']).mode).toBe('read-only');
  });
});
