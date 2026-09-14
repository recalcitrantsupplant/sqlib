/**
 * Generic entity contract projection.
 *
 * One builder for every CRUD entity, replacing the per-entity builders that
 * each restated the same ~250 lines of ContractDefinition boilerplate. What
 * genuinely varies per entity is declared in `ENTITY_CONTRACT_MODELS` below;
 * everything else — the zod expression for each field, the create/update
 * variants and the type exports — is projected from the entity schema the
 * generator already parsed.
 *
 * It emitted route schemas and JSON Schema exports too, back when the contract
 * leaf was round-tripped through zod. `emitContractModule` has no field for
 * either and never read them; the route documents fastify registers come from
 * `route-builders/crud.ts`. Both were deleted in Phase D (issue #65).
 */

import { describeSchema } from '../../../src/persistence/schemaIntrospection.js';
import { jsonShape } from '../../../src/persistence/jsonShapes.js';
import type { Schema } from '../../../src/persistence/schema.js';
import type {
  ContractDefinition,
  ZodRefinement,
  ZodReusableType,
  ZodSchemaDefinition,
} from './contract-types.js';

export interface EntityContractModel {
  /** PascalCase entity name, matching `<name>Schema.ts` */
  entityName: string;
  /** camelCase prefix for every generated identifier (`backendShape`, …) */
  varName: string;
  /** JSON Schema `$id` prefix, and the `$ref` target in route responses */
  schemaId: string;
  /** Zod expressions replacing what the entity schema would otherwise derive */
  fieldOverrides?: Record<string, string>;

  /**
   * Contract fields with no corresponding entity-schema property.
   *
   * Each one is a gap in the entity model: the route accepts and returns the
   * field, but no RDF predicate backs it, so nothing downstream of the schema
   * knows it exists. Declaring them keeps the contract as it is while making
   * the gap countable — closing it means adding the predicate, which changes
   * what gets stored and so is not part of this refactor.
   */
  extraFields?: Array<{ name: string; type: ContractFieldType; after: string }>;

  /** Entity-specific reusable types, emitted after the shared ones */
  extraTypes?: ZodReusableType[];

  /**
   * Refinements appended to the *projected* create/update schemas.
   *
   * For a rule the entity model has no way to state because it is not a
   * property of any one property: Backend's "an http backend must carry an
   * endpoint" spans `backendType` and `endpoint` together. `@values`,
   * `@references` and `@pattern` all constrain a single property's values; a
   * cross-field rule is a contract concern, and this is where it goes.
   *
   * Backend used to declare its whole create/update pair verbatim to get at
   * these two, which meant hand-enumerating eight fields the shape already
   * described (issue #65). Declaring only the refinement leaves exactly what
   * the projection cannot produce, and the verbatim escape hatch is gone with
   * it — every entity's write bodies are projected now.
   */
  writeRefinements?: { create?: ZodRefinement[]; update?: ZodRefinement[] };

}

/**
 * The vocabulary an `extraFields` entry draws from.
 *
 * A contract-only field has no entity-schema property to project from, so its
 * type has to be stated — and stated *once*, because two emissions consume it:
 * the zod leaf web validates with, and the JSON Schema body fastify registers.
 * Writing the zod and the JSON Schema separately is how the two grew apart in
 * the first place, so they are declared together here.
 */
export const CONTRACT_FIELD_TYPES = {
  optionalIriArray: {
    zod: 'optionalIriArray',
    json: { type: 'array', items: { type: 'string', format: 'iri' }, nullable: true },
  },
} as const;

export type ContractFieldType = keyof typeof CONTRACT_FIELD_TYPES;

/**
 * The JSON Schema properties an entity's contract adds to a generated route
 * body, in declaration order, keyed by the property they follow.
 */
export function contractExtraProperties(
  model: EntityContractModel
): Array<{ name: string; after: string; schema: Record<string, unknown> }> {
  return (model.extraFields ?? []).map(field => ({
    name: field.name,
    after: field.after,
    schema: CONTRACT_FIELD_TYPES[field.type].json,
  }));
}

const IRI_STRING: ZodReusableType = {
  name: 'iriString',
  definition: `z
  .string()
  .min(1, 'IRI must be a non-empty string')
  .refine(isIri, IRI_ERROR_MESSAGE)`,
  comment: 'IRI validation — the one definition, shared with the server (contracts/src/iri.ts)',
};

/** Always emitted, in this order. */
const BASE_TYPES: ZodReusableType[] = [
  IRI_STRING,
  { name: 'optionalIriString', definition: 'iriString.optional().nullable()' },
  { name: 'isoDateTime', definition: `z.string().datetime({ offset: true }).optional().nullable()` },
  { name: 'nullableString', definition: 'z.string().optional().nullable()' },
];

/**
 * Emitted only when the projected shape references them.
 *
 * `nullableInteger` and `nullableBoolean` are here rather than in `BASE_TYPES`
 * for the same reason the array helpers are: no CRUD entity has a nullable
 * integer or boolean today, so emitting them unconditionally would put an
 * unused const in every generated contract. They exist because `deriveFieldZod`
 * can now project those types, and a derivation that names a const nothing
 * declares is worse than no derivation at all.
 */
const ON_DEMAND_TYPES: ZodReusableType[] = [
  { name: 'iriArray', definition: 'z.array(iriString)' },
  { name: 'optionalIriArray', definition: 'z.array(iriString).optional().nullable()' },
  { name: 'nullableInteger', definition: 'z.number().int().optional().nullable()' },
  { name: 'nullableNumber', definition: 'z.number().optional().nullable()' },
  { name: 'nullableBoolean', definition: 'z.boolean().optional().nullable()' },
];

const LIBRARY_MEMBERSHIP_FIELD = `iriArray.min(1, 'isPartOf must contain at least one library')`;

/**
 * Whether the entity is library-scoped in the way the contract widens for.
 *
 * This was a `libraryMembership: true` flag on four of the seven contract
 * models, which is the entity model's own statement written out again: the
 * property is an array of IRIs that must hold exactly one `Library`, and since
 * Phase B3 (issue #65) `@references` says so. `QueryGroup` is excluded by the
 * same reading it was excluded by before — its `isPartOf` is a scalar, so there
 * is no bare string to widen.
 */
function hasLibraryMembership(entitySchema: Schema): boolean {
  const isPartOf = describeSchema(entitySchema as unknown as Record<string, unknown>).fields.find(
    field => field.name === 'isPartOf'
  );
  return isPartOf?.isArray === true && isPartOf.references?.exactlyOne === 'Library';
}

/** Accepts `isPartOf` as a bare IRI and widens it to the array the shape wants. */
const LIBRARY_MEMBERSHIP_CREATE = `z.preprocess(
    (val) => (typeof val === 'string' ? [val] : val),
    ${LIBRARY_MEMBERSHIP_FIELD}
  )`;

/*
 * Widens a bare `isPartOf` on an update body, the same way the create body
 * does.
 *
 * Typed `unknown` rather than `any`: this runs on whatever a client sent, which
 * is the definition of unknown, and the narrowing it needs is the narrowing the
 * body already performs. It was `any` per generated entity — six of them — and
 * every new library-scoped entity added one more, so the `any` ratchet was
 * counting entities rather than looseness.
 */
const LIBRARY_MEMBERSHIP_UPDATE_PREPROCESS = `(data: unknown) => {
    if (data && typeof data === 'object' && 'isPartOf' in data) {
      const record = data as Record<string, unknown>;
      if (typeof record.isPartOf === 'string') {
        return { ...record, isPartOf: [record.isPartOf] };
      }
    }
    return data;
  }`;

/**
 * `id` on create: absent, null, an IRI, or a temporary URN the backend replaces.
 *
 * `.nullable()` because `deriveCreateBody` marks the generated body's `id`
 * `nullable: true` — "mint me one" is expressible as an explicit null there, and
 * the leaf refusing to send it was drift (Phase C3, issue #65).
 */
const ID_CREATE_FIELD =
  `iriString.or(z.string().regex(/^urn:temp:/, 'Temporary URN must start with urn:temp:')).optional().nullable()`;

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** The reusable-type identifier for a property's declared vocabulary. */
function enumTypeName(key: string): string {
  return `${key}Enum`;
}

/**
 * `const backendTypeEnum = z.enum(['http', 'oxigraphEphemeral'])`, one per
 * vocabulary.
 *
 * A nullable vocabulary lists `null` among its permitted values, because
 * `nullable: true` is not a keyword ajv honours (see `type-mappings.ts`).
 * Nullability is `.optional().nullable()` on the zod side, so the token list
 * drops it rather than emitting a `'null'` *string* into the enum.
 */
function enumReusableTypes(properties: Record<string, any>): ZodReusableType[] {
  return Object.entries(properties)
    .filter(([, prop]) => Array.isArray(prop.enum))
    .map(([key, prop]) => ({
      name: enumTypeName(key),
      definition: `z.enum([${prop.enum
        .filter((value: unknown) => value !== null)
        .map((value: string) => `'${value}'`)
        .join(', ')}])`,
    }));
}

/**
 * The zod expression for one property of the entity schema.
 *
 * Covers the datatypes the CRUD entities actually declare — IRIs, IRI arrays,
 * xsd:dateTime and plain strings. A property outside that set throws rather
 * than falling back to `z.string()`, because a silent fallback is how a
 * boolean or an integer would end up validated as a string and nobody would
 * notice; declare a `fieldOverride`, or extend this, when one appears.
 *
 * Non-emptiness is *read* from the property's `minLength`, not decided here.
 * Deciding it here is what made the leaf stricter than the JSON Schema emitted
 * from the same property (Phase C3, issue #65): the generator now states the
 * constraint once, on the property, and both emissions project it.
 */
export function deriveFieldZod(entityName: string, key: string, prop: any): string {
  if (key === 'id') {
    return 'iriString';
  }

  // A property with a declared vocabulary gets the named enum emitted for it by
  // `enumReusableTypes`. Read from the property rather than declared per entity:
  // the enum the leaf carries and the `enum` the JSON Schema carries are then
  // the same `@values` map, which is what stopped them from being able to drift.
  if (Array.isArray(prop.enum)) {
    const name = enumTypeName(key);
    return prop.nullable ? `${name}.optional().nullable()` : name;
  }

  if (prop.type === 'array') {
    if (prop.items?.format !== 'iri') {
      throw new Error(
        `${entityName}.${key}: arrays of ${prop.items?.type ?? 'unknown'} have no derivation`
      );
    }
    return prop.nullable ? 'optionalIriArray' : 'iriArray';
  }

  // Neither appears on a CRUD entity, so the projection had no case for them
  // until the version leaves — which hand-write `version`, `position`,
  // `value`, `defaultValue` and `immutable` — needed one.
  if (prop.type === 'integer') {
    return prop.nullable ? 'nullableInteger' : 'z.number().int()';
  }

  if (prop.type === 'number') {
    return prop.nullable ? 'nullableNumber' : 'z.number()';
  }

  if (prop.type === 'boolean') {
    return prop.nullable ? 'nullableBoolean' : 'z.boolean()';
  }

  // An `rdf:JSON` property, whose document shape the JSON Schema fragment names
  // in its `title`. Looked up rather than derived from the fragment: the zod
  // and the JSON Schema are two emissions of one declaration in `jsonShapes.ts`,
  // and translating one into the other here would be a third.
  if (prop.type === 'object') {
    if (typeof prop.title !== 'string') {
      throw new Error(
        `${entityName}.${key}: object property has no "title" naming its JSON shape`,
      );
    }
    const zod = jsonShape(prop.title).zod;
    return prop.nullable ? `${zod}\n  .optional()\n  .nullable()` : zod;
  }

  if (prop.type !== 'string') {
    throw new Error(`${entityName}.${key}: no derivation for type ${prop.type}`);
  }

  if (prop.format === 'date-time') {
    return 'isoDateTime';
  }

  if (prop.format === 'iri') {
    return prop.nullable ? 'optionalIriString' : 'iriString';
  }

  // A declared `@pattern` reaches the JSON Schema as `pattern` and the leaf as
  // `.regex(…)` — one declaration, both emissions, rather than the two
  // hand-written copies `authEnvKey` used to carry.
  if (prop.pattern) {
    const regex = `z.string().regex(/${prop.pattern}/, 'Must match ${prop.pattern.replace(/^\^|\$$/g, '')}')`;
    return prop.nullable ? `${regex}.optional().nullable()` : regex;
  }

  if (prop.nullable) {
    return 'nullableString';
  }

  return prop.minLength
    ? `z.string().min(${prop.minLength}, '${capitalize(key)} is required')`
    : 'z.string()';
}

/**
 * Project a full ContractDefinition from an entity's OpenAPI schema plus its
 * declared deviations.
 */
export function buildEntityContractDefinition(
  model: EntityContractModel,
  openApiSchema: any,
  entitySchema: Schema
): ContractDefinition {
  const { entityName, varName } = model;
  const properties = openApiSchema.properties as Record<string, any>;
  const overrides = model.fieldOverrides ?? {};
  const libraryMembership = hasLibraryMembership(entitySchema);

  // --- the entity shape -----------------------------------------------------
  const shapeEntries: Array<[string, string]> = [];
  for (const [key, prop] of Object.entries(properties)) {
    shapeEntries.push([
      key,
      key === 'isPartOf' && libraryMembership
        ? LIBRARY_MEMBERSHIP_FIELD
        : overrides[key] ?? deriveFieldZod(entityName, key, prop),
    ]);
    for (const extra of model.extraFields ?? []) {
      if (extra.after === key) {
        shapeEntries.push([extra.name, CONTRACT_FIELD_TYPES[extra.type].zod]);
      }
    }
  }

  const shapeName = `${varName}Shape`;
  const shapeBody = shapeEntries
    // `{ authEnvKey }` rather than `{ authEnvKey: authEnvKey }`
    .map(([key, zod]) => (key === zod ? `  ${key},` : `  ${key}: ${zod},`))
    .join('\n');

  // Array helpers are only defined when something refers to them, matching how
  // the hand-written builders declared their reusable types.
  const shapeText = shapeEntries.map(([, zod]) => zod).join('\n');
  const reusableTypes: ZodReusableType[] = [
    ...BASE_TYPES,
    ...ON_DEMAND_TYPES.filter(type => new RegExp(`\\b${type.name}\\b`).test(shapeText)),
    ...enumReusableTypes(properties),
    ...(model.extraTypes ?? []),
    {
      name: shapeName,
      definition: `{\n${shapeBody}\n}`,
      comment: `Reusable field definitions for ${entityName} entity`,
    },
  ];

  // --- the three zod schemas ------------------------------------------------
  const normalizes = libraryMembership ? ', normalizes isPartOf' : '';

  // Read-only properties are dropped, exactly as `deriveCreateBody` drops them
  // from the generated body. Keeping them made `LibraryCreateInput` declare
  // `dateCreated` writable and let web validate — then send — a create body the
  // server answers with 400, which is what handing an entity back as a create
  // body does (Phase C3, issue #65).
  const readOnlyKeys = Object.entries(properties)
    .filter(([, prop]) => prop.readOnly)
    .map(([key]) => key);
  const omitReadOnly = readOnlyKeys.length
    ? `.omit({ ${readOnlyKeys.map(key => `${key}: true`).join(', ')} })`
    : '';

  const defaultCreate: ZodSchemaDefinition = {
    name: `${varName}CreateSchema`,
    fields: [
      {
        name: '',
        zodType: `z.object({
  ...${shapeName},
  id: ${ID_CREATE_FIELD},${libraryMembership ? `\n  isPartOf: ${LIBRARY_MEMBERSHIP_CREATE},` : ''}
})${omitReadOnly}`,
        required: true,
      },
    ],
    strict: true,
    comment:
      `Create schema - id optional, allows backend to mint it or temporary URNs${normalizes}` +
      (omitReadOnly ? ', excludes read-only fields' : ''),
    refinements: model.writeRefinements?.create,
  };

  /*
   * The update body drops `id` and every read-only field, and derives the list
   * rather than restating it. It used to name `dateCreated` and `dateModified`
   * literally, which was indistinguishable from correct while those were the
   * only read-only properties any entity had — the first projected field made
   * it wrong, by leaving a server-derived value writable through PUT.
   */
  const updateOmitKeys = ['id', ...readOnlyKeys];
  const partialUpdate =
    `z.object(${shapeName}).partial().omit({ ${updateOmitKeys.map(key => `${key}: true`).join(', ')} })`;
  const defaultUpdate: ZodSchemaDefinition = {
    name: `${varName}UpdateSchema`,
    fields: [
      {
        name: '',
        zodType: libraryMembership
          ? `z.preprocess(
  ${LIBRARY_MEMBERSHIP_UPDATE_PREPROCESS},
  ${partialUpdate}.strict()
)`
          : partialUpdate,
        required: true,
      },
    ],
    // The preprocess wrapper carries .strict() on the inner object instead.
    strict: !libraryMembership,
    comment: `Update schema - all fields optional except id, excludes read-only fields${normalizes}`,
    refinements: [
      {
        type: 'refine',
        code: `(data) => Object.keys(data).length > 0, {
    message: 'Update must include at least one field',
    path: [],
  }`,
      },
      ...(model.writeRefinements?.update ?? []),
    ],
  };

  const schemas: ZodSchemaDefinition[] = [
    {
      name: `${varName}Schema`,
      fields: [{ name: '', zodType: `z.object(${shapeName})`, required: true }],
      strict: true,
      comment: `Full ${entityName} schema for validation`,
    },
    defaultCreate,
    defaultUpdate,
  ];

  // --- JSON schema exports --------------------------------------------------
  // Only scalar IRIs get a `format`; an overridden field (an enum, say) is
  // spelled by hand and is not an IRI even when the RDF datatype says so.
  return {
    entityName,
    imports: {
      external: [
        { from: 'zod', imports: ['z'] },
        // Relative, and not from the package root: the root barrel is this
        // module's own sibling. `isIri` is what the server registers as ajv's
        // `iri` format, so the leaf and the endpoint agree by construction.
        { from: '../iri.js', imports: ['isIri', 'IRI_ERROR_MESSAGE'] },
      ],
    },
    reusableTypes,
    schemas,
    typeExports: [
      { name: entityName, zodSchemaName: `${varName}Schema`, comment: `${entityName} entity type` },
      {
        name: `${entityName}Create`,
        zodSchemaName: `${varName}CreateSchema`,
        comment: `${entityName} creation type`,
      },
      {
        name: `${entityName}Update`,
        zodSchemaName: `${varName}UpdateSchema`,
        comment: `${entityName} update type`,
      },
    ],
  };
}
