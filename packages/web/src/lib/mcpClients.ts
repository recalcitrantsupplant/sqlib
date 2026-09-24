/**
 * Where to point a chat client, and how each client is told.
 *
 * Extracted from the MCP page rather than written inside it because these are
 * the parts with an answer worth pinning: a URL derived wrongly sends every user
 * to a dead endpoint, and the one-click link is an undocumented interface that
 * will need changing when Claude moves it. A page is awkward to test; this is
 * not.
 */

/**
 * The MCP endpoint this deployment publishes.
 *
 * `/mcp` is served beside the API on the same origin in every mode this
 * repository ships, so the default is derived. One fewer variable to forget,
 * and it is right for anyone running the thing locally. The override is for the
 * deployment this page exists for: a public read-only MCP on its own host,
 * administered from an app somewhere else.
 */
export function mcpEndpoint(config: { apiBaseUrl?: unknown; mcpUrl?: unknown }): string {
  const override = String(config.mcpUrl ?? '').trim();
  if (override) return override.replace(/\/+$/, '');
  return `${String(config.apiBaseUrl ?? '').replace(/\/+$/, '')}/mcp`;
}

/**
 * Claude's add-a-custom-connector link, with the name and URL prefilled.
 *
 * Not a documented interface. It is the modal Claude's own settings page opens,
 * addressed by its query string. It is here because "press this, then press
 * Add" is a different thing from "find Settings, find Connectors, find Add
 * custom connector, paste this", which is the whole difference between a person
 * setting this up and a person giving up. The page says beside it what to do
 * when the form opens empty, because one day it will.
 */
export function claudeConnectorLink(endpoint: string, name = 'sqlib'): string {
  return (
    'https://claude.ai/settings/connectors?modal=add-custom-connector' +
    `&mcpName=${encodeURIComponent(name)}&mcpServerUrl=${encodeURIComponent(endpoint)}`
  );
}

export type McpClient = {
  id: string;
  label: string;
  steps: string[];
  /** The block to copy, where the client takes one. Instructions-only otherwise. */
  snippet?: (endpoint: string) => string;
};

/**
 * ChatGPT first, deliberately: it is the only one of these with no install link
 * at all, so its steps are the whole path rather than a fallback.
 */
export const MCP_CLIENTS: McpClient[] = [
  {
    id: 'chatgpt',
    label: 'ChatGPT',
    steps: [
      'Settings → Connectors → Create (developer mode may need switching on first).',
      'Name it sqlib and paste the server URL above.',
      'Choose no authentication, then create it.',
      'In a chat, enable sqlib from the tools menu.',
    ],
  },
  {
    id: 'claude-web',
    label: 'Claude (web)',
    steps: [
      'Settings → Connectors → Add custom connector, or use the one-click link above.',
      'Name it sqlib and paste the server URL.',
      'Add it, then enable sqlib in a chat.',
    ],
  },
  {
    id: 'claude-code',
    label: 'Claude Code',
    steps: ['Run this once. It is stored for the project you run it in.'],
    snippet: (endpoint) => `claude mcp add --transport http sqlib ${endpoint}`,
  },
  {
    id: 'claude-desktop',
    label: 'Claude Desktop',
    steps: ['Settings → Developer → Edit Config, add this, then restart Claude.'],
    snippet: (endpoint) =>
      JSON.stringify({ mcpServers: { sqlib: { type: 'http', url: endpoint } } }, null, 2),
  },
  {
    id: 'cursor',
    label: 'Cursor',
    steps: ['Add this to .cursor/mcp.json in your project, or to the global one in ~/.cursor.'],
    snippet: (endpoint) => JSON.stringify({ mcpServers: { sqlib: { url: endpoint } } }, null, 2),
  },
];

/**
 * One JSON-RPC message out of a streamable-HTTP response.
 *
 * A server may answer a POST with JSON or with an SSE stream carrying the same
 * message, and which it picks is its business. Both are read rather than
 * negotiated: a check that failed on the encoding would report "cannot reach"
 * about a server answering perfectly, which is precisely the diagnosis this page
 * exists to avoid making.
 */
export function parseRpcMessage(body: string): Record<string, unknown> | null {
  const trimmed = body.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  for (const line of trimmed.split('\n')) {
    if (!line.startsWith('data:')) continue;
    try {
      return JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
    } catch {
      // Keep reading: an SSE stream carries comments and keep-alives too.
    }
  }
  return null;
}

/**
 * What the connection check says about a catalogue.
 *
 * The tool count alone is a number nobody can interpret. What a user wants to
 * know is whether the server they just published will let a stranger delete
 * their libraries, so the mode is read from the presence of a write rather than
 * from a count, and named in words.
 */
export function describeCatalogue(toolNames: string[]): { writable: boolean; mode: string } {
  const writable = toolNames.includes('queries_create');
  return { writable, mode: writable ? 'read and write' : 'read-only' };
}
