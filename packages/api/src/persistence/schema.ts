/**
 * The entity schema format.
 *
 * Local replacement for LDKit's `Schema` type (plan §3 Phase 5). The schema
 * *objects* in `schemas/` are unchanged — this only takes ownership of the type
 * they are checked against, so `scripts/generate-schemas.ts` and contract
 * generation are unaffected.
 *
 * `schemaIntrospection.ts` is what reads these at runtime; it stays the single
 * place that interprets the format.
 */

import type { EntityTypeName } from './entityTypeNames.js';
import type { JsonShapeName } from './jsonShapes.js';
import type { ldkit, rdf, xsd } from './namespaces.js';

/**
 * The datatypes a property may declare.
 *
 * LDKit accepted every xsd term it knew about, most of which the mapper has no
 * decoding for and would reject at runtime. This is narrowed to the set
 * `schemaIntrospection.resolveKind` actually supports, so an unsupported
 * datatype is a type error at the schema rather than a throw at boot. Adding one
 * means adding it in both places.
 */
export type EntityDatatype =
  | typeof ldkit.IRI
  | typeof rdf.JSON
  | typeof xsd.string
  | typeof xsd.boolean
  | typeof xsd.dateTime
  | typeof xsd.integer
  | typeof xsd.int
  | typeof xsd.long
  | typeof xsd.decimal
  | typeof xsd.double
  | typeof xsd.float
  | typeof xsd.anyURI
  | typeof xsd.duration;

/** One RDF predicate on an entity, and how its value is stored. */
export type Property = {
  '@id': string;
  '@type'?: EntityDatatype;
  '@optional'?: true;
  '@array'?: true;
  /**
   * The permitted values, as `API token -> stored RDF value`.
   *
   * `@type` says a value is an IRI; it cannot say *which* IRIs, and the API
   * does not put the IRI on the wire anyway — `backendType` is stored as
   * `sqlib:backendType/http` and sent as `"http"`. Until this existed the
   * vocabulary lived nowhere the generator could read: the JSON Schema it
   * emitted for such a property said `format: iri`, which rejects every value
   * the endpoint actually accepts, and the enum the zod leaf carries had to be
   * hand-declared beside the model (issue #82).
   *
   * Declaring it here makes the model the source of both: the emitted JSON
   * Schema gets `enum` over the keys, and the token/IRI translation the routes
   * perform is the map itself.
   */
  '@values'?: Readonly<Record<string, string>>;
  /**
   * A regular expression every value must match, as a JSON Schema `pattern`.
   *
   * Declared here because it was stated twice otherwise: `authEnvKey`'s
   * `^[A-Z0-9_]+$` lived as a hand-patched `pattern` in `generate-schemas.ts`
   * for the JSON Schema *and* as a `.regex(…)` in `ENTITY_CONTRACT_MODELS` for
   * the zod leaf, with nothing keeping the two equal (issue #65).
   *
   * The string is the pattern, not a `RegExp`: it goes into a JSON Schema
   * verbatim, and a literal keeps the schema objects plain data.
   */
  '@pattern'?: string;
  /**
   * The shape of an `rdf:JSON` property's document, by name.
   *
   * `@type: rdf.JSON` says the object is a JSON document, not which one, so
   * without this a structured property reaches the published contract as an
   * untyped blob — which is how `backendConfig` came to be typed `string` on
   * the wire while every reader treated it as an object (issue #294). The
   * shapes themselves live in `jsonShapes.ts`, where each is emitted as both a
   * JSON Schema fragment and a zod leaf.
   *
   * Only meaningful on an `rdf:JSON` property; checked when the schema is read.
   */
  '@jsonShape'?: JsonShapeName;
  /**
   * What the IRI is allowed to point at.
   *
   * `'@type': ldkit.IRI` says a value is an IRI, not what it must resolve to,
   * and that gap is why the reference rules were written out by hand in
   * `lib/groupVersionReferences.ts` and, eight more times, inline in the route
   * handlers ("this `isPartOf` entry must be a `Library`"). Neither form can be
   * checked against the model, so a rule that is wrong is wrong silently.
   *
   * `types` are the `EntityTypeName`s a value may resolve to; `exactlyOne`
   * applies to an `@array` property and names the type that must appear exactly
   * once among its values — library membership, where a `Query` may sit in any
   * number of groups but in precisely one library.
   *
   * This is not a JSON Schema constraint and cannot become one: "resolves to a
   * `Library`" needs the store. It is a declaration the *handlers* and the
   * write-staging resolver read, so the rule is stated once.
   */
  '@references'?: {
    types: readonly EntityTypeName[];
    exactlyOne?: EntityTypeName;
  };
  /**
   * A value to surface on read by following this IRI.
   *
   * `currentVersion` points at a version, and the version carries its own
   * number as `schema:version`. Callers want that number — a list of queries
   * showing "v3" — and the only ways to give it to them without this were all
   * worse. Storing the number on the entity too duplicates a fact the graph
   * already holds, and because contracts are generated from these schemas it
   * would arrive as a writable property that a client must never set.
   * Resolving it in each list route states the rule where the model cannot
   * check it, which is what `@values` and `@pattern` were added to stop.
   *
   * Like `@references`, this is not a JSON Schema constraint and cannot become
   * one — following an IRI needs the store. It is a declaration the read path
   * acts on and the contract generator emits a read-only field for, so the
   * rule is stated once.
   *
   * `as` is the field name on the reading entity; `property` is the property
   * read from the referenced one. The projected field's datatype comes from
   * that property, so it is never restated here.
   *
   * Requires `@references` naming exactly one type — the target's schema is
   * what says whether `property` exists — and is only meaningful on an IRI
   * property. Both are checked when the schema is read.
   */
  '@projects'?: {
    as: string;
    property: string;
  };
};

/** An entity: its `rdf:type` class IRI plus one entry per property. */
export type Schema = {
  '@type'?: string | readonly string[];
} & {
  [key: string]: Property | string | readonly string[];
};
