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
 * Where Claude's custom connectors live.
 *
 * `claude.ai/settings/connectors?modal=add-custom-connector` used to open the
 * add-a-connector modal with the fields prefilled from the query string, and
 * this page used to link it. As of September 2026 that route renders a stub
 * reading "Connectors have moved to Customize", so the link took a user to a
 * dead end that still looked official. Anthropic's own documentation now names
 * `claude.ai/customize/connectors` and documents no parameters that prefill
 * anything, so the page no longer promises a prefilled form: this opens the
 * right list, the user presses Add custom connector and pastes.
 *
 * The name and URL are still appended. They cost nothing, they are ignored by a
 * page that does not read them, and they work if the handler survived the move.
 * Nothing in the interface claims they will.
 *
 * On Team and Enterprise an owner has to add the connector for the
 * organisation first, at `claude.ai/admin-settings/connectors`; members then
 * authenticate from the customize page above.
 */
export const CLAUDE_CONNECTORS_URL = 'https://claude.ai/customize/connectors';

export function claudeConnectorLink(endpoint: string, name = 'sqlib'): string {
  return (
    `${CLAUDE_CONNECTORS_URL}?modal=add-custom-connector` +
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
    /*
     * Named by the path rather than by one label, because the label keeps
     * moving: this section has been Connectors, then Apps, then Plugins, in
     * about a year. Settings and Advanced settings have stayed put.
     */
    steps: [
      'Settings → Apps (formerly Connectors) → Advanced settings, and switch on developer mode.',
      'Back on that page, create a connector: name it sqlib and paste the server URL above.',
      'Choose no authentication, then create it.',
      'In a chat, enable sqlib from the tools menu.',
    ],
  },
  {
    id: 'claude-web',
    label: 'Claude (web)',
    steps: [
      'Open claude.ai/customize/connectors, or use the button above.',
      'Press +, then Add custom connector, and paste the server URL.',
      'Add it, then enable sqlib in a chat.',
      'On Team and Enterprise an owner adds it first at claude.ai/admin-settings/connectors.',
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
