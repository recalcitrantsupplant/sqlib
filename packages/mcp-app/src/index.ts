/**
 * The Views, and what a host is told about them.
 *
 * A View is one self-contained HTML document: its CSS and JS are inlined at
 * load time from `src/kit`, so the resource a host reads pulls nothing at
 * runtime. That is not a packaging preference — SEP-1865's default CSP gives a
 * View no `connect-src` and no `script-src` beyond its own document, and this
 * package declares exactly that CSP, so anything not inlined would simply fail
 * to load.
 *
 * `packages/mcp-server` publishes these as `resources/read` responses; nothing
 * here knows about MCP beyond the metadata shape, which keeps the Views
 * testable without a server.
 */
import { readFileSync } from 'node:fs';
import { VIEW_URI } from '@sparql-query-lib/tools';

/** SEP-1865's MIME type for an HTML View. A host matches on it exactly. */
export const APP_MIME_TYPE = 'text/html;profile=mcp-app';

/** The extension identifier a client advertises UI support under. */
export const UI_EXTENSION = 'io.modelcontextprotocol/ui';

/**
 * The `_meta.ui` a UI resource carries.
 *
 * Every allowlist is empty and stays empty: a View reads and writes only
 * through the host bridge, so it has no reason to reach the network, and a host
 * that enforces this CSP makes that structural rather than a promise. Adding a
 * domain here is a security decision, which is the point of declaring it up
 * front where it can be reviewed.
 */
export type ViewMeta = {
  csp: {
    connectDomains: string[];
    resourceDomains: string[];
    frameDomains: string[];
    baseUriDomains: string[];
  };
  permissions: string[];
  prefersBorder: boolean;
};

export type ViewDefinition = {
  uri: string;
  name: string;
  title: string;
  description: string;
  mimeType: string;
  meta: ViewMeta;
  /** The file under `views/`, resolved relative to this module. */
  file: string;
};

const SEALED_META: ViewMeta = {
  csp: {
    connectDomains: [],
    resourceDomains: [],
    frameDomains: [],
    baseUriDomains: [],
  },
  permissions: [],
  prefersBorder: true,
};

export const views: ViewDefinition[] = [
  {
    uri: VIEW_URI.bench,
    name: 'query-bench',
    title: 'Query bench',
    description:
      'Edit a SPARQL query, fill the parameters detected in it, run it against a backend and save it as a version of a library query.',
    mimeType: APP_MIME_TYPE,
    meta: SEALED_META,
    file: 'bench.html',
  },
  {
    uri: VIEW_URI.result,
    name: 'query-result',
    title: 'Query result',
    description: 'A table of SPARQL results, with RDF terms rendered by kind.',
    mimeType: APP_MIME_TYPE,
    meta: SEALED_META,
    file: 'result.html',
  },
];

const byUri = new Map(views.map((view) => [view.uri, view]));

export function findView(uri: string): ViewDefinition | undefined {
  return byUri.get(uri);
}

function readAsset(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), 'utf8');
}

/**
 * Read once per process, not once per `resources/read`.
 *
 * A host re-reads a View whenever it renders one, and a chat renders the bench
 * repeatedly; the files cannot change under a running server, so the assembled
 * document is memoised. `MCP_APP_NO_CACHE=1` turns that off while editing a
 * View, so a reload shows the edit without restarting the server.
 */
const cache = new Map<string, string>();
const noCache = process.env.MCP_APP_NO_CACHE === '1';

/** The assembled, self-contained HTML for one View. */
export function renderView(uri: string): string {
  const cached = cache.get(uri);
  if (cached && !noCache) return cached;

  const view = byUri.get(uri);
  if (!view) throw new Error(`Unknown view: ${uri}`);

  const html = readAsset(`./views/${view.file}`)
    .replace('<!--@kit:css-->', () => `<style>\n${readAsset('./kit/base.css')}</style>`)
    .replace('<!--@kit:bridge-->', () => `<script>\n${readAsset('./kit/bridge.js')}</script>`)
    .replace('<!--@kit:results-->', () => `<script>\n${readAsset('./kit/results.js')}</script>`);

  if (html.includes('<!--@kit:')) {
    throw new Error(`View ${uri} has an unresolved kit placeholder`);
  }

  cache.set(uri, html);
  return html;
}
