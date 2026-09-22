const iriString = { type: 'string', pattern: '^\\w+:.+' } as const;

export const sparqlArgumentValueSchema = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['uri', 'literal'] },
    value: { type: 'string' },
    datatype: { type: 'string', nullable: true },
    'xml:lang': { type: 'string' },
  },
  required: ['type', 'value'],
  additionalProperties: false,
} as const;

export const sparqlBindingSchema = {
  type: 'object',
  additionalProperties: sparqlArgumentValueSchema,
} as const;

export const argumentTupleBindingSchema = {
  type: 'object',
  properties: {
    id: iriString,
    /** Its slot among the set's ordered inputs; unset, the submitted order. */
    position: { type: 'integer', minimum: 0 },
    tupleSignature: { type: 'string' },
    variables: {
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
    },
    tupleSetVersions: {
      type: 'array',
      items: iriString,
    },
    rows: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: iriString,
          position: { type: 'integer', minimum: 0 },
          values: sparqlBindingSchema,
        },
        required: ['values'],
        additionalProperties: false,
      },
      default: [],
    },
  },
  required: ['variables', 'rows'],
  additionalProperties: false,
} as const;

export const argumentScalarBindingSchema = {
  type: 'object',
  properties: {
    id: iriString,
    parameterKind: { type: 'string', enum: ['limit', 'offset'] },
    parameterName: { type: 'string' },
    numericValue: { type: 'integer' },
    parameterIri: iriString,
  },
  required: ['parameterKind', 'parameterName', 'numericValue'],
  additionalProperties: false,
} as const;

/**
 * One graph among a set's ordered inputs.
 *
 * Exactly one of `dataGraphVersionId` or `contentString` — checked by the
 * service rather than here, so the message names which pairing was wrong
 * instead of `anyOf` failing anonymously.
 *
 * The two are not two ways of *storing* a graph, only two ways of supplying
 * one: `contentString` is pasted RDF, and saving it writes a `DataGraph` with
 * one version in the set's library and pins that version. What comes back is
 * therefore always a pin.
 *
 * Which start-node port it fills is the group's, not this payload's, so a
 * binding carries only its slot.
 */
export const argumentGraphBindingSchema = {
  type: 'object',
  properties: {
    id: iriString,
    /** Its slot among the set's ordered inputs; unset, the submitted order. */
    position: { type: 'integer', minimum: 0 },
    dataGraphVersionId: { type: 'string', nullable: true },
    contentString: { type: 'string', nullable: true },
    contentFormat: { type: 'string', nullable: true },
    /** The name to give the graph pasted content is saved as; derived if absent. */
    name: { type: 'string', nullable: true },
  },
  required: [],
  additionalProperties: false,
} as const;

export const argumentSetBodySchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    description: { type: 'string' },
    /* Optional: a set may fill only numbers, or only graph ports (plan D4). */
    tupleBindings: {
      type: 'array',
      items: argumentTupleBindingSchema,
    },
    scalarBindings: {
      type: 'array',
      items: argumentScalarBindingSchema,
    },
    graphBindings: {
      type: 'array',
      items: argumentGraphBindingSchema,
    },
  },
  required: ['name'],
  additionalProperties: false,
} as const;

/**
 * Creating a set with no callable to derive a library from — the rail's `+ New`.
 *
 * `libraryId` is required and is what `entityGuard` reads to scope the write
 * (`CONTAINER_BODY_KEYS`). Provenance is optional and checked when given.
 */
export const argumentSetCreateBodySchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    description: { type: 'string' },
    libraryId: iriString,
    scope: { type: 'string', enum: ['query', 'queryGroup'] },
    targetId: iriString,
    tupleBindings: {
      type: 'array',
      items: argumentTupleBindingSchema,
    },
    scalarBindings: {
      type: 'array',
      items: argumentScalarBindingSchema,
    },
    graphBindings: {
      type: 'array',
      items: argumentGraphBindingSchema,
    },
  },
  required: ['name', 'libraryId'],
  additionalProperties: false,
} as const;

/**
 * Renaming or rewording a set — the stable entity, not a version.
 *
 * Bindings are deliberately absent: they are content, they live on a version,
 * and a route that accepted them here would be an edit to a frozen snapshot
 * wearing an entity's clothes. `minProperties` keeps an empty body from
 * counting as a successful update.
 */
export const argumentSetUpdateBodySchema = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1 },
    description: { type: 'string', nullable: true },
    tags: { type: 'array', items: iriString, nullable: true },
  },
  additionalProperties: false,
  minProperties: 1,
} as const;

export const argumentSetVersionResponseSchema = {
  type: 'object',
  properties: {
    id: iriString,
    isPartOf: iriString,
    version: { type: 'integer' },
    tupleBindings: {
      type: 'array',
      items: argumentTupleBindingSchema,
    },
    scalarBindings: {
      type: 'array',
      items: argumentScalarBindingSchema,
    },
    graphBindings: {
      type: 'array',
      items: argumentGraphBindingSchema,
    },
    dateCreated: { type: 'string' },
    dateModified: { type: 'string' },
  },
  required: ['id', 'isPartOf', 'version', 'tupleBindings', 'scalarBindings'],
  additionalProperties: false,
} as const;

export const argumentSetResponseSchema = {
  type: 'object',
  properties: {
    id: iriString,
    name: { type: 'string' },
    description: { type: 'string', nullable: true },
    /* Null on a set composed from the rail: provenance, not a fence. */
    scope: { type: 'string', enum: ['query', 'queryGroup'], nullable: true },
    targetId: { type: 'string', nullable: true },
    libraryId: iriString,
    tags: { type: 'array', items: iriString },
    currentVersionId: iriString,
    currentVersion: argumentSetVersionResponseSchema,
    tupleBindings: {
      type: 'array',
      items: argumentTupleBindingSchema,
    },
    scalarBindings: {
      type: 'array',
      items: argumentScalarBindingSchema,
    },
    graphBindings: {
      type: 'array',
      items: argumentGraphBindingSchema,
    },
    dateCreated: { type: 'string' },
    dateModified: { type: 'string' },
  },
  /*
   * `scope` and `targetId` left out: they are nullable now, and a required
   * nullable field only forces every caller to send an explicit null.
   */
  required: ['id', 'name', 'tupleBindings', 'scalarBindings'],
  additionalProperties: false,
} as const;

export const argumentSetListResponseSchema = {
  type: 'array',
  items: argumentSetResponseSchema,
} as const;

export const argumentSetIdParamSchema = {
  type: 'object',
  properties: {
    id: iriString,
  },
  required: ['id'],
  additionalProperties: false,
} as const;

export const argumentSetVersionBodySchema = {
  type: 'object',
  properties: {
    tupleBindings: {
      type: 'array',
      items: argumentTupleBindingSchema,
    },
    scalarBindings: {
      type: 'array',
      items: argumentScalarBindingSchema,
    },
    graphBindings: {
      type: 'array',
      items: argumentGraphBindingSchema,
    },
  },
  required: [],
  additionalProperties: false,
} as const;

export const argumentSetVersionPatchSchema = {
  type: 'object',
  properties: {
    tupleBindings: {
      type: 'array',
      items: argumentTupleBindingSchema,
    },
    scalarBindings: {
      type: 'array',
      items: argumentScalarBindingSchema,
    },
  },
  additionalProperties: false,
} as const;

export const argumentSetVersionListResponseSchema = {
  type: 'array',
  items: argumentSetVersionResponseSchema,
} as const;

export const argumentSetVersionParamSchema = {
  type: 'object',
  properties: {
    id: iriString,
    version: { type: 'integer' },
  },
  required: ['id', 'version'],
  additionalProperties: false,
} as const;

export type ArgumentSetBodySchema = typeof argumentSetBodySchema;
