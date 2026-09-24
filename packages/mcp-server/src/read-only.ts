/**
 * Read-only mode: a door that cannot write, rather than a door that is asked not to.
 *
 * `/mcp` carries no authentication of its own (see the security model), so a
 * publicly reachable deployment is reachable by anyone who has the URL. The
 * honest way to publish one is to hand the catalogue a smaller set of tools:
 * with `MCP_READ_ONLY=1` the registry is built from the definitions marked
 * `readOnly`, so the writes are not refused at call time — they are never
 * declared, never listed, and `tools/call` answers "unknown tool". There is no
 * per-call check to get wrong, and nothing for a model to be talked into.
 *
 * What survives is more than the name suggests, and deliberately so: read-only
 * means "does not mutate the library", not "does not run anything". Execution
 * is read-only — `execute.run`, `sparql.proxyQuery`, `rules.execute`,
 * `ruleSets.execute` — as is `patches.previewUpdate`, which shows the triples
 * an update would write without writing them. So a session can still explore,
 * parameterise and run queries, including ad-hoc ones against an endpoint the
 * server has never heard of; it just cannot leave anything behind.
 *
 * One thing this mode does *not* close: `sparql.proxyQuery` accepts a bare
 * `endpoint` URL, so an unauthenticated read-only server is still an open
 * SPARQL proxy — it will make requests on a caller's behalf to any endpoint
 * they name. `MCP_SPARQL_ENDPOINTS=backends-only` refuses those, leaving the
 * registered backends as the only reachable targets. That is a separate
 * decision from read-only, and it is spelled separately.
 */
import type { ToolDefinition } from '@sparql-query-lib/tools';

/** Is this server published read-only? */
export function readOnlyModeEnabled(): boolean {
  const value = process.env.MCP_READ_ONLY;
  return value === '1' || value === 'true';
}

/** May this server proxy SPARQL to an endpoint that is not a registered backend? */
export function inlineEndpointsAllowed(): boolean {
  return process.env.MCP_SPARQL_ENDPOINTS !== 'backends-only';
}

/**
 * The definitions this door publishes.
 *
 * Note what is *not* here: no allowlist of tool names to keep in step with the
 * catalogue. A tool added without `readOnly: true` is a write until someone
 * says otherwise, which is the safe direction for a default to fail in.
 */
export function catalogueForMode(definitions: readonly ToolDefinition[], readOnly: boolean): ToolDefinition[] {
  return readOnly ? definitions.filter((tool) => tool.readOnly === true) : [...definitions];
}

/**
 * What the model is told about the mode, appended to the catalogue guide.
 *
 * Without this the model discovers the restriction by calling a tool that does
 * not exist, and reports it to the user as a broken server. Saying it up front
 * costs a paragraph in the system prompt and turns a failure into a known
 * constraint it can plan around — which is the whole reason `initialize`
 * carries instructions.
 */
export function readOnlyGuideNote(): string {
  return [
    '',
    '## This server is read-only',
    '',
    'Only the tools that read are published here; the ones that create, update or',
    'delete anything are not in your catalogue at all. Do not tell the user you will',
    'save something and then find you cannot.',
    '',
    'Running queries still works, and is the point: execute a stored query or query',
    'group, run ad-hoc SPARQL text against a backend or an endpoint URL, supply',
    'arguments for the parameters a query declares, and preview what an update would',
    'change. A query the user wants to keep has to be saved by them, in sqlib itself —',
    'offer them the query text.',
    ...(inlineEndpointsAllowed()
      ? []
      : [
          '',
          'Ad-hoc SPARQL must name a registered backend (`backendId`); this server will',
          'not query an arbitrary `endpoint` URL.',
        ]),
  ].join('\n');
}
