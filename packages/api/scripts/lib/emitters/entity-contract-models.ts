/**
 * What each CRUD entity's contract declares beyond its entity schema.
 *
 * Everything absent from an entry is projected by
 * `buildEntityContractDefinition` from the entity schema itself. An entry here
 * is a statement that the API contract deviates from what the RDF shape says —
 * so the list of deviations is now readable in one place instead of being
 * spread across eight near-identical builders.
 */

import type { EntityContractModel } from './entity-contract-builder.js';

/**
 * `rulesetMembership` — which rule sets a rule or data block belongs to.
 *
 * Absent from `RuleSchema` and `DataBlockSchema`, and it should stay absent.
 * This is not a gap in the entity model, which is what this comment used to
 * claim. Rule-set membership *is* stored: on `RuleSetVersion`, as
 * `sqlib:hasRule` / `sqlib:hasDataBlock`, holding **version** ids rather than
 * parent ids — deliberately, so that updating a rule's `currentVersion` does
 * not silently change what an existing rule set does.
 *
 * So `rulesetMembership` is the inverse of a relation already stored, and
 * `RuleSet.rules` / `.dataBlocks` below are the same relation projected onto
 * stable entities. Giving either its own predicate would denormalise stored
 * data at the wrong granularity and go stale the moment a version is cut.
 * A projection belongs in the contract; that is what these entries are.
 *
 * Declared by *type* rather than by zod expression because both emissions read
 * it: the contract leaf takes the zod, and the route body generator takes the
 * JSON Schema.
 *
 * One loose end, not addressed here: `rulesetMembership` is accepted on create
 * and dropped, and nothing reads it back — not web, not the tests. Since it is
 * the inverse of stored data the coherent options are to compute it on read or
 * to stop accepting it.
 */
const RULESET_MEMBERSHIP = {
  name: 'rulesetMembership',
  type: 'optionalIriArray',
  after: 'isPartOf',
} as const;

export const ENTITY_CONTRACT_MODELS: EntityContractModel[] = [
  {
    entityName: 'Backend',
    varName: 'backend',
    schemaId: 'backend',
    // `backendType` and `queryMethod` are not here: both declare `@values` on
    // BackendSchema, so the builder projects their enums from the entity model
    // like every other field.
    // The one rule Backend's shape cannot carry: an http backend must have an
    // endpoint. It spans two fields, so it is not a property of any property —
    // which is why it lives here and not in the entity model. Everything else
    // about the create and update bodies is projected like every other entity;
    // this used to declare both schemas outright to get at these two
    // refinements, hand-enumerating eight fields the shape already described.
    //
    // (It also carried a `backendTypeWritableEnum` for a narrower writable
    // vocabulary, which was always a second copy of the full set — issue #82 —
    // and is now the one `backendTypeEnum` the model declares.)
    writeRefinements: {
      create: [
        {
          type: 'superRefine',
          code: `(value, ctx) => {
    if (value.backendType === 'http' && (!value.endpoint || value.endpoint.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endpoint'],
        message: 'HTTP backends require an endpoint',
      });
    }
  }`,
        },
      ],
      update: [
        {
          type: 'superRefine',
          code: `(value, ctx) => {
    if (value.backendType === 'http' && value.endpoint === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endpoint'],
        message: 'HTTP backends require an endpoint',
      });
    }
  }`,
        },
      ],
    },
  },
  {
    entityName: 'Library',
    varName: 'library',
    schemaId: 'library',
  },
  {
    entityName: 'Query',
    varName: 'query',
    schemaId: 'query',
  },
  {
    entityName: 'QueryGroup',
    varName: 'queryGroup',
    schemaId: 'querygroup',
    // Unlike the other library-scoped entities, a query group belongs to
    // exactly one library, so isPartOf is a scalar IRI and needs no widening —
    // which the builder now reads off `QueryGroupSchema.isPartOf` rather than
    // being told here.
  },
  {
    entityName: 'Rule',
    varName: 'rule',
    schemaId: 'rule',
    extraFields: [RULESET_MEMBERSHIP],
  },
  {
    entityName: 'RuleSet',
    varName: 'ruleSet',
    schemaId: 'ruleset',
    extraFields: [
      { name: 'rules', type: 'optionalIriArray', after: 'isPartOf' },
      { name: 'dataBlocks', type: 'optionalIriArray', after: 'isPartOf' },
    ],
  },
  {
    entityName: 'DataBlock',
    varName: 'dataBlock',
    schemaId: 'datablock',
    extraFields: [RULESET_MEMBERSHIP],
  },
  {
    entityName: 'DataGraph',
    varName: 'dataGraph',
    schemaId: 'datagraph',
    // Nothing deviates: name, description and a one-library `isPartOf` are all
    // the stable entity carries, and the content lives on the version.
  },
  {
    entityName: 'Test',
    varName: 'test',
    schemaId: 'test',
    // `subject` and `subjectKind` are entity-schema properties, so they project
    // like everything else. What the model cannot say is that the two have to
    // agree — a `subjectKind` of `ruleSet` with a query subject is a coherent
    // pair of values and an incoherent test — and that is checked at write in
    // `tests.ts`, where the referenced entity can actually be looked up.
  },
  {
    entityName: 'TupleSet',
    varName: 'tupleSet',
    schemaId: 'tupleset',
    // Nothing deviates, for the same reason DataGraph does not: name,
    // description and a one-library `isPartOf` are all the stable entity
    // carries, and content lives on the version.
    //
    // The *version* is the one that deviates, and it is not projected here at
    // all. Its create body takes `contentString` plus a `sourceFormat` naming
    // which of four input dialects the bytes are in, and what gets stored is
    // the normalised SRJ rather than what was sent — a body that is not a
    // projection of any entity shape. `routes/tuple-sets.ts` registers it
    // directly, which is why `ROUTE_CONFIGS.TupleSet` declares no operations.
  },
  {
    entityName: 'Tag',
    varName: 'tag',
    schemaId: 'tag',
    // Nothing deviates. The one rule a tag carries that its shape cannot — that
    // it may only be applied inside its own library — is a rule about the
    // *entity being tagged*, not about the tag, so it is enforced where those
    // writes happen (`lib/tagMembership.ts`).
  },
];
