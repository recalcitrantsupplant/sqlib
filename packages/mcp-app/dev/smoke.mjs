/**
 * Drive the MCP Apps door against a running server, without a browser.
 *
 * The harness page proves a View renders; this proves the protocol underneath
 * it — that a UI-capable client is offered `_meta.ui`, that a plain one is not,
 * that the `ui://` resources read back as self-contained documents, and that
 * the tools a View calls answer. It is the check to run first when something
 * does not render, because it separates "the server is wrong" from "the View
 * is wrong".
 *
 * The default endpoint is the port `just run-local-memory` listens on (3010),
 * not the 3005 the README quotes — that recipe sets HTTP_PORT=3010.
 *
 *   node packages/mcp-app/dev/smoke.mjs [http://localhost:3010/mcp]
 */
const endpoint = process.argv[2] ?? process.env.MCP_ENDPOINT ?? 'http://localhost:3010/mcp';

let sessionId = null;
let nextId = 1;
let failures = 0;

async function rpc(method, params, { notification = false, session = true } = {}) {
  const body = { jsonrpc: '2.0', method, ...(params ? { params } : {}) };
  if (!notification) body.id = nextId++;

  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  };
  if (session && sessionId) headers['mcp-session-id'] = sessionId;

  const response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
  const header = response.headers.get('mcp-session-id');
  if (header) sessionId = header;
  if (notification) return null;

  const text = await response.text();
  const payload = parse(text);
  if (!payload) throw new Error(`${method}: no JSON-RPC response (HTTP ${response.status})`);
  if (payload.error) throw new Error(`${method}: ${payload.error.message}`);
  return payload.result;
}

/** Streamable HTTP answers with JSON or with SSE; both carry one response. */
function parse(text) {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{')) return JSON.parse(trimmed);
  for (const line of trimmed.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (!data) continue;
    try {
      const parsed = JSON.parse(data);
      if (parsed.result !== undefined || parsed.error !== undefined) return parsed;
    } catch { /* keep looking */ }
  }
  return null;
}

function check(label, condition, detail) {
  if (condition) {
    console.log(`  ok   ${label}`);
    return true;
  }
  failures += 1;
  console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  return false;
}

async function session(capabilities) {
  sessionId = null;
  const result = await rpc('initialize', {
    protocolVersion: '2025-06-18',
    clientInfo: { name: 'sqlib-app-smoke', version: '0.0.1' },
    capabilities,
  }, { session: false });
  await rpc('notifications/initialized', {}, { notification: true });
  return result;
}

const UI_CAPABILITIES = {
  extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } },
};

console.log(`MCP Apps smoke test against ${endpoint}\n`);

console.log('A UI-capable client');
const initialized = await session(UI_CAPABILITIES);
check(
  'the server declares the UI extension itself',
  Boolean(initialized.capabilities?.extensions?.['io.modelcontextprotocol/ui']),
  JSON.stringify(initialized.capabilities)
);
const { tools } = await rpc('tools/list', {});
const bound = tools.filter((tool) => tool._meta?.ui?.resourceUri);
check('tools are offered', tools.length > 0, `${tools.length} tools`);
check('some tools name a View', bound.length >= 3, bound.map((tool) => tool.name).join(', '));
check(
  'the bench is reachable',
  bound.some((tool) => tool.name === 'app_bench_open'),
  bound.map((t) => t.name).join(', ')
);
check(
  'every binding names a hashed URI',
  bound.every((tool) => /-[0-9a-f]{12}\.html$/.test(tool._meta.ui.resourceUri)),
  bound.map((tool) => tool._meta.ui.resourceUri).join(', ')
);

const { resources } = await rpc('resources/list', {});
check('the Views are listed as resources', resources.length >= 2, resources.map((r) => r.uri).join(', '));
check(
  'each View declares the MCP Apps MIME type',
  resources.every((resource) => resource.mimeType === 'text/html;profile=mcp-app'),
  resources.map((r) => r.mimeType).join(', ')
);
check(
  'each View declares an empty connect-src',
  resources.every((resource) => (resource._meta?.ui?.csp?.connectDomains ?? null)?.length === 0),
  JSON.stringify(resources.map((r) => r._meta?.ui?.csp))
);

/*
 * A shape check, not a policy check. ChatGPT validates this field and refuses
 * the whole connector when it is an array; Claude ignores it. So the only place
 * a wrong type showed up was a registration error in somebody else's product.
 */
check(
  'each View declares permissions as a map',
  resources.every((resource) => {
    const permissions = resource._meta?.ui?.permissions;
    return permissions !== null && typeof permissions === 'object' && !Array.isArray(permissions);
  }),
  JSON.stringify(resources.map((r) => r._meta?.ui?.permissions))
);

check(
  'each View is published under a content-hashed URI',
  resources.every((resource) => /-[0-9a-f]{12}\.html$/.test(resource.uri)),
  resources.map((r) => r.uri).join(', ')
);

// A host that cached a tool declaration asks for the URI it remembers. If that
// 404s, the user is told the connector is unreachable — so the un-hashed URI
// must keep resolving alongside the hashed one.
for (const stable of ['ui://sqlib/bench', 'ui://sqlib/result', 'ui://sqlib/tutorial']) {
  let aliasOk = false;
  try {
    const read = await rpc('resources/read', { uri: stable });
    aliasOk = typeof read.contents?.[0]?.text === 'string';
  } catch (error) {
    aliasOk = false;
  }
  check(`${stable} still resolves for a host that cached it`, aliasOk);
}

/*
 * The binding on the *result*, which is the half a host reads per call — and
 * the half that updates without the host's cached `tools/list` being cleared.
 * `app.bench.open` needs a real library, so this uses whatever the server has.
 */
const librariesCall = await rpc('tools/call', { name: 'libraries_list', arguments: {} });
// The registry parses a JSON body and leaves anything else as text, so the
// envelope's `body` is an array here and a string elsewhere. Handle both.
const rawLibraries = librariesCall.structuredContent?.body ?? [];
const libraries = typeof rawLibraries === 'string' ? JSON.parse(rawLibraries) : rawLibraries;
const library = Array.isArray(libraries)
  ? libraries.find((entry) => entry.id && !entry.id.startsWith('https://sparql-query-lib/system'))
  : undefined;

if (!library) {
  console.log('  skip a tool result carries _meta.ui — no library on this server to open the bench on');
} else {
  const boundCall = await rpc('tools/call', {
    name: 'app_bench_open',
    arguments: { libraryId: library.id },
  });
  check(
    'a tool result carries _meta.ui, in both spellings',
    Boolean(boundCall._meta?.ui?.resourceUri) && Boolean(boundCall._meta?.['ui/resourceUri']),
    JSON.stringify(boundCall._meta)
  );
}

for (const resource of resources) {
  const read = await rpc('resources/read', { uri: resource.uri });
  const html = read.contents?.[0]?.text ?? '';
  check(
    `${resource.uri} reads back as a self-contained document`,
    html.includes('<!doctype html>') && html.includes('window.sqlibApp') && !/<script[^>]+src=/i.test(html),
    `${html.length} bytes`
  );
}

/*
 * A client shaped like Claude's: roots and elicitation, no `extensions` key.
 *
 * It must be offered the bindings anyway. Claude declares no UI extension and
 * renders apps regardless, so a server that gates on the advertisement hands
 * the host a tool with nothing to render — which is precisely the bug this
 * check now guards against. The text content is present either way, so a
 * client that really cannot render loses nothing.
 */
console.log('\nA client that advertises no UI extension (Claude\'s shape)');
await session({ roots: {}, elicitation: {} });
const quiet = await rpc('tools/list', {});
const quietBound = quiet.tools.filter((tool) => tool._meta?.ui?.resourceUri);
check(
  'is offered the same _meta.ui bindings',
  quietBound.length === bound.length,
  `${quietBound.length} vs ${bound.length}`
);
check('sees the whole catalogue', quiet.tools.length === tools.length, `${quiet.tools.length} vs ${tools.length}`);

const quietCall = await rpc('tools/call', { name: 'queries_list', arguments: {} });
check(
  'gets a text fallback on every result, bindings or not',
  typeof quietCall.content?.[0]?.text === 'string',
  JSON.stringify(Object.keys(quietCall))
);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
