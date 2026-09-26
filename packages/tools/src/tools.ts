/**
 * The tool catalogue: what each tool publishes, and the API request it builds.
 *
 * Lifted out of `createMcpServer` in Phase C2 (issue #65), and out of the
 * mcp-server package entirely when the in-app assistant arrived — nothing here
 * is about MCP. A tool is a name, a JSON Schema and a request; which protocol
 * asked for it is the caller's business. That is what lets one catalogue serve
 * both doors, and it is the property that stops a tool behaving differently
 * depending on which one you came through.
 *
 * `buildRequest` returns a plain `ToolRequest` rather than fastify's
 * `InjectOptions` so this package takes no server dependency. The shapes line
 * up except for `payload`, which is `unknown` here and narrower there; the
 * adapter that calls `app.inject` is where the two meet.
 *
 * `inputSchema` is JSON Schema; see `tool-schemas.ts` for where each one comes
 * from and why.
 */
import type { FromSchema, JSONSchema } from 'json-schema-to-ts';

/**
 * An API call, described. Deliberately the subset of fastify's `InjectOptions`
 * the catalogue actually uses, so an adapter can hand one straight to
 * `app.inject` while this package stays free of a fastify dependency.
 */
export type ToolRequest = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  payload?: unknown;
  headers?: Record<string, string>;
};
import {
  acceptArg,
  backendCreateArg,
  backendUpdateBody,
  benchOpenArg,
  bodyArg,
  detectQueryRequestArg,
  executionRequestArg,
  formatRequestArg,
  idAcceptArg,
  idArg,
  idBodyArg,
  libraryIdArg,
  idOptionalBodyArg,
  idRequiredArg,
  idVersionArg,
  idVersionBodyArg,
  libraryCreateArg,
  queryVersionBodyArg,
  libraryUpdateBody,
  noArgs,
  queryCreateArg,
  queryUpdateBody,
  ruleStringArg,
  sparqlRequestArg,
  patchPreviewArg,
  patchApplyArg,
  stripSchemaIdentity,
  validateRuleDataRequestArg,
  ruleSetSrlArg,
  srlCompileArg,
  srlDocumentArg,
  srlRunArg,
  tagsListArg,
  testsListArg,
  tutorialOpenArg,
} from './tool-schemas.js';

/**
 * A tool's binding to an MCP Apps View.
 *
 * Protocol-neutral on purpose, like everything else here: this says *which*
 * View renders a tool's result and *who* may call the tool, not how a given
 * door spells that. `packages/mcp-server` maps it onto SEP-1865's `_meta.ui`;
 * the in-app assistant ignores it.
 *
 * `visibility` follows the specification's default of `['model', 'app']`. A
 * tool marked `['app']` is hidden from the agent and callable only by a View
 * through `tools/call` — the bench's plumbing, not something a model should be
 * choosing between.
 */
export type ToolUiBinding = {
  /** The `ui://` resource that renders this tool's result. */
  resourceUri: string;
  visibility?: ('model' | 'app')[];
};

export type ToolDefinition = {
  name: string;
  /**
   * A human-readable name, where `name` is the machine one.
   *
   * `description` is written for a model — it can spend a paragraph on what
   * publishing means — and reads as an instruction when a UI puts it in a
   * header. This is the label to show instead. It is MCP's `Tool.title`, which
   * the protocol says clients should prefer over `name`, so it is worth having
   * even for tools this app never renders itself.
   *
   * Optional: a tool whose description is already label-length ("List queries")
   * needs no second wording, and consumers fall back.
   */
  title?: string;
  description: string;
  /**
   * True when the tool only reads — it does not create, change or remove
   * anything the library holds. A caller that runs several tool calls from
   * the same step (an in-process turn loop, say) can safely run a run of
   * these concurrently, since there is nothing for them to race with each
   * other over; a tool without the flag stays ordered, since its effect
   * depends on what ran before it. Absent means false, so the safe default
   * for a new tool is to serialise until it is deliberately marked otherwise.
   */
  readOnly?: boolean;
  inputSchema: Record<string, unknown>;
  /** The View that renders this tool's result, when it has one. */
  ui?: ToolUiBinding;
  /**
   * Erased to the shape the registry actually holds — validated arguments
   * arrive as a plain object. The *typed* signature is on `defineTool`'s
   * parameter, where `FromSchema` derives it from the tool's own schema; this
   * field is what survives after the generic is discharged. Same arrangement as
   * `reposRoute`/`typedRoute` in `packages/api/src/routes/route-helpers.ts`.
   */
  buildRequest: (input: Record<string, unknown>) => ToolRequest;
};

/**
 * The arguments a tool's `buildRequest` receives, derived from its own schema.
 *
 * The `S extends JSONSchema ? … : …` indirection is not decoration. Constraining
 * the generic directly (`<S extends JSONSchema>`) makes tsc instantiate
 * json-schema-to-ts's recursive `JSONSchema` union at every call site and it
 * gives up with TS2589/TS2590 — even on a two-property schema. Constraining to
 * `object` and testing for `JSONSchema` inside the conditional defers that work.
 * `packages/api/src/routes/route-helpers.ts` arrived at the same shape for the
 * same reason; this mirrors it deliberately.
 */
type ToolInput<S> = S extends JSONSchema ? FromSchema<S> : Record<string, unknown>;

/**
 * Register one tool, typing `buildRequest`'s argument from the tool's schema.
 *
 * Before C2 this was `(input: any) => InjectOptions`: the schema was zod and the
 * registry had no way to relate it to the callback. With the schema a JSON
 * Schema literal, `FromSchema` gives each `buildRequest` the real argument type
 * — the same dividend Phase A collected for route handlers, which the plan
 * noted was capped until the zod round-trip went.
 */
export function defineTool<const S extends object>(def: {
  name: string;
  title?: string;
  description: string;
  readOnly?: boolean;
  inputSchema: S;
  ui?: ToolUiBinding;
  buildRequest: (input: ToolInput<S>) => ToolRequest;
}): ToolDefinition {
  return {
    name: def.name,
    ...(def.title ? { title: def.title } : {}),
    description: def.description,
    ...(def.readOnly ? { readOnly: true } : {}),
    ...(def.ui ? { ui: def.ui } : {}),
    inputSchema: stripSchemaIdentity(def.inputSchema) as Record<string, unknown>,
    buildRequest: def.buildRequest as (input: Record<string, unknown>) => ToolRequest,
  };
}

/**
 * The Views this catalogue binds tools to.
 *
 * The strings are the contract between three packages: the tool declares one,
 * `packages/mcp-app` serves a resource under it, and `packages/mcp-server`
 * publishes both. A test in the MCP server asserts every URI named here is a
 * resource it actually serves, so a rename cannot leave a tool pointing at
 * nothing.
 */
export const VIEW_URI = {
  bench: 'ui://sqlib/bench',
  result: 'ui://sqlib/result',
  tutorial: 'ui://sqlib/tutorial',
} as const;

const jsonHeaders = { 'content-type': 'application/json' };
const enc = encodeURIComponent;

const debugBackendsGet = process.env.MCP_DEBUG_BACKEND_GET === '1';

export function debugLog(message: string, meta?: Record<string, unknown>) {
  if (!debugBackendsGet) return;
  const payload = meta ? { message, ...meta } : { message };
  try {
    process.stderr.write(`${JSON.stringify(payload)}\n`);
  } catch {
    // best-effort debug only
  }
}

export const tools: ToolDefinition[] = [
  // Backends
  defineTool({
    name: 'backends.list',
    description: 'List all backends',
    readOnly: true,
    inputSchema: noArgs,
    buildRequest: () => ({ method: 'GET', url: '/backends' }),
  }),
  defineTool({
    name: 'backends.get',
    description: 'Get a backend by id',
    readOnly: true,
    inputSchema: idRequiredArg,
    buildRequest: ({ id }) => {
      const safeId = typeof id === 'string' ? id : String(id ?? '');
      const trimmed = safeId.trim();
      const useId = trimmed || safeId;
      const encoded = enc(useId);
      debugLog('backends.get.request', { rawId: id, trimmed, useId, encoded, path: `/backends/${encoded}` });
      return { method: 'GET', url: `/backends/${encoded}` };
    },
  }),
  defineTool({
    name: 'backends.create',
    description: 'Create a backend',
    inputSchema: backendCreateArg,
    buildRequest: (body) => ({ method: 'POST', url: '/backends', payload: body, headers: jsonHeaders }),
  }),
  defineTool({
    name: 'backends.update',
    description: 'Update a backend',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, body: backendUpdateBody },
      required: ['id', 'body'],
    },
    buildRequest: ({ id, body }) => ({ method: 'PUT', url: `/backends/${enc(id)}`, payload: body, headers: jsonHeaders }),
  }),
  defineTool({
    name: 'backends.delete',
    description: 'Delete a backend',
    inputSchema: idArg,
    buildRequest: ({ id }) => ({ method: 'DELETE', url: `/backends/${enc(id)}` }),
  }),
  defineTool({
    name: 'backends.references',
    description: 'List entities referencing a backend',
    readOnly: true,
    inputSchema: idArg,
    buildRequest: ({ id }) => ({ method: 'GET', url: `/backends/${enc(id)}/references` }),
  }),
  defineTool({
    name: 'backends.stats',
    description: 'Get oxigraph stats for a backend',
    readOnly: true,
    inputSchema: idArg,
    buildRequest: ({ id }) => ({ method: 'GET', url: `/backends/${enc(id)}/stats` }),
  }),
  defineTool({
    name: 'backends.clearData',
    description: 'Clear oxigraph data for a backend',
    inputSchema: idArg,
    buildRequest: ({ id }) => ({ method: 'DELETE', url: `/backends/${enc(id)}/data` }),
  }),

  // Libraries
  defineTool({
    name: 'libraries.list',
    description: 'List libraries',
    readOnly: true,
    inputSchema: acceptArg,
    buildRequest: ({ accept }) => ({ method: 'GET', url: '/libraries', headers: accept ? { accept } : undefined }),
  }),
  defineTool({
    name: 'libraries.get',
    description: 'Get a library by id',
    readOnly: true,
    inputSchema: idAcceptArg,
    buildRequest: ({ id, accept }) => ({ method: 'GET', url: `/libraries/${enc(id)}`, headers: accept ? { accept } : undefined }),
  }),
  defineTool({
    name: 'libraries.create',
    description: 'Create a library',
    inputSchema: libraryCreateArg,
    buildRequest: (body) => ({ method: 'POST', url: '/libraries', payload: body, headers: jsonHeaders }),
  }),
  defineTool({
    name: 'libraries.update',
    description: 'Update a library',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, body: libraryUpdateBody },
      required: ['id', 'body'],
    },
    buildRequest: ({ id, body }) => ({ method: 'PUT', url: `/libraries/${enc(id)}`, payload: body, headers: jsonHeaders }),
  }),
  defineTool({
    name: 'libraries.delete',
    description: 'Delete a library',
    inputSchema: idArg,
    buildRequest: ({ id }) => ({ method: 'DELETE', url: `/libraries/${enc(id)}` }),
  }),
  defineTool({
    name: 'libraries.exportAll',
    description: 'Export all libraries (RDF)',
    readOnly: true,
    inputSchema: acceptArg,
    buildRequest: ({ accept }) => ({ method: 'GET', url: '/libraries/export', headers: accept ? { accept } : undefined }),
  }),
  defineTool({
    name: 'libraries.exportOne',
    description: 'Export a library by id (RDF)',
    readOnly: true,
    inputSchema: idAcceptArg,
    buildRequest: ({ id, accept }) => ({ method: 'GET', url: `/libraries/${enc(id)}/export`, headers: accept ? { accept } : undefined }),
  }),

  // Queries
  defineTool({
    name: 'queries.list',
    description: 'List queries',
    readOnly: true,
    inputSchema: noArgs,
    buildRequest: () => ({ method: 'GET', url: '/queries' }),
  }),
  defineTool({
    name: 'queries.create',
    description: 'Create a query: metadata only (name, isPartOf library, description, tags). It holds no SPARQL — a queryString here is rejected; save the text with queries.createVersion.',
    inputSchema: queryCreateArg,
    buildRequest: (body) => ({ method: 'POST', url: '/queries', payload: body, headers: jsonHeaders }),
  }),
  defineTool({
    name: 'queries.get',
    description: 'Get a query\'s metadata by id. The SPARQL text is on its versions: read currentVersion here, then queries.getVersion.',
    readOnly: true,
    inputSchema: idArg,
    buildRequest: ({ id }) => ({ method: 'GET', url: `/queries/${enc(id)}` }),
  }),
  defineTool({
    name: 'queries.update',
    description: 'Update a query\'s metadata, or point currentVersion at another version. Cannot change SPARQL text — create a version for that.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, body: queryUpdateBody },
      required: ['id', 'body'],
    },
    buildRequest: ({ id, body }) => ({ method: 'PUT', url: `/queries/${enc(id)}`, payload: body, headers: jsonHeaders }),
  }),
  defineTool({
    name: 'queries.delete',
    description: 'Delete a query',
    inputSchema: idArg,
    buildRequest: ({ id }) => ({ method: 'DELETE', url: `/queries/${enc(id)}` }),
  }),
  defineTool({
    name: 'queries.listVersions',
    description: 'List a query\'s versions (each with its integer version number and queryString)',
    readOnly: true,
    inputSchema: idArg,
    buildRequest: ({ id }) => ({ method: 'GET', url: `/queries/${enc(id)}/v` }),
  }),
  defineTool({
    name: 'queries.createVersion',
    description: 'Save SPARQL text as a new immutable version of a query and make it the currentVersion. body: { "queryVersion": { "queryString": "...", "comment": "..." } }. Parameters are VALUES rows that are all UNDEF; they are detected on save.',
    inputSchema: queryVersionBodyArg,
    buildRequest: ({ id, body }) => ({ method: 'POST', url: `/queries/${enc(id)}/v`, payload: body, headers: jsonHeaders }),
  }),
  defineTool({
    name: 'queries.getVersion',
    description: 'Get one version of a query by its integer version number, with its queryString and detected parameters',
    readOnly: true,
    inputSchema: idVersionArg,
    buildRequest: ({ id, version }) => ({ method: 'GET', url: `/queries/${enc(id)}/v/${enc(version)}` }),
  }),
  defineTool({
    name: 'queries.patchVersion',
    description: 'Annotate a query version: only `comment` is writable (plus `immutable: true` to freeze an old version). A version is a snapshot — to change its content, create a new version.',
    inputSchema: idVersionBodyArg,
    buildRequest: ({ id, version, body }) => ({ method: 'PATCH', url: `/queries/${enc(id)}/v/${enc(version)}`, payload: body, headers: jsonHeaders }),
  }),
  defineTool({
    name: 'queries.listArgumentSets',
    description: 'List argument sets for a query',
    readOnly: true,
    inputSchema: idArg,
    buildRequest: ({ id }) => ({ method: 'GET', url: `/queries/${enc(id)}/argument-sets` }),
  }),
  defineTool({
    name: 'queries.attachArgumentSet',
    description: 'Create a saved argument set for a query: body { name, tupleBindings?, scalarBindings? }. Its id can then be passed to execute.run as argumentSetIds.',
    inputSchema: idBodyArg,
    buildRequest: ({ id, body }) => ({ method: 'POST', url: `/queries/${enc(id)}/argument-sets`, payload: body, headers: jsonHeaders }),
  }),

  // Query group argument sets — the group half of the pair above, which the
  // registry carried for queries only.
  defineTool({
    name: 'queryGroups.listArgumentSets',
    description: 'List the argument sets made against a query group',
    readOnly: true,
    inputSchema: idArg,
    buildRequest: ({ id }) => ({ method: 'GET', url: `/query-groups/${enc(id)}/argument-sets` }),
  }),
  defineTool({
    name: 'queryGroups.attachArgumentSet',
    description: 'Attach an argument set to a query group',
    inputSchema: idBodyArg,
    buildRequest: ({ id, body }) => ({ method: 'POST', url: `/query-groups/${enc(id)}/argument-sets`, payload: body, headers: jsonHeaders }),
  }),

  // Execution
  defineTool({
    name: 'execute.run',
    description:
      'Run a query (targetId = query id, runs its currentVersion; backendId required) or a query group (no backendId). Fill parameter slots with arguments: one SPARQL-results-JSON entry per all-UNDEF VALUES clause, in order; limits/offsets by placeholder name. Results render as an interactive table where the client supports MCP Apps — prefer this over reprinting rows yourself.',
    readOnly: true,
    inputSchema: executionRequestArg,
    ui: { resourceUri: VIEW_URI.result },
    buildRequest: (body) => ({ method: 'POST', url: '/execute', payload: body, headers: jsonHeaders }),
  }),

  // SPARQL proxy
  defineTool({
    name: 'sparql.proxyQuery',
    description:
      'Run ad-hoc SPARQL text against a backend (by backendId or endpoint URL) without saving it. Accepts the same arguments/limits/offsets as execute.run. Results render as an interactive table where the client supports MCP Apps — prefer this over reprinting rows yourself.',
    readOnly: true,
    inputSchema: sparqlRequestArg,
    ui: { resourceUri: VIEW_URI.result },
    buildRequest: (body) => ({ method: 'POST', url: '/sparql', payload: body, headers: jsonHeaders }),
  }),

  // Patches — propose a write as a diff, then apply the diff that was approved
  defineTool({
    name: 'patches.previewUpdate',
    description:
      'Show the exact triples a SPARQL update would add and remove, without running it',
    readOnly: true,
    inputSchema: patchPreviewArg,
    buildRequest: (body) => ({ method: 'POST', url: '/patches/preview', payload: body, headers: jsonHeaders }),
  }),
  defineTool({
    name: 'patches.apply',
    description: 'Apply a previewed patch by id, or derive and apply an update',
    inputSchema: patchApplyArg,
    buildRequest: (body) => ({ method: 'POST', url: '/patches/apply', payload: body, headers: jsonHeaders }),
  }),

  // Detection
  defineTool({
    name: 'detection.detectInputs',
    description: 'Detect a query\'s declared parameters: all-UNDEF VALUES clauses (valuesInputs, as variable groups in order) and LIMIT 000n / OFFSET 000n placeholders. Use before execute.run to know what arguments to supply.',
    readOnly: true,
    inputSchema: detectQueryRequestArg,
    buildRequest: (body) => ({ method: 'POST', url: '/detect-inputs', payload: body, headers: jsonHeaders }),
  }),
  defineTool({
    name: 'detection.detectOutputs',
    description: 'Detect outputs from a SPARQL query',
    readOnly: true,
    inputSchema: detectQueryRequestArg,
    buildRequest: (body) => ({ method: 'POST', url: '/detect-outputs', payload: body, headers: jsonHeaders }),
  }),
  defineTool({
    name: 'detection.validateQuery',
    description: 'Check SPARQL text parses, before saving it as a version',
    readOnly: true,
    inputSchema: detectQueryRequestArg,
    buildRequest: (body) => ({ method: 'POST', url: '/validate', payload: body, headers: jsonHeaders }),
  }),
  defineTool({
    name: 'detection.validateRuleData',
    description: 'Validate RULE/DATA blocks',
    readOnly: true,
    inputSchema: validateRuleDataRequestArg,
    buildRequest: (body) => ({ method: 'POST', url: '/validate-rule-data', payload: body, headers: jsonHeaders }),
  }),
  defineTool({
    name: 'detection.format',
    description: 'Format SPARQL or RULE/DATA code',
    readOnly: true,
    inputSchema: formatRequestArg,
    buildRequest: (body) => ({ method: 'POST', url: '/format', payload: body, headers: jsonHeaders }),
  }),

  // Argument sets
  defineTool({
    name: 'argumentSets.list',
    description: 'List every argument set in a library',
    readOnly: true,
    inputSchema: libraryIdArg,
    buildRequest: ({ libraryId }) => ({ method: 'GET', url: `/argument-sets?libraryId=${enc(libraryId)}` }),
  }),
  defineTool({
    name: 'argumentSets.create',
    description: 'Create an argument set in a library, with no callable to derive one from',
    inputSchema: bodyArg,
    buildRequest: ({ body }) => ({ method: 'POST', url: '/argument-sets', payload: body, headers: jsonHeaders }),
  }),
  defineTool({
    name: 'argumentSets.listVersions',
    description: 'List an argument set\'s versions',
    readOnly: true,
    inputSchema: idArg,
    buildRequest: ({ id }) => ({ method: 'GET', url: `/argument-sets/${enc(id)}/v` }),
  }),
  defineTool({
    name: 'argumentSets.getVersion',
    description: 'Get one version of an argument set',
    readOnly: true,
    inputSchema: idVersionArg,
    buildRequest: ({ id, version }) => ({ method: 'GET', url: `/argument-sets/${enc(id)}/v/${enc(version)}` }),
  }),
  defineTool({
    name: 'argumentSets.createVersion',
    description: 'Save a new version of an argument set',
    inputSchema: idBodyArg,
    buildRequest: ({ id, body }) => ({ method: 'POST', url: `/argument-sets/${enc(id)}/v`, payload: body, headers: jsonHeaders }),
  }),
  defineTool({
    name: 'argumentSets.exportVersion',
    description: 'Export one pinned version of an argument set',
    readOnly: true,
    inputSchema: idVersionArg,
    buildRequest: ({ id, version }) => ({ method: 'GET', url: `/argument-sets/${enc(id)}/v/${enc(version)}/export` }),
  }),
  defineTool({
    name: 'argumentSets.get',
    description: 'Get argument set detail',
    readOnly: true,
    inputSchema: idArg,
    buildRequest: ({ id }) => ({ method: 'GET', url: `/argument-sets/${enc(id)}` }),
  }),
  defineTool({
    name: 'argumentSets.delete',
    description: 'Delete an argument set',
    inputSchema: idArg,
    buildRequest: ({ id }) => ({ method: 'DELETE', url: `/argument-sets/${enc(id)}` }),
  }),
  defineTool({
    name: 'argumentSets.export',
    description: 'Export an argument set',
    readOnly: true,
    inputSchema: idArg,
    buildRequest: ({ id }) => ({ method: 'GET', url: `/argument-sets/${enc(id)}/export` }),
  }),

  // Data blocks
  defineTool({
    name: 'dataBlocks.list',
    description: 'List data blocks',
    readOnly: true,
    inputSchema: noArgs,
    buildRequest: () => ({ method: 'GET', url: '/data-blocks' }),
  }),
  defineTool({
    name: 'dataBlocks.create',
    description: 'Create data block',
    inputSchema: bodyArg,
    buildRequest: ({ body }) => ({ method: 'POST', url: '/data-blocks', payload: body, headers: jsonHeaders }),
  }),
  defineTool({
    name: 'dataBlocks.get',
    description: 'Get data block',
    readOnly: true,
    inputSchema: idArg,
    buildRequest: ({ id }) => ({ method: 'GET', url: `/data-blocks/${enc(id)}` }),
  }),
  defineTool({
    name: 'dataBlocks.update',
    description: 'Update data block',
    inputSchema: idBodyArg,
    buildRequest: ({ id, body }) => ({ method: 'PUT', url: `/data-blocks/${enc(id)}`, payload: body, headers: jsonHeaders }),
  }),
  defineTool({
    name: 'dataBlocks.delete',
    description: 'Delete data block',
    inputSchema: idArg,
    buildRequest: ({ id }) => ({ method: 'DELETE', url: `/data-blocks/${enc(id)}` }),
  }),
  defineTool({
    name: 'dataBlocks.listVersions',
    description: 'List data block versions',
    readOnly: true,
    inputSchema: idArg,
    buildRequest: ({ id }) => ({ method: 'GET', url: `/data-blocks/${enc(id)}/versions` }),
  }),
  defineTool({
    name: 'dataBlocks.createVersion',
    description: 'Create data block version',
    inputSchema: idBodyArg,
    buildRequest: ({ id, body }) => ({ method: 'POST', url: `/data-blocks/${enc(id)}/versions`, payload: body, headers: jsonHeaders }),
  }),
  defineTool({
    name: 'dataBlocks.getVersion',
    description: 'Get data block version',
    readOnly: true,
    inputSchema: idVersionArg,
    buildRequest: ({ id, version }) => ({ method: 'GET', url: `/data-blocks/${enc(id)}/versions/${enc(version)}` }),
  }),
  defineTool({
    name: 'dataBlocks.patchVersion',
    description: 'Annotate a data block version: only `comment` is writable (plus `immutable: true` to freeze an old version). A version is a snapshot — to change its content, create a new version.',
    inputSchema: idVersionBodyArg,
    buildRequest: ({ id, version, body }) => ({ method: 'PATCH', url: `/data-blocks/${enc(id)}/versions/${enc(version)}`, payload: body, headers: jsonHeaders }),
  }),
  defineTool({
    name: 'dataBlocks.deleteVersion',
    description: 'Delete data block version',
    inputSchema: idVersionArg,
    buildRequest: ({ id, version }) => ({ method: 'DELETE', url: `/data-blocks/${enc(id)}/versions/${enc(version)}` }),
  }),

  // Rules
  defineTool({
    name: 'rules.list',
    description: 'List rules',
    readOnly: true,
    inputSchema: noArgs,
    buildRequest: () => ({ method: 'GET', url: '/rules' }),
  }),
  defineTool({
    name: 'rules.create',
    description: 'Create rule',
    inputSchema: bodyArg,
    buildRequest: ({ body }) => ({ method: 'POST', url: '/rules', payload: body, headers: jsonHeaders }),
  }),
  defineTool({
    name: 'rules.get',
    description: 'Get rule',
    readOnly: true,
    inputSchema: idArg,
    buildRequest: ({ id }) => ({ method: 'GET', url: `/rules/${enc(id)}` }),
  }),
  defineTool({
    name: 'rules.update',
    description: 'Update rule',
    inputSchema: idBodyArg,
    buildRequest: ({ id, body }) => ({ method: 'PUT', url: `/rules/${enc(id)}`, payload: body, headers: jsonHeaders }),
  }),
  defineTool({
    name: 'rules.delete',
    description: 'Delete rule',
    inputSchema: idArg,
    buildRequest: ({ id }) => ({ method: 'DELETE', url: `/rules/${enc(id)}` }),
  }),
  defineTool({
    name: 'rules.listVersions',
    description: 'List rule versions',
    readOnly: true,
    inputSchema: idArg,
    buildRequest: ({ id }) => ({ method: 'GET', url: `/rules/${enc(id)}/versions` }),
  }),
  defineTool({
    name: 'rules.createVersion',
    description: 'Create rule version',
    inputSchema: idBodyArg,
    buildRequest: ({ id, body }) => ({ method: 'POST', url: `/rules/${enc(id)}/versions`, payload: body, headers: jsonHeaders }),
  }),
  defineTool({
    name: 'rules.getVersion',
    description: 'Get rule version',
    readOnly: true,
    inputSchema: idVersionArg,
    buildRequest: ({ id, version }) => ({ method: 'GET', url: `/rules/${enc(id)}/versions/${enc(version)}` }),
  }),
  defineTool({
    name: 'rules.patchVersion',
    description: 'Annotate a rule version: only `comment` is writable (plus `immutable: true` to freeze an old version). A version is a snapshot — to change its content, create a new version.',
    inputSchema: idVersionBodyArg,
    buildRequest: ({ id, version, body }) => ({ method: 'PATCH', url: `/rules/${enc(id)}/versions/${enc(version)}`, payload: body, headers: jsonHeaders }),
  }),
  defineTool({
    name: 'rules.deleteVersion',
    description: 'Delete rule version',
    inputSchema: idVersionArg,
    buildRequest: ({ id, version }) => ({ method: 'DELETE', url: `/rules/${enc(id)}/versions/${enc(version)}` }),
  }),
  defineTool({
    name: 'rules.execute',
    description: 'Execute a rule',
    readOnly: true,
    inputSchema: idOptionalBodyArg,
    buildRequest: ({ id, body }) => ({ method: 'POST', url: `/rules/${enc(id)}/execute`, payload: body ?? {}, headers: jsonHeaders }),
  }),
  defineTool({
    name: 'rules.previewNormalize',
    description: 'Preview normalized RULE/DATA',
    readOnly: true,
    inputSchema: ruleStringArg,
    buildRequest: (body) => ({ method: 'POST', url: '/rules/preview/normalize', payload: body, headers: jsonHeaders }),
  }),

  // Rule sets
  defineTool({
    name: 'ruleSets.list',
    description: 'List rule sets',
    readOnly: true,
    inputSchema: noArgs,
    buildRequest: () => ({ method: 'GET', url: '/rule-sets' }),
  }),
  defineTool({
    name: 'ruleSets.create',
    description: 'Create rule set',
    inputSchema: bodyArg,
    buildRequest: ({ body }) => ({ method: 'POST', url: '/rule-sets', payload: body, headers: jsonHeaders }),
  }),
  defineTool({
    name: 'ruleSets.get',
    description: 'Get rule set',
    readOnly: true,
    inputSchema: idArg,
    buildRequest: ({ id }) => ({ method: 'GET', url: `/rule-sets/${enc(id)}` }),
  }),
  defineTool({
    name: 'ruleSets.update',
    description: 'Update rule set',
    inputSchema: idBodyArg,
    buildRequest: ({ id, body }) => ({ method: 'PUT', url: `/rule-sets/${enc(id)}`, payload: body, headers: jsonHeaders }),
  }),
  defineTool({
    name: 'ruleSets.delete',
    description: 'Delete rule set',
    inputSchema: idArg,
    buildRequest: ({ id }) => ({ method: 'DELETE', url: `/rule-sets/${enc(id)}` }),
  }),
  defineTool({
    name: 'ruleSets.listVersions',
    description: 'List rule set versions',
    readOnly: true,
    inputSchema: idArg,
    buildRequest: ({ id }) => ({ method: 'GET', url: `/rule-sets/${enc(id)}/versions` }),
  }),
  defineTool({
    name: 'ruleSets.createVersion',
    description: 'Create rule set version',
    inputSchema: idBodyArg,
    buildRequest: ({ id, body }) => ({ method: 'POST', url: `/rule-sets/${enc(id)}/versions`, payload: body, headers: jsonHeaders }),
  }),
  defineTool({
    name: 'ruleSets.getVersion',
    description: 'Get rule set version',
    readOnly: true,
    inputSchema: idVersionArg,
    buildRequest: ({ id, version }) => ({ method: 'GET', url: `/rule-sets/${enc(id)}/versions/${enc(version)}` }),
  }),
  defineTool({
    name: 'ruleSets.patchVersion',
    description: 'Annotate a rule set version: only `comment` is writable (plus `immutable: true` to freeze an old version). A version is a snapshot — to change its content, create a new version.',
    inputSchema: idVersionBodyArg,
    buildRequest: ({ id, version, body }) => ({ method: 'PATCH', url: `/rule-sets/${enc(id)}/versions/${enc(version)}`, payload: body, headers: jsonHeaders }),
  }),
  defineTool({
    name: 'ruleSets.deleteVersion',
    description: 'Delete rule set version',
    inputSchema: idVersionArg,
    buildRequest: ({ id, version }) => ({ method: 'DELETE', url: `/rule-sets/${enc(id)}/versions/${enc(version)}` }),
  }),
  defineTool({
    name: 'ruleSets.execute',
    description: 'Execute rule set (non-streaming)',
    readOnly: true,
    inputSchema: idOptionalBodyArg,
    buildRequest: ({ id, body }) => ({ method: 'POST', url: `/rule-sets/${enc(id)}/execute`, payload: body ?? {}, headers: jsonHeaders }),
  }),

  // Query groups (core endpoints)
  defineTool({
    name: 'queryGroups.list',
    description: 'List query groups',
    readOnly: true,
    inputSchema: noArgs,
    buildRequest: () => ({ method: 'GET', url: '/query-groups' }),
  }),
  defineTool({
    name: 'queryGroups.create',
    description: 'Create query group',
    inputSchema: bodyArg,
    buildRequest: ({ body }) => ({ method: 'POST', url: '/query-groups', payload: body, headers: jsonHeaders }),
  }),
  defineTool({
    name: 'queryGroups.get',
    description: 'Get query group',
    readOnly: true,
    inputSchema: idArg,
    buildRequest: ({ id }) => ({ method: 'GET', url: `/query-groups/${enc(id)}` }),
  }),
  defineTool({
    name: 'queryGroups.update',
    description: 'Update query group',
    inputSchema: idBodyArg,
    buildRequest: ({ id, body }) => ({ method: 'PUT', url: `/query-groups/${enc(id)}`, payload: body, headers: jsonHeaders }),
  }),
  defineTool({
    name: 'queryGroups.delete',
    description: 'Delete query group',
    inputSchema: idArg,
    buildRequest: ({ id }) => ({ method: 'DELETE', url: `/query-groups/${enc(id)}` }),
  }),
  defineTool({
    name: 'queryGroups.listVersions',
    description: 'List query group versions',
    readOnly: true,
    inputSchema: idArg,
    buildRequest: ({ id }) => ({ method: 'GET', url: `/query-groups/${enc(id)}/v` }),
  }),
  defineTool({
    name: 'queryGroups.createVersion',
    description: 'Create query group version',
    inputSchema: idBodyArg,
    buildRequest: ({ id, body }) => ({ method: 'POST', url: `/query-groups/${enc(id)}/v`, payload: body, headers: jsonHeaders }),
  }),
  defineTool({
    name: 'queryGroups.getVersion',
    description: 'Get query group version',
    readOnly: true,
    inputSchema: idVersionArg,
    buildRequest: ({ id, version }) => ({ method: 'GET', url: `/query-groups/${enc(id)}/v/${enc(version)}` }),
  }),
  defineTool({
    name: 'queryGroups.patchVersion',
    description: 'Annotate a query group version: only `comment` is writable (plus `immutable: true` to freeze an old version). A version is a snapshot — to change its content, create a new version.',
    inputSchema: idVersionBodyArg,
    buildRequest: ({ id, version, body }) => ({ method: 'PATCH', url: `/query-groups/${enc(id)}/v/${enc(version)}`, payload: body, headers: jsonHeaders }),
  }),
  defineTool({
    name: 'queryGroups.validateVersion',
    description: 'Validate query group version',
    readOnly: true,
    inputSchema: idVersionArg,
    buildRequest: ({ id, version }) => ({ method: 'GET', url: `/query-groups/${enc(id)}/v/${enc(version)}/validate` }),
  }),
  // Data graphs — reference RDF a library holds, and the only route to toy
  // data an MCP caller has. The routes existed from the start; the tools did
  // not, so an agent could register a backend it had no way to fill.
  defineTool({
    name: 'dataGraphs.list',
    description: 'List data graphs',
    readOnly: true,
    inputSchema: noArgs,
    buildRequest: () => ({ method: 'GET', url: '/data-graphs' }),
  }),
  defineTool({
    name: 'dataGraphs.get',
    description: 'Get a data graph (metadata and its currentVersion pointer; the RDF lives on the version)',
    readOnly: true,
    inputSchema: idArg,
    buildRequest: ({ id }) => ({ method: 'GET', url: `/data-graphs/${enc(id)}` }),
  }),
  defineTool({
    name: 'dataGraphs.create',
    description: 'Create a data graph: metadata only, body { name, isPartOf: [libraryId], description?, tags? }. The RDF goes in a version — see dataGraphs.createVersion.',
    inputSchema: bodyArg,
    buildRequest: ({ body }) => ({ method: 'POST', url: '/data-graphs', payload: body, headers: jsonHeaders }),
  }),
  defineTool({
    name: 'dataGraphs.createVersion',
    description: 'Save RDF as an immutable data graph version: body { contentString, contentFormat?: "turtle" | "ntriples" | ..., comment? }. A backend whose oxigraphConfig names this graph in `sources` is hydrated from it.',
    inputSchema: idBodyArg,
    buildRequest: ({ id, body }) => ({ method: 'POST', url: `/data-graphs/${enc(id)}/versions`, payload: body, headers: jsonHeaders }),
  }),
  defineTool({
    name: 'dataGraphs.listVersions',
    description: 'List a data graph\'s versions',
    readOnly: true,
    inputSchema: idArg,
    buildRequest: ({ id }) => ({ method: 'GET', url: `/data-graphs/${enc(id)}/versions` }),
  }),
  defineTool({
    name: 'dataGraphs.getVersion',
    description: 'Get one data graph version, with its serialised RDF',
    readOnly: true,
    inputSchema: idVersionArg,
    buildRequest: ({ id, version }) => ({ method: 'GET', url: `/data-graphs/${enc(id)}/versions/${enc(version)}` }),
  }),

  // The app door. One tool, because the bench needs somewhere to be opened
  // from; everything it does afterwards it does with the tools above.
  defineTool({
    name: 'app.bench.open',
    title: 'Open the query bench',
    description:
      'Open the interactive query bench on a saved query (`queryId`) or on draft SPARQL (`queryString`), in the library `libraryId`. The bench shows the text, the parameters detected in it, an argument grid, and runs it against a backend. Use it when the user wants to work on a query rather than be told about one; it needs a client that renders MCP Apps.',
    readOnly: true,
    inputSchema: benchOpenArg,
    ui: { resourceUri: VIEW_URI.bench },
    // The bench needs a library and its backends to open at all; the query, if
    // there is one, the View fetches for itself. Opening on nothing but draft
    // text is the common case in a chat, so `libraryId` is what this resolves.
    buildRequest: ({ libraryId }) => ({ method: 'GET', url: `/libraries/${enc(libraryId)}` }),
  }),

  // SRL documents as text, stored nowhere. The three questions a rules editor
  // asks while someone types — does it parse and stratify, what SPARQL is it,
  // what does it infer — which an agent helping with rules needs as much as
  // the tutorial does. All three are on a read-only deployment's allowlist.
  defineTool({
    name: 'srl.analyze',
    description:
      'Analyse an SRL (SPARQL rules) document without storing it: whether it parses (valid/error), each rule\'s stratum and monotonicity, the dependency edges, stratification issues and cycles, and well-formedness issues (unbound-head, set-rebinds, use-before-bind). A syntax error is reported as valid: false, not as a failure.',
    readOnly: true,
    inputSchema: srlDocumentArg,
    buildRequest: (body) => ({ method: 'POST', url: '/rule-sets/srl/analyze', payload: body, headers: jsonHeaders }),
  }),
  defineTool({
    name: 'srl.compile',
    description:
      'Compile each rule of an SRL document to the SPARQL it runs as: INSERT … WHERE by default, or CONSTRUCT … WHERE with flavour "construct" (one pass of the rule, returning what it would add). Nothing is stored.',
    readOnly: true,
    inputSchema: srlCompileArg,
    buildRequest: (body) => ({ method: 'POST', url: '/rule-sets/srl/compile', payload: body, headers: jsonHeaders }),
  }),
  defineTool({
    name: 'srl.run',
    description:
      'Run an SRL document to fixpoint without saving it, against at most one base graph: a data graph version (dataGraphVersionId), a data graph at its current version (dataGraphId) or inline RDF (dataGraphInline, Turtle by default). Returns the final graph as N-Quads (finalGraphNQuads), the triples the DATA blocks seeded, and per-iteration, per-rule inserts.',
    readOnly: true,
    inputSchema: srlRunArg,
    buildRequest: (body) => ({ method: 'POST', url: '/playground/rules/execute', payload: body, headers: jsonHeaders }),
  }),

  // What the tutorial reads a library through. App-only: they carry nothing an
  // agent is short of — it has libraries, rule sets and queries already — and
  // each would cost every session a listing entry to say so.
  defineTool({
    name: 'tags.list',
    description: 'List tags, optionally one library\'s',
    readOnly: true,
    inputSchema: tagsListArg,
    ui: { resourceUri: VIEW_URI.tutorial, visibility: ['app'] },
    buildRequest: ({ library }) => ({ method: 'GET', url: library ? `/tags?library=${enc(library)}` : '/tags' }),
  }),
  defineTool({
    name: 'tests.list',
    description: 'List tests, optionally by subject, subject kind or tags (comma-separated tag ids)',
    readOnly: true,
    inputSchema: testsListArg,
    ui: { resourceUri: VIEW_URI.tutorial, visibility: ['app'] },
    buildRequest: (query) => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (typeof value === 'string' && value) params.set(key, value);
      }
      const search = params.toString();
      return { method: 'GET', url: search ? `/tests?${search}` : '/tests' };
    },
  }),
  defineTool({
    name: 'tests.listVersions',
    description: 'List a test\'s versions, each with its cases (data graph version, expected result and its format)',
    readOnly: true,
    inputSchema: idArg,
    ui: { resourceUri: VIEW_URI.tutorial, visibility: ['app'] },
    buildRequest: ({ id }) => ({ method: 'GET', url: `/tests/${enc(id)}/versions` }),
  }),
  defineTool({
    name: 'ruleSets.exportSrl',
    description: 'A rule set as one SRL document, at its current version or the version named, abbreviated against `prologue` (PREFIX lines) when given',
    readOnly: true,
    inputSchema: ruleSetSrlArg,
    ui: { resourceUri: VIEW_URI.tutorial, visibility: ['app'] },
    buildRequest: ({ id, version, prologue }) => {
      const params = new URLSearchParams();
      if (version) params.set('version', version);
      if (prologue) params.set('prologue', prologue);
      const search = params.toString();
      return { method: 'GET', url: `/rule-sets/${enc(id)}/srl${search ? `?${search}` : ''}` };
    },
  }),

  // The tutorial door: a library read as a course. Lessons are the library's
  // numbered tags; see docs/guides/mcp-app.md.
  defineTool({
    name: 'app.tutorial.open',
    title: 'Open a rules tutorial',
    description:
      'Open the interactive tutorial for a library laid out as lessons (numbered tags such as "1. Your first rule"): each lesson\'s objectives, worked examples and exercises, with an SRL/SPARQL editor that runs, analyses and checks the user\'s answer. Pass `lesson` (a number or tag id) to open on one. Use it when the user wants to learn SPARQL rules (SRL) by doing; it needs a client that renders MCP Apps. The tutorial keeps no progress — you are the tutor, and it tells you when the user runs or checks something.',
    readOnly: true,
    inputSchema: tutorialOpenArg,
    ui: { resourceUri: VIEW_URI.tutorial },
    buildRequest: ({ libraryId }) => ({ method: 'GET', url: `/libraries/${enc(libraryId)}` }),
  }),
];