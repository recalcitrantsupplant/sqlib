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
 * Where Claude's custom connectors live, and the link that fills one in.
 *
 * Claude documents a deep link to its Add custom connector dialog on the
 * customize page, prefilled from two parameters:
 *
 *   https://claude.ai/customize/connectors?modal=add-custom-connector
 *     &connectorName=<name>&connectorUrl=<URL-encoded endpoint>
 *
 * The parameter names are the whole interface, and they have changed. This
 * page once linked `claude.ai/settings/connectors?...&mcpName=…&mcpServerUrl=…`,
 * which now renders a stub reading "Connectors have moved to Customize"; moving
 * only the path, with the old names still attached, landed on the same stub.
 * The test pins the documented names so the next rename fails a test.
 *
 * On Team and Enterprise an owner has to add the connector for the
 * organisation first, at `claude.ai/admin-settings/connectors`; members then
 * connect from the customize page.
 */
export const CLAUDE_CONNECTORS_URL = 'https://claude.ai/customize/connectors';

export function claudeConnectorLink(endpoint: string, name = 'sqlib'): string {
  const params = new URLSearchParams({
    modal: 'add-custom-connector',
    connectorName: name,
    connectorUrl: endpoint,
  });
  return `${CLAUDE_CONNECTORS_URL}?${params.toString()}`;
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
