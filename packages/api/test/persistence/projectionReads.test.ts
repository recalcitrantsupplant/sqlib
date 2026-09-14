/**
 * Projections, end to end through the read path.
 *
 * `@projects` says a value should be surfaced by following an IRI; these check
 * the two halves that make it happen — the read query asking the store for it,
 * and the assembler landing it on the entity.
 *
 * Resolution lives here rather than after the read on purpose. The first
 * arrangement walked the entity cache once the rows were assembled, which works
 * only while both the entity and its target happen to be cached and yields
 * nothing when they are not — `CacheCoordinator.get` is cache-only and says so.
 * A join has no such condition, so what these really pin is that the store is
 * being asked.
 */
import { describe, expect, it } from 'vitest';
import { generateFindAllQuery, generateFindByIriQuery } from '../../src/persistence/readQueryGenerator.js';
import { assembleEntities } from '../../src/persistence/EntityAssembler.js';
import { projectionPredicate } from '../../src/persistence/schemaIntrospection.js';
import { QuerySchema } from '../../src/persistence/schemas/QuerySchema.js';
import { BackendSchema } from '../../src/persistence/schemas/BackendSchema.js';

const QUERY_CLASS = 'https://sparql-query-lib/Query';
const CURRENT_VERSION = 'https://sparql-query-lib/currentVersion';
const SCHEMA_VERSION = 'https://schema.org/version';
const NUMBER_PREDICATE = projectionPredicate(QUERY_CLASS, 'currentVersionNumber');

const schema = QuerySchema as unknown as Record<string, unknown>;

function row(id: string, predicate: string, object: string, type = 'literal') {
  return {
    id: { type: 'uri', value: id },
    p: { type: 'uri', value: predicate },
    o: { type, value: object },
  };
}

describe('projections in the read query', () => {
  it('asks the store to follow the reference and read the far side', () => {
    const query = generateFindAllQuery(schema);

    // The one hop: through currentVersion, onto the version's own number.
    expect(query).toContain(`<${CURRENT_VERSION}> ?projected .`);
    expect(query).toContain(`?projected <${SCHEMA_VERSION}> ?o .`);
    expect(query).toContain(`BIND(<${NUMBER_PREDICATE}> AS ?p)`);
  });

  it('does the same for a single-entity read', () => {
    const query = generateFindByIriQuery(schema, 'urn:sqlib:query:one');
    expect(query).toContain(`?projected <${SCHEMA_VERSION}> ?o .`);
  });

  it('adds nothing for a type that declares no projection', () => {
    const query = generateFindAllQuery(BackendSchema as unknown as Record<string, unknown>);
    expect(query).not.toContain('?projected');
  });

  /*
   * The synthetic predicate must not be mistakable for a stored one — it names
   * a projection, and nothing in the graph carries it.
   */
  it('tags the projected value with a predicate no schema declares', () => {
    expect(NUMBER_PREDICATE.startsWith('urn:sqlib:projection:')).toBe(true);
    expect(generateFindAllQuery(schema)).not.toContain(`?id <${NUMBER_PREDICATE}>`);
  });
});

describe('projections in the assembler', () => {
  const ID = 'urn:sqlib:query:one';
  const base = [
    row(ID, 'https://schema.org/name', 'Countries'),
    row(ID, 'https://schema.org/isPartOf', 'urn:sqlib:library:one', 'uri'),
  ];

  it('lands the projected value on its field', () => {
    const [entity] = assembleEntities(schema, [
      ...base,
      row(ID, CURRENT_VERSION, 'urn:sqlib:query-version:abc', 'uri'),
      row(ID, NUMBER_PREDICATE, '3'),
    ]);

    expect(entity).toMatchObject({ currentVersionNumber: 3 });
  });

  it('decodes it with the target property’s datatype, not as a string', () => {
    const [entity] = assembleEntities(schema, [...base, row(ID, NUMBER_PREDICATE, '7')]);
    expect(entity!.currentVersionNumber).toBe(7);
  });

  it('reads as null when the reference is absent', () => {
    // No projection row at all — which is what a missing or dangling reference
    // produces, since the block simply matches nothing.
    const [entity] = assembleEntities(schema, base);
    expect(entity).toMatchObject({ currentVersionNumber: null });
  });

  it('leaves the reference itself alone', () => {
    const [entity] = assembleEntities(schema, [
      ...base,
      row(ID, CURRENT_VERSION, 'urn:sqlib:query-version:abc', 'uri'),
      row(ID, NUMBER_PREDICATE, '3'),
    ]);

    expect(entity).toMatchObject({ currentVersion: 'urn:sqlib:query-version:abc' });
  });

  it('keeps entities apart when several are assembled together', () => {
    const OTHER = 'urn:sqlib:query:two';
    const entities = assembleEntities(schema, [
      ...base,
      row(ID, NUMBER_PREDICATE, '3'),
      row(OTHER, 'https://schema.org/name', 'Labels'),
      row(OTHER, 'https://schema.org/isPartOf', 'urn:sqlib:library:one', 'uri'),
      row(OTHER, NUMBER_PREDICATE, '9'),
    ]);

    const byId = new Map(entities.map((entity) => [entity.$id, entity]));
    expect(byId.get(ID)).toMatchObject({ currentVersionNumber: 3 });
    expect(byId.get(OTHER)).toMatchObject({ currentVersionNumber: 9 });
  });
});
