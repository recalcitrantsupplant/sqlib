/**
 * The SPARQL template of an ETL job version, as text.
 *
 * A job version holds its template in one of two ways:
 *
 * - `sparqlTemplate`: inline text, stored on the version. Jobs saved before
 *   `templateQuery` existed hold their template this way.
 * - `templateQuery`: a saved CONSTRUCT query. A `QueryVersion` IRI pins that
 *   version. A `Query` IRI floats to the query's `currentVersion` at the time
 *   of the run.
 *
 * Every caller that runs, tests, exports or shows a job version reads its
 * template through `resolveEtlTemplate`, so a floating reference resolves the
 * same way everywhere. A run records the `queryVersionId` it got.
 */
import { QueryTypeIri, toQueryTypeIri } from '@sparql-query-lib/types';

type Entity = Record<string, unknown> & { $id: string; '@type'?: string };

/** Reads one stored entity by IRI. The cache coordinator's `get`, or a bundle source. */
export type EntityLookup = (id: string) => Entity | null;

/** A template as text, and the query version it came from. */
export interface ResolvedEtlTemplate {
  text: string;
  /** The `QueryVersion` the text came from. Null for an inline template. */
  queryVersionId: string | null;
  /** The `Query` that version belongs to. Null for an inline template. */
  queryId: string | null;
  /** True when `templateQuery` names a `Query`, so a later run can resolve another version. */
  floating: boolean;
}

/** A template reference that cannot be resolved, or that is not a CONSTRUCT. */
export class EtlTemplateError extends Error {
  readonly statusCode = 400;
}

/** The fields of an ETL job version that decide its template. */
export interface EtlTemplateSource {
  sparqlTemplate?: string | null;
  templateQuery?: string | null;
}

/**
 * The query version a `templateQuery` reference names now.
 *
 * Refuses an IRI that is not a `Query` or `QueryVersion`, a query with no
 * current version, and a version that is not a CONSTRUCT.
 */
export function resolveTemplateQuery(
  reference: string,
  lookup: EntityLookup,
): { version: Entity; queryId: string; floating: boolean } {
  const entity = lookup(reference);
  if (!entity) {
    throw new EtlTemplateError(`The template query ${reference} does not exist.`);
  }

  let version: Entity | null;
  let floating: boolean;
  if (entity['@type'] === 'QueryVersion') {
    version = entity;
    floating = false;
  } else if (entity['@type'] === 'Query') {
    const current = typeof entity.currentVersion === 'string' ? entity.currentVersion : null;
    if (!current) {
      throw new EtlTemplateError(`The template query ${reference} has no saved version.`);
    }
    version = lookup(current);
    if (!version || version['@type'] !== 'QueryVersion') {
      throw new EtlTemplateError(`The current version ${current} of the template query does not exist.`);
    }
    floating = true;
  } else {
    throw new EtlTemplateError(`The template query ${reference} must be a query or a query version.`);
  }

  if (toQueryTypeIri(version.queryType as string | null | undefined) !== QueryTypeIri.construct) {
    throw new EtlTemplateError(
      `The template query version ${version.$id} is not a CONSTRUCT. An ETL template must be a CONSTRUCT.`,
    );
  }

  const queryId = typeof version.isPartOf === 'string' ? version.isPartOf : reference;
  return { version, queryId, floating };
}

/** The template text a job version runs, and where it came from. */
export function resolveEtlTemplate(source: EtlTemplateSource, lookup: EntityLookup): ResolvedEtlTemplate {
  if (source.templateQuery) {
    const { version, queryId, floating } = resolveTemplateQuery(source.templateQuery, lookup);
    return {
      text: typeof version.queryString === 'string' ? version.queryString : '',
      queryVersionId: version.$id,
      queryId,
      floating,
    };
  }
  return { text: source.sparqlTemplate ?? '', queryVersionId: null, queryId: null, floating: false };
}
