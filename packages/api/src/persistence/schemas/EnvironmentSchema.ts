/**
 * Entity schema for Environment Entity
 *
 * An environment is a named pointer set inside one library: "dev", "test",
 * "prod", or whatever the library's people call them. For each promotable
 * entity — a query, a query group, a rule set — it names at most one version,
 * and a caller that asks for an entity "in prod" runs that version. See
 * `docs/explanation/environments.md`.
 *
 * Why the pointers live here and not on the query. An environment that holds
 * its versions is one entity to export, to delete and to scan for pins, and a
 * promotable kind added later needs no schema change of its own. The version
 * already says which entity it belongs to (`isPartOf`), so the list of version
 * IRIs is enough to answer "what does prod point to for this query".
 *
 * `latest` is not stored. It is every entity's `currentVersion`, and an
 * environment of that name would be a second place for the same fact.
 */

import type { Schema } from '../schema.js';
import { xsd, sqlib, sdo } from '../namespaces.js';

/** The version kinds an environment may point to. */
export const ENVIRONMENT_VERSION_TYPES = ['QueryVersion', 'QueryGroupVersion', 'RuleSetVersion'] as const;

export const EnvironmentSchema = {
  '@type': sqlib.Environment,
  name: {
    '@id': sdo.name,
  },
  description: {
    '@id': sdo.description,
    '@optional': true,
  },
  /**
   * The environment's place in the library's chain, lowest first ("dev" 0,
   * "test" 1, "prod" 2). Promotion runs along this order.
   */
  position: {
    '@id': sqlib.position,
    '@type': xsd.integer,
    '@optional': true,
  },
  /**
   * The backend a client offers first for this environment. A default only:
   * it grants nothing, and `/execute` still names its backend (see
   * `docs/explanation/security-model.md`).
   */
  defaultBackend: {
    '@id': sqlib.defaultBackend,
    '@type': sqlib.IRI,
    '@optional': true,
    '@references': { types: ['Backend'] },
  },
  /**
   * Scalar: an environment belongs to exactly one library, like a tag.
   */
  isPartOf: {
    '@id': sdo.isPartOf,
    '@type': sqlib.IRI,
    '@references': { types: ['Library'] },
  },
  /**
   * The versions this environment points to, at most one per entity.
   *
   * Read-only on the generic routes: a pointer moves only through
   * `PUT /environments/:id/pointers`, which checks the version belongs to the
   * library, keeps one version per entity, and records who moved it.
   */
  versions: {
    '@id': sqlib.environmentVersion,
    '@array': true,
    '@type': sqlib.IRI,
    '@optional': true,
    '@readOnly': true,
    '@references': { types: ENVIRONMENT_VERSION_TYPES },
  },
  dateCreated: {
    '@id': sdo.dateCreated,
    '@type': xsd.dateTime,
    '@optional': true,
  },
  dateModified: {
    '@id': sdo.dateModified,
    '@type': xsd.dateTime,
    '@optional': true,
  },
} as const satisfies Schema;

export interface PersistedEnvironment {
  $id: string;
  '@type'?: 'Environment';
  name: string;
  description?: string | null;
  position?: number | null;
  defaultBackend?: string | null;
  isPartOf: string; // Reference to Library (required)
  versions?: string[] | null;
  dateCreated?: string | null;
  dateModified?: string | null;
}
