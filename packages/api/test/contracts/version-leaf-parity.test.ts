/**
 * The response contract leaves, against the entity model.
 *
 * `query-version.ts` and `query-group-version.ts` used to hand-write eighteen
 * entity shapes for entities the model already describes, behind a banner
 * admitting they were not generated. They are projected from the model now
 * (`version-shapes.ts`, issue #65), so most of what this asserts holds by
 * construction — which is the point. It stays because construction is only an
 * argument until something checks it, and because the wire-only schemas beside
 * those shapes are still hand-written and can still drift.
 *
 * `ruleset-version.ts` was the same shape of problem and was missed by that
 * pass: five more entity shapes, hand-written, two fields behind the model on
 * the version and two on the rules it expands. Both gaps were thrown parses on
 * live responses, and the rule set Details panel reported them as "Nothing
 * saved yet" over a rule set with a saved v1. Those five are projected now, and
 * the coverage check below is what makes a sixth impossible to miss.
 *
 * It compares two things, both of which have to hold before generation is safe:
 *
 * 1. **Field parity.** Every key of a hand-written shape is a property the
 *    entity model declares, and vice versa. A key only in the leaf is a field
 *    no predicate stores; a property only in the model is a field the endpoint
 *    returns and the leaf rejects — and since these shapes parse *responses*
 *    under `.strict()`, the second kind is a crash, not a laxity.
 * 2. **Derivability.** `deriveFieldZod` can project every one of those
 *    properties. Where it throws, generation is blocked on the projection, not
 *    on the leaf.
 *
 * Divergences are listed, with a cause, or the suite fails. An entry here is a
 * decision someone made, not a silence.
 */
import { describe, expect, it } from 'vitest';
import * as contracts from '@sparql-query-lib/contracts';
import * as entitySchemas from '@sparql-query-lib/contracts/schema';
import { deriveFieldZod } from '../../scripts/lib/emitters/entity-contract-builder.js';
import { VERSION_SHAPES } from '../../scripts/lib/emitters/version-shapes-builder.js';
import { ENTITY_CONTRACT_MODELS } from '../../scripts/lib/emitters/entity-contract-models.js';

/**
 * Leaf schema -> the entity document the model emits for it.
 *
 * Derived from the builder rather than listed, so a shape added to
 * `VERSION_SHAPES` is checked without anyone extending a table here. The
 * benchmark leaves are named explicitly because their builder writes shapes as
 * string literals and has no such list to read.
 */
const LEAF_TO_ENTITY: Array<{ leaf: string; entity: string }> = [
  ...VERSION_SHAPES.map(({ varName, entityExport }) => ({
    leaf: `${varName}Schema`,
    entity: entityExport,
  })),
  { leaf: 'benchmarkExperimentSchema', entity: 'benchmarkexperimentSchema' },
  { leaf: 'benchmarkExperimentVersionSchema', entity: 'benchmarkexperimentversionSchema' },
  { leaf: 'benchmarkRunSchema', entity: 'benchmarkrunSchema' },
  { leaf: 'benchmarkObservationSchema', entity: 'benchmarkobservationSchema' },
  { leaf: 'benchmarkNodeObservationSchema', entity: 'benchmarknodeobservationSchema' },
  { leaf: 'benchmarkIterationObservationSchema', entity: 'benchmarkiterationobservationSchema' },
];

/**
 * Fields a leaf declares that the entity model does not.
 *
 * Not a hand-list any more: these are the `extra` declarations in
 * `version-shapes-builder.ts`, so the set is what the builder says it is.
 * Each is a field the *wire* carries and no predicate stores —
 * `dateCreated`/`dateModified` stamped by `EntityUtils.create` on child records
 * that have no timestamp predicates, and a `nodeType` on start and end nodes.
 *
 * They were dropped once, on the reasoning that a field with no predicate is
 * never populated. Six query-version e2e specs disagreed: the client parses the
 * create response with `.strict()`, so a stamped timestamp it has not heard of
 * throws and the save appears to fail. Taking them off the wire is a server
 * change; declaring them is what keeps the gap countable meanwhile.
 */
const LEAF_ONLY: Record<string, string> = Object.fromEntries(
  VERSION_SHAPES.flatMap(({ varName, extra }) =>
    Object.keys(extra ?? {}).map(key => [
      `${varName}Schema.${key}`,
      'carried by the wire, stored by no predicate',
    ]),
  ),
);

const MODEL_ONLY: Record<string, string> = {};

type Shape = Record<string, unknown>;

function leafKeys(name: string): string[] {
  const schema = (contracts as Record<string, unknown>)[name] as { shape?: Shape } | undefined;
  if (!schema?.shape) throw new Error(`${name} is not an exported zod object`);
  return Object.keys(schema.shape).sort();
}

function entityKeys(name: string): string[] {
  const schema = (entitySchemas as Record<string, unknown>)[name] as
    | { properties?: Shape }
    | undefined;
  if (!schema?.properties) throw new Error(`${name} is not an exported entity document`);
  return Object.keys(schema.properties).sort();
}

/** The subset the builders project, and so the subset generation must cover. */
const PROJECTED_PAIRS = VERSION_SHAPES.map(({ varName, entityExport }) => ({
  leaf: `${varName}Schema`,
  entity: entityExport,
}));

describe('the response leaves against the entity model', () => {
  it.each(LEAF_TO_ENTITY)('$leaf declares no field the model lacks', ({ leaf, entity }) => {
    const unexplained = leafKeys(leaf)
      .filter(key => !entityKeys(entity).includes(key))
      .filter(key => !(`${leaf}.${key}` in LEAF_ONLY));

    expect(unexplained, `${leaf} declares fields nothing stores; explain or remove`).toEqual([]);
  });

  it.each(LEAF_TO_ENTITY)('$leaf omits no field the model stores', ({ leaf, entity }) => {
    // The direction that crashes. `.strict()` on a response shape turns a
    // stored-but-undeclared property into a thrown parse, so this list has to
    // stay empty rather than grow explanations.
    const missing = entityKeys(entity)
      .filter(key => !leafKeys(leaf).includes(key))
      .filter(key => !(`${leaf}.${key}` in MODEL_ONLY));

    expect(missing, `${leaf} would throw on a response carrying these`).toEqual([]);
  });

  it('checks every leaf that mirrors an entity, so a new one cannot slip past', () => {
    /*
     * The table above is only as good as its coverage. `ruleSetVersionSchema`
     * was absent from it for as long as it existed, which is why it could fall
     * two fields behind the model and take the rule set Details panel's version
     * list down with it — the parse threw, the catch emptied the list, and the
     * panel read "Nothing saved yet" over a saved rule set.
     *
     * So rather than trust the table, this looks for exported response leaves
     * that mirror an entity document by name and are neither projected by a
     * builder nor listed above. Anything it finds is the next instance of that
     * bug, waiting.
     */
    const projected = new Set([
      ...ENTITY_CONTRACT_MODELS.map(model => `${model.varName}Schema`),
      ...VERSION_SHAPES.map(shape => `${shape.varName}Schema`),
    ]);
    const listed = new Set(LEAF_TO_ENTITY.map(pair => pair.leaf));
    const entityDocuments = new Set(Object.keys(entitySchemas));

    const unchecked = Object.entries(contracts as Record<string, unknown>)
      .filter(([name]) => name.endsWith('Schema'))
      .filter(([name]) => !projected.has(name) && !listed.has(name))
      .filter(([, schema]) => Boolean((schema as { shape?: Shape } | undefined)?.shape))
      .filter(([name]) => entityDocuments.has(`${name.slice(0, -'Schema'.length).toLowerCase()}Schema`))
      .map(([name]) => name);

    expect(unchecked, 'these mirror an entity and nothing checks them; project or list them').toEqual([]);
  });

  it.each(PROJECTED_PAIRS)('$entity is fully derivable, so it could be generated', ({ entity }) => {
    // Generation is blocked on the projection, not the leaf, wherever this
    // throws. `deriveFieldZod` grew integer and boolean cases for exactly these
    // entities — the CRUD entities it served before have neither.
    //
    // Scoped to the projected shapes. The benchmark leaves are checked for
    // field parity above but cannot be projected yet: `benchmarkrun.keywords`
    // is an array of strings and `benchmarkexperimentversion.subjectSpecs` an
    // array of objects, and `deriveFieldZod` has no case for either. Until it
    // does, those six stay string literals in their own builder — which is the
    // condition that let `benchmarkRunSchema` fall three fields behind.
    const schema = (entitySchemas as Record<string, { properties: Record<string, unknown> }>)[
      entity
    ];
    const undrivable: string[] = [];
    for (const [key, prop] of Object.entries(schema.properties)) {
      try {
        deriveFieldZod(entity, key, prop);
      } catch (error) {
        undrivable.push(`${key}: ${(error as Error).message}`);
      }
    }

    expect(undrivable).toEqual([]);
  });
});
