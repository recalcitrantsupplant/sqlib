/**
 * The MCP Apps (SEP-1865) door: UI resources, and the `_meta` that binds a tool
 * to one.
 *
 * Kept out of `index.ts` because it is the one part of this package that is
 * about a *protocol extension* rather than about serving the catalogue.
 *
 * **The bindings are published unconditionally.** The specification says a
 * server SHOULD check client capabilities, and this package used to: it gated
 * `_meta.ui` on the client advertising
 * `capabilities.extensions["io.modelcontextprotocol/ui"]`. That gate is why
 * the bench never rendered in Claude. Claude's `initialize` declares `roots`
 * and `elicitation` and no `extensions` key at all — and renders apps anyway.
 * Gating on the advertisement therefore withheld exactly the metadata the host
 * needed, and produced a tool that answers in plain text while looking, from
 * the server's side, like a client that simply does not do UI. ChatGPT, which
 * does advertise, worked throughout — which is what made the gate look
 * correct.
 *
 * Publishing unconditionally is safe: `_meta` is ignorable by design, and the
 * text `content` block is always present, so a client with no idea what
 * `ui://` means still gets the same result it got before any of this existed.
 * `MCP_APPS=off` withholds it all, for testing that fallback deliberately
 * rather than by accident.
 */
import { views, findView, renderView, APP_MIME_TYPE, UI_EXTENSION } from '@sparql-query-lib/mcp-app';
import type { ListedTool } from '@sparql-query-lib/tools';

/**
 * Should this server publish its UI bindings at all?
 *
 * True unless `MCP_APPS=off`. Deliberately not a function of what the client
 * advertised — see the note at the top of this file for the failure that
 * caused.
 */
export function uiMetadataEnabled(): boolean {
  return process.env.MCP_APPS !== 'off';
}

/**
 * Does this client *say* it renders MCP Apps?
 *
 * Diagnostic only. It is no longer a gate, because the host that matters most
 * answers "no" and renders anyway; it survives because knowing what a client
 * declared is useful when something does not paint, and because the shape of
 * the declaration is worth keeping written down.
 *
 * The extensions map is not in the SDK's `ClientCapabilities` type, hence the
 * read through `unknown` — a structural check against the protocol, not a cast
 * away from one.
 */
export function advertisesUiExtension(capabilities: unknown): boolean {
  const extensions = (capabilities as { extensions?: Record<string, unknown> } | undefined)?.extensions;
  const ui = extensions?.[UI_EXTENSION] as { mimeTypes?: unknown } | undefined;
  if (!ui) return false;
  const mimeTypes = ui.mimeTypes;
  // A client that names the extension but no MIME types is taken at its word;
  // one that names types must include ours.
  if (!Array.isArray(mimeTypes)) return true;
  return mimeTypes.some((type) => typeof type === 'string' && type.split(';')[0]!.trim() === 'text/html' && type.includes('profile=mcp-app'))
    || mimeTypes.includes(APP_MIME_TYPE);
}

/** Every View, in the shape `resources/list` returns. */
export function listUiResources() {
  return views.map((view) => ({
    uri: view.uri,
    name: view.name,
    title: view.title,
    description: view.description,
    mimeType: view.mimeType,
    _meta: { ui: view.meta },
  }));
}

/** One View's contents, in the shape `resources/read` returns. */
export function readUiResource(uri: string) {
  const view = findView(uri);
  if (!view) return null;
  return {
    contents: [
      {
        uri: view.uri,
        mimeType: view.mimeType,
        text: renderView(view.uri),
        _meta: { ui: view.meta },
      },
    ],
  };
}

/**
 * Should this tool be listed at all?
 *
 * `visibility: ['app']` means a View may call it but the model may not see it —
 * plumbing, not a choice an agent should be weighing. Without UI support such a
 * tool is unreachable, so it is hidden either way.
 */
export function toolVisibleToModel(tool: ListedTool): boolean {
  const visibility = tool.ui?.visibility;
  return !visibility || visibility.includes('model');
}

/**
 * A listed tool with its `_meta.ui`, when the client can use it.
 *
 * `visibility` is defaulted explicitly rather than left out: a host reading
 * `['model', 'app']` knows the View may call the tool back, which is what makes
 * the bench's own `execute.run` legal.
 */
export function withUiMeta(tool: ListedTool, uiEnabled: boolean) {
  if (!uiEnabled || !tool.ui) {
    // The catalogue's `ui` is an internal binding; nothing but `_meta` should
    // carry it onto the wire.
    const { ui: _ui, ...rest } = tool;
    return rest;
  }
  const { ui, ...rest } = tool;
  return {
    ...rest,
    _meta: {
      ui: {
        resourceUri: ui.resourceUri,
        visibility: ui.visibility ?? ['model', 'app'],
      },
    },
  };
}

/** The `_meta` a tool *result* carries, so a host knows what to render it in. */
export function resultUiMeta(tool: { ui?: { resourceUri: string } } | undefined, uiEnabled: boolean) {
  if (!uiEnabled || !tool?.ui) return undefined;
  return { ui: { resourceUri: tool.ui.resourceUri } };
}
