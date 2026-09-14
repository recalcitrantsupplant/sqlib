/**
 * The shapes of properties stored as `rdf:JSON`.
 *
 * `'@type': rdf.JSON` says a property's object is a JSON document; it cannot
 * say *which* document. That is the same gap `@values` fills for IRIs, and it
 * matters for the same reason: a property the model describes only as "some
 * JSON" reaches the published contract as an untyped blob, so a client has
 * nothing to write against and the server has nothing to reject a malformed
 * value with.
 *
 * A shape is declared once here and emitted twice — as the JSON Schema fragment
 * the OpenAPI document carries, and as the zod source the generated contract
 * leaf carries — so the two cannot drift. `schemaIntrospection` does not read
 * this: at the persistence layer a JSON value is a JSON value, and it is the
 * *contract* that narrows it.
 */

/** A named JSON document shape, in both emitted forms. */
export interface JsonShape {
  /** The JSON Schema fragment, emitted into the OpenAPI document verbatim. */
  jsonSchema: Record<string, unknown>;
  /**
   * The zod source emitted into the generated contract module.
   *
   * Source rather than a zod object because the generator writes a TypeScript
   * module as text; it never evaluates the schema it emits.
   */
  zod: string;
}

/**
 * `QueryNode.backendConfig` — the per-run store a node reads instead of a
 * registered backend.
 *
 * Discriminated on `type` with a single member today. That is deliberate: the
 * discriminator is what lets a second kind of ephemeral backend be added
 * without the field's absence and its presence-with-an-unknown-type becoming
 * the same case at every read site.
 */
export const EPHEMERAL_BACKEND_CONFIG: JsonShape = {
  jsonSchema: {
    // `title` is the shape's name in both emissions: it documents the fragment
    // in the published OpenAPI document, and it is what the zod deriver looks
    // the shape up by. A standard keyword rather than an `x-` extension, so
    // nothing downstream has to strip it before ajv sees it.
    title: 'EphemeralBackendConfig',
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['ephemeral-oxigraph'] },
      storeId: { type: 'string', minLength: 1 },
    },
    required: ['type', 'storeId'],
    additionalProperties: false,
  },
  zod: `z
  .object({
    type: z.literal('ephemeral-oxigraph'),
    storeId: z.string().min(1, 'storeId must be a non-empty string'),
  })
  .strict()`,
};

/** Every declared shape, keyed by the name a property's `@jsonShape` names. */
export const JSON_SHAPES = {
  EphemeralBackendConfig: EPHEMERAL_BACKEND_CONFIG,
} as const;

export type JsonShapeName = keyof typeof JSON_SHAPES;

export function jsonShape(name: string): JsonShape {
  const shape = (JSON_SHAPES as Record<string, JsonShape | undefined>)[name];
  if (!shape) {
    throw new Error(
      `No JSON shape named "${name}". Declare it in packages/api/src/persistence/jsonShapes.ts.`,
    );
  }
  return shape;
}
