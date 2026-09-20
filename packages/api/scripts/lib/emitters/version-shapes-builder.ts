/**
 * The entity shapes the two version contract modules used to hand-write.
 *
 * `contracts/src/generated/query-version.ts` and `query-group-version.ts` are
 * the flat write/read contracts for the two most complex endpoints. Most of
 * what they contain is genuinely wire-only — draft schemas that accept
 * `urn:ui-temp:` ids, expanded response envelopes, param schemas — and stays
 * hand-written. But between them they also restated **eighteen entity shapes**
 * for entities the model already describes, which is the double declaration
 * this track exists to remove (issue #65).
 *
 * This emits those eighteen, projected from the entity model with the same
 * `deriveFieldZod` every CRUD contract uses. The two modules import them and
 * keep only what the model cannot say.
 *
 * Why a separate module rather than generating those two files whole: the
 * wire-only parts are ~400 lines of schemas with no entity behind them, and
 * moving them into a builder as template strings would relocate the
 * hand-writing rather than remove it. Splitting on "does the model describe
 * this?" puts the boundary where the meaning is.
 */

import { deriveFieldZod } from './entity-contract-builder.js';
import type { ContractDefinition, ZodReusableType, ZodSchemaDefinition } from './contract-types.js';

/** A shape to emit: the exported name, the entity document, and the type name. */
export interface VersionShape {
  /** `limitParameter` -> `limitParameterShape`, `limitParameterSchema`. */
  varName: string;
  /** Key of the entity document in `entities.generated.ts`. */
  entityExport: string;
  /** Exported TypeScript type name. */
  typeName: string;
  /**
   * Fields the wire carries that the entity model does not declare.
   *
   * The same idea as `ENTITY_CONTRACT_MODELS.extraFields`, and for the same
   * reason: the gap stays countable instead of being closed by hand-writing the
   * whole shape.
   *
   * Almost all of them are `dateCreated`/`dateModified` on the child records a
   * version owns. No predicate stores those — but `EntityUtils.create` stamps
   * both on every entity it writes and they reach the client on the create
   * response, where a `.strict()` shape that has not heard of them throws. That
   * is not a guess: dropping them here turned six query-version e2e specs red,
   * because the client's parse of the create response failed and the version
   * selector never updated.
   *
   * Taking them off the wire is the real fix and is a server change, not a
   * schema one. Until then they are declared rather than assumed absent.
   */
  extra?: Record<string, string>;
}

const CHILD_TIMESTAMPS = { dateCreated: 'isoDateTime', dateModified: 'isoDateTime' };

/** Start and end nodes are not discriminated by the model, but the wire sends one. */
const NODE_TYPE = { nodeType: 'nullableString' };

/**
 * `defaultBackend` on a QueryVersion, which is a property of the stable `Query`.
 *
 * No predicate stores it here and the server never populates it — but it has
 * been in the published contract long enough that clients send it back, and the
 * shape is `.strict()`, so removing it rejects their payloads. Our own e2e
 * fixtures put `defaultBackend: null` in the create response for exactly that
 * reason, and dropping it turned six specs red.
 *
 * Kept, therefore, and kept useless: `useQueryGroupExecution` used to read it
 * off the version and got null every time, which is why that read is gone.
 * Removing the field is a contract break and wants its own decision.
 */
const VERSION_DEFAULT_BACKEND = { defaultBackend: 'optionalIriString' };

/**
 * The eighteen, in the order the two modules declared them.
 *
 * Order is preserved so the emitted module reads like what it replaces, and so
 * a reviewer comparing the two is comparing like with like.
 */
export const VERSION_SHAPES: VersionShape[] = [
  { varName: 'limitParameter', entityExport: 'limitparameterSchema', typeName: 'LimitParameter', extra: CHILD_TIMESTAMPS },
  { varName: 'offsetParameter', entityExport: 'offsetparameterSchema', typeName: 'OffsetParameter', extra: CHILD_TIMESTAMPS },
  {
    varName: 'queryInputVariable',
    entityExport: 'queryinputvariableSchema',
    typeName: 'QueryInputVariable', extra: CHILD_TIMESTAMPS,
  },
  {
    varName: 'queryOutputVariable',
    entityExport: 'queryoutputvariableSchema',
    typeName: 'QueryOutputVariable', extra: CHILD_TIMESTAMPS,
  },
  { varName: 'tupleMember', entityExport: 'tuplememberSchema', typeName: 'TupleMember', extra: CHILD_TIMESTAMPS },
  { varName: 'queryInputTuple', entityExport: 'queryinputtupleSchema', typeName: 'QueryInputTuple', extra: CHILD_TIMESTAMPS },
  {
    varName: 'queryOutputTuple',
    entityExport: 'queryoutputtupleSchema',
    typeName: 'QueryOutputTuple', extra: CHILD_TIMESTAMPS,
  },
  { varName: 'queryVersion', entityExport: 'queryversionSchema', typeName: 'QueryVersion', extra: VERSION_DEFAULT_BACKEND },
  { varName: 'startNode', entityExport: 'startnodeSchema', typeName: 'StartNode', extra: NODE_TYPE },
  { varName: 'endNode', entityExport: 'endnodeSchema', typeName: 'EndNode', extra: NODE_TYPE },
  {
    varName: 'dynamicQueryNode',
    entityExport: 'dynamicquerynodeSchema',
    typeName: 'DynamicQueryNode',
  },
  { varName: 'ruleSetNode', entityExport: 'rulesetnodeSchema', typeName: 'RuleSetNode', extra: CHILD_TIMESTAMPS },
  { varName: 'patchNode', entityExport: 'patchnodeSchema', typeName: 'PatchNode', extra: CHILD_TIMESTAMPS },
  { varName: 'queryNode', entityExport: 'querynodeSchema', typeName: 'QueryNode', extra: CHILD_TIMESTAMPS },
  { varName: 'queryEdge', entityExport: 'queryedgeSchema', typeName: 'QueryEdge' },
  { varName: 'triplesQuadsIO', entityExport: 'triplesquadsioSchema', typeName: 'TriplesQuadsIO' },
  { varName: 'booleanIO', entityExport: 'booleanioSchema', typeName: 'BooleanIO' },
  { varName: 'queryIdInput', entityExport: 'queryidinputSchema', typeName: 'QueryIdInput' },
  {
    varName: 'queryGroupVersion',
    entityExport: 'querygroupversionSchema',
    typeName: 'QueryGroupVersion',
  },
  // The rule set version leaves. `ruleset-version.ts` restated these by hand,
  // and had fallen two fields behind the model on the version itself and two
  // more on the rules it expands — both of which threw `unrecognized_keys` on
  // real responses. Projected here for the same reason as the eighteen above.
  { varName: 'ruleVersion', entityExport: 'ruleversionSchema', typeName: 'RuleVersion' },
  { varName: 'dataBlockVersion', entityExport: 'datablockversionSchema', typeName: 'DataBlockVersion' },
  { varName: 'ruleSetVersion', entityExport: 'rulesetversionSchema', typeName: 'RuleSetVersion' },
];

const IRI_STRING: ZodReusableType = {
  name: 'iriString',
  definition: `z
  .string()
  .min(1, 'IRI must be a non-empty string')
  .refine(isIri, IRI_ERROR_MESSAGE)`,
  comment: 'IRI validation — the one definition, shared with the server (contracts/src/iri.ts)',
};

const HELPER_TYPES: ZodReusableType[] = [
  IRI_STRING,
  { name: 'optionalIriString', definition: 'iriString.optional().nullable()' },
  { name: 'isoDateTime', definition: `z.string().datetime({ offset: true }).optional().nullable()` },
  { name: 'nullableString', definition: 'z.string().optional().nullable()' },
  { name: 'nullableInteger', definition: 'z.number().int().optional().nullable()' },
  { name: 'nullableNumber', definition: 'z.number().optional().nullable()' },
  { name: 'nullableBoolean', definition: 'z.boolean().optional().nullable()' },
  { name: 'iriArray', definition: 'z.array(iriString)' },
  { name: 'optionalIriArray', definition: 'z.array(iriString).optional().nullable()' },
];

/**
 * Build the contract definition for the shared version entity shapes.
 *
 * `entitySchemas` is the map this generation run built, not the one on disk —
 * the version route builder learned that lesson the hard way (see the note on
 * Phase C3 in the plan).
 */
export function buildVersionShapesDefinition(
  entitySchemas: Record<string, { properties: Record<string, unknown> }>,
): ContractDefinition {
  const reusableTypes: ZodReusableType[] = [...HELPER_TYPES];
  const schemas: ZodSchemaDefinition[] = [];

  for (const { varName, entityExport, typeName, extra } of VERSION_SHAPES) {
    const entity = entitySchemas[entityExport];
    if (!entity) {
      throw new Error(
        `version shapes: no entity document "${entityExport}" in this run's output. ` +
          `Rename it in VERSION_SHAPES or remove the shape.`,
      );
    }

    const fields = Object.entries(entity.properties).map(
      ([key, prop]) => `  ${key}: ${deriveFieldZod(typeName, key, prop)},`,
    );
    for (const [key, zod] of Object.entries(extra ?? {})) {
      fields.push(`  ${key}: ${zod},`);
    }

    reusableTypes.push({
      name: `${varName}Shape`,
      definition: `{\n${fields.join('\n')}\n}`,
      comment: `${typeName}, projected from the entity model`,
      exported: true,
    });

    schemas.push({
      name: `${varName}Schema`,
      // The single-empty-name field is how `emitContractModule` takes a schema
      // initializer verbatim rather than building one from a field list.
      fields: [{ name: '', zodType: `z.object(${varName}Shape)`, required: true }],
      // `strict()`, and these parse responses — so a property the model stores
      // and this shape omits is a thrown `unrecognized_keys`, not a dropped
      // field. Deriving them is what makes that impossible.
      strict: true,
    });
  }

  return {
    entityName: 'VersionShapes',
    imports: {
      external: [
        { from: 'zod', imports: ['z'] },
        { from: '../iri.js', imports: ['isIri', 'IRI_ERROR_MESSAGE'] },
      ],
    },
    reusableTypes,
    schemas,
    typeExports: VERSION_SHAPES.map(({ varName, typeName }) => ({
      name: typeName,
      zodSchemaName: `${varName}Schema`,
      comment: `${typeName} entity type`,
    })),
  };
}
