/**
 * JSON Schema for tool arguments.
 *
 * Phase C2 (issue #65): MCP speaks JSON Schema natively, so tool `inputSchema`s
 * are JSON Schema documents rather than zod converted at registration time.
 *
 * Two kinds live here:
 *
 *  - **Hub-sourced.** Where a tool forwards a request body to an API endpoint,
 *    its schema is the *same document the API registers for that endpoint*,
 *    imported from `@sparql-query-lib/contracts/schema{,/routes}`. MCP and HTTP
 *    then cannot disagree about what a valid payload is, because there is only
 *    one document.
 *  - **Argument shapes.** The other tools take path/query arguments (`id`,
 *    `version`, `accept`) which are not an API entity — nothing in the hub
 *    corresponds to them. Sixty-nine tool definitions draw on the eleven
 *    literals below; they are written out once and shared rather than repeated
 *    per tool.
 *
 * These are `as const` so `FromSchema` can infer argument types through them,
 * the same way `packages/api/src/routes/route-helpers.ts` types its handlers.
 */
import {
  createBackendSchema,
  updateBackendSchema,
  createLibrarySchema,
  updateLibrarySchema,
  createQuerySchema,
  updateQuerySchema,
} from '@sparql-query-lib/contracts/schema';
import {
  detectionRouteSchemas,
  executionRouteSchemas,
  sparqlRequestJsonSchema,
  patchPreviewJsonSchema,
  patchApplyJsonSchema,
} from '@sparql-query-lib/contracts/schema/routes';

// --- Argument shapes -------------------------------------------------------
//
// `additionalProperties` is deliberately left unset (i.e. permissive) on every
// shape below. The zod `z.object({...})` these replace *stripped* unknown keys
// rather than rejecting them, so a client sending an extra argument was
// accepted; `additionalProperties: false` would turn that into a rejection.
// Preserving the accept/reject verdict is the point of the C2 parity harness
// (test/toolSchemaParity.test.ts) — tightening it would be a separate,
// deliberate change.

/** `z.object({})` — tools that take no arguments. */
export const noArgs = {
  type: 'object',
  properties: {},
} as const;

/** `z.object({ id: z.string() })` — by far the most common shape. */
export const idArg = {
  type: 'object',
  properties: { id: { type: 'string' } },
  required: ['id'],
} as const;

/**
 * `z.object({ id: z.string().trim().min(1, 'id is required') })` — `backends.get`.
 *
 * `pattern: '\\S'` is what carries the `.trim().min(1)` verdict across: zod
 * trimmed *before* the length check, so a whitespace-only id failed. JSON Schema
 * has no trim, and `minLength: 1` alone would accept `"   "` — the tool would
 * then request `/backends/%20%20%20`. Requiring one non-whitespace character
 * reproduces the rejection exactly. The trim *transform* is not lost either:
 * `backends.get`'s buildRequest already trims the id itself.
 */
export const idRequiredArg = {
  type: 'object',
  properties: { id: { type: 'string', minLength: 1, pattern: '\\S' } },
  required: ['id'],
} as const;

/** `z.object({ id: z.string(), version: z.string() })` */
export const idVersionArg = {
  type: 'object',
  properties: { id: { type: 'string' }, version: { type: 'string' } },
  required: ['id', 'version'],
} as const;

/** `z.object({ body: z.record(z.string(), z.any()) })` */
export const bodyArg = {
  type: 'object',
  properties: { body: { type: 'object' } },
  required: ['body'],
} as const;

/** A library-scoped listing, e.g. `argumentSets.list`. */
export const libraryIdArg = {
  type: 'object',
  properties: { libraryId: { type: 'string', minLength: 1, pattern: '\\S' } },
  required: ['libraryId'],
} as const;

/**
 * `app.bench.open` — what the query bench needs to paint its first frame.
 *
 * `libraryId` is the only required argument because the bench must know which
 * library it is saving into and which backends it may run against. Everything
 * else is optional: opening on a saved query passes `queryId`, opening on text
 * the model just wrote passes `queryString`, and opening on neither gives an
 * empty bench.
 */
export const benchOpenArg = {
  type: 'object',
  properties: {
    libraryId: { type: 'string', minLength: 1, pattern: '\\S' },
    queryId: { type: 'string' },
    queryString: { type: 'string' },
    backendId: { type: 'string' },
  },
  required: ['libraryId'],
} as const;

/**
 * `app.tutorial.open` — a library laid out as lessons.
 *
 * `lesson` is a tag id or the lesson's number, and is optional: without it the
 * tutorial opens on its first lesson. It picks where to start, nothing more —
 * the tutorial keeps no progress, so there is nothing else to resume.
 */
export const tutorialOpenArg = {
  type: 'object',
  properties: {
    libraryId: { type: 'string', minLength: 1, pattern: '\\S' },
    lesson: { type: 'string' },
  },
  required: ['libraryId'],
} as const;

/** One SRL document, posted as text: `srl.analyze`. */
export const srlDocumentArg = {
  type: 'object',
  properties: { srl: { type: 'string' } },
  required: ['srl'],
} as const;

/** `srl.compile`: the document, and which SPARQL reading of it to return. */
export const srlCompileArg = {
  type: 'object',
  properties: {
    srl: { type: 'string' },
    flavour: { type: 'string', enum: ['insert', 'construct'] },
  },
  required: ['srl'],
} as const;

/**
 * `srl.run`: a document and, at most, one base graph.
 *
 * The three graph fields are the playground route's own, and it refuses more
 * than one; the schema leaves that to the route rather than restating it.
 */
export const srlRunArg = {
  type: 'object',
  properties: {
    srl: { type: 'string' },
    dataGraphVersionId: { type: 'string' },
    dataGraphId: { type: 'string' },
    dataGraphInline: { type: 'string' },
    dataGraphInlineFormat: { type: 'string', enum: ['text/turtle', 'application/n-triples', 'application/n-quads'] },
    maxIterations: { type: 'integer', minimum: 1 },
  },
  required: ['srl'],
} as const;

/** `tags.list`: optionally one library's. */
export const tagsListArg = {
  type: 'object',
  properties: { library: { type: 'string' } },
} as const;

/** `tests.list`: the route's own filters. `tags` is a comma-separated list of tag ids. */
export const testsListArg = {
  type: 'object',
  properties: {
    subject: { type: 'string' },
    subjectKind: { type: 'string' },
    tags: { type: 'string' },
    match: { type: 'string', enum: ['any', 'all'] },
  },
} as const;

/**
 * `ruleSets.exportSrl`: a rule set, at its current version unless one is named.
 *
 * Rules are stored with their IRIs expanded and no prologue, so `prologue` is
 * how a caller gets prefixed names back: the PREFIX lines to write at the top
 * and abbreviate against. Presentation only.
 */
export const ruleSetSrlArg = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    version: { type: 'string' },
    prologue: { type: 'string' },
  },
  required: ['id'],
} as const;

/** `z.object({ id: z.string(), body: z.record(z.string(), z.any()) })` */
export const idBodyArg = {
  type: 'object',
  properties: { id: { type: 'string' }, body: { type: 'object' } },
  required: ['id', 'body'],
} as const;

/**
 * `queries.createVersion` — the same accept/reject verdict as `idBodyArg` (any
 * object body), with the wrapper shape the route enforces written on the
 * property. The route returns 400 on a body without `queryVersion`, and the
 * catalogue used to say nothing about it — which is how an agent ends up
 * sending `{ queryString }` flat, or worse, on `queries.create`. A
 * `description` keyword changes no verdict, so the parity harness is untouched.
 */
export const queryVersionBodyArg = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'The query id (an IRI), not a version id.' },
    body: {
      type: 'object',
      description:
        'Wrapper: { "queryVersion": { "queryString": "<SPARQL>", "comment": "<why>" } }. Optional beside queryVersion: limitParameters, offsetParameters (each [{ name, defaultValue }]). Anything not supplied is derived from the text.',
    },
  },
  required: ['id', 'body'],
} as const;

/** `z.object({ id: z.string(), body: z.record(z.string(), z.any()).optional() })` */
export const idOptionalBodyArg = {
  type: 'object',
  properties: { id: { type: 'string' }, body: { type: 'object' } },
  required: ['id'],
} as const;

/** `z.object({ id: z.string(), version: z.string(), body: z.record(z.string(), z.any()) })` */
export const idVersionBodyArg = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    version: { type: 'string' },
    body: { type: 'object' },
  },
  required: ['id', 'version', 'body'],
} as const;

/** `z.object({ accept: z.string().optional() })` */
export const acceptArg = {
  type: 'object',
  properties: { accept: { type: 'string' } },
} as const;

/** `z.object({ id: z.string(), accept: z.string().optional() })` */
export const idAcceptArg = {
  type: 'object',
  properties: { id: { type: 'string' }, accept: { type: 'string' } },
  required: ['id'],
} as const;

/** `z.object({ ruleString: z.string() })` — `rules.previewNormalize`. */
export const ruleStringArg = {
  type: 'object',
  properties: { ruleString: { type: 'string' } },
  required: ['ruleString'],
} as const;

// --- Hub-sourced request bodies --------------------------------------------

export const backendCreateArg = createBackendSchema.body;
export const backendUpdateBody = updateBackendSchema.body;
export const libraryCreateArg = createLibrarySchema.body;
export const libraryUpdateBody = updateLibrarySchema.body;
export const queryCreateArg = createQuerySchema.body;
export const queryUpdateBody = updateQuerySchema.body;
export const executionRequestArg = executionRouteSchemas.post.body;
export const detectQueryRequestArg = detectionRouteSchemas.detectInputsPost.body;
export const validateRuleDataRequestArg = detectionRouteSchemas.validateRuleDataPost.body;
export const formatRequestArg = detectionRouteSchemas.formatPost.body;

/**
 * `POST /sparql` — now a hub import like every other forwarding tool.
 *
 * It was the one exception: `packages/api` declared the shape as a
 * module-local literal, so there was nothing to import and this file carried a
 * byte-identical copy behind a drift test. Phase B moved the document into
 * `contracts/schema/routes`, so the tool and the route publish the same object.
 */
export const sparqlRequestArg = sparqlRequestJsonSchema;

/**
 * `POST /patches/preview` and `POST /patches/apply`.
 *
 * The pair is the point of the patch surface for an agent: preview needs only
 * `use` on the backend, so a model may propose a write and be shown its exact
 * diff without being able to perform it, and apply then runs the patch a human
 * approved rather than re-reading the SPARQL that produced it.
 */
export const patchPreviewArg = patchPreviewJsonSchema;
export const patchApplyArg = patchApplyJsonSchema;

/**
 * Strip `$schema` and `$id`, at every depth, from a schema about to be compiled
 * or published.
 *
 * Same reason `packages/api/src/lib/validator-setup.ts` strips them before
 * `ajv.compile`: `$id` registers the document in the ajv instance under that
 * key, and three detection tools share one body document (`detection.query.request`),
 * so compiling them into a single ajv would collide. Stripping recursively rather
 * than just at the top level covers the nested case too — `backends.update` and
 * friends embed a hub body, `$id` and all, under `properties.body`.
 *
 * Safe only because no tool schema contains a `$ref`: removing `$id` from a
 * document something refers to would break resolution. That precondition is
 * asserted by a test rather than assumed.
 */
export function stripSchemaIdentity<T>(schema: T): T {
  if (Array.isArray(schema)) {
    return schema.map(stripSchemaIdentity) as unknown as T;
  }
  if (schema && typeof schema === 'object') {
    return Object.fromEntries(
      Object.entries(schema as Record<string, unknown>)
        .filter(([key]) => key !== '$schema' && key !== '$id')
        .map(([key, value]) => [key, stripSchemaIdentity(value)])
    ) as T;
  }
  return schema;
}
