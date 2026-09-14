/**
 * The one definition of "is this an IRI".
 *
 * Phase C of the schema consolidation (issue #65) called for "one IRI-validation
 * definition projected into both ajv and any zod leaf, so server and client agree
 * on validity". Until C3 there were two, and they disagreed on cases that occur
 * constantly in RDF:
 *
 * | value | ajv `format: iri` | the leaf's `uri-js` check |
 * |---|---|---|
 * | `https://example.org/ns#Thing` | rejected | accepted |
 * | `https://example.org/a?b=c#d`  | rejected | accepted |
 * | `a:b`                          | rejected | accepted |
 * | `http://`                      | accepted | rejected |
 * | `urn:`                         | accepted | rejected |
 *
 * The first row is the one that mattered: `ajv-formats-draft2019`'s `iri` pattern
 * rejects any IRI carrying a fragment, so every IRI-typed field on every
 * entity — `id`, `isPartOf`, `defaultBackend`, `currentVersion` — refused an
 * ordinary `…/ontology#Class` while the web app happily sent it. The parity
 * harness found it once its corpus included a fragment.
 *
 * This module is the resolution: `packages/api` registers `isIri` as ajv's `iri`
 * format, and every generated contract refines its IRI strings with the same
 * function. It depends on nothing at all — not zod, so the server can use it
 * without taking a zod dependency back, and not `uri-js`, whose scheme-specific
 * parsing is what the old leaf got wrong (see `isIri` below). `uri-js` came off
 * both package manifests in Phase D once nothing imported it.
 */
export const IRI_ERROR_MESSAGE = 'Must be a valid IRI (RFC 3987)';

/** RFC 3986 §3.1: `ALPHA *( ALPHA / DIGIT / "+" / "-" / "." ) ":"`. */
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

/**
 * Characters an IRI may not carry unescaped: controls and space (RFC 3986 §2)
 * and the excluded set, which is also exactly what Turtle and N-Triples forbid
 * between the angle brackets of an IRIREF.
 */
const EXCLUDED = /[\u0000-\u0020<>"{}|\\^`]/;

/**
 * Syntax, not scheme semantics: an absolute IRI is a scheme, a colon, and
 * something after it, with no excluded characters anywhere.
 *
 * Deliberately *not* `uri-js`'s `parse()`, which the leaf used to call. uri-js
 * applies scheme-specific handlers, so `urn:uuid:1234` — a perfectly good
 * identifier for something that is not a UUID — comes back as an error, and
 * every store in this repo mints ids of that shape. A format check has no
 * business knowing what a `urn:uuid:` ought to contain.
 *
 * The `rest !== '//'` clause is the one judgement here: `http://` and `urn:`
 * parse as a scheme identifying nothing, and both validators rejected them
 * before, so they stay rejected.
 */
export function isIri(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0) {
    return false;
  }
  if (EXCLUDED.test(value)) {
    return false;
  }
  const scheme = SCHEME.exec(value);
  if (!scheme) {
    return false;
  }
  const rest = value.slice(scheme[0].length);
  return rest.length > 0 && rest !== '//';
}
