import { detectSparqlOperation as detectForm, type SparqlOperation as SparqlForm } from '@sparql-query-lib/compiler';
import { QueryTypeIri, type QueryTypeValue } from '../constants/queryTypes.js';

export type SparqlOperation = QueryTypeValue;

const FORM_IRIS: Readonly<Record<SparqlForm, QueryTypeValue>> = {
  SELECT: QueryTypeIri.select,
  ASK: QueryTypeIri.ask,
  CONSTRUCT: QueryTypeIri.construct,
  DESCRIBE: QueryTypeIri.describe,
  UPDATE: QueryTypeIri.update,
};

/**
 * Inspect a SPARQL string and identify the top-level operation type, as the
 * stored query-type IRI.
 *
 * The detection is `@sparql-query-lib/compiler`'s; this maps its form name to
 * the IRI the entity model stores. Throws if the text cannot be parsed or the
 * operation is not supported.
 */
export function detectSparqlOperation(queryString: string): SparqlOperation {
  return FORM_IRIS[detectForm(queryString)];
}
