/**
 * Whether a saved query can become an ETL template.
 *
 * An ETL template is a CONSTRUCT with one VALUES parameter slot: a VALUES
 * clause whose only row is all UNDEF. The column mapping fills that slot.
 */

import { QueryTypeIri, toQueryTypeIri } from '@sparql-query-lib/types';

const CONSTRUCT_FORM = /\bCONSTRUCT\b/i;
const UNDEF_SLOT = /\bVALUES\s*(?:\?\w+|\(\s*(?:\?\w+\s*)+\))\s*\{\s*(?:UNDEF|\(\s*(?:UNDEF\s*)+\))\s*\}/i;

/** The reason the text cannot be a template, or null when it can. */
export function templateRefusal(text: string, queryType: string | null): string | null {
  const isConstruct = queryType ? isConstructType(queryType) : CONSTRUCT_FORM.test(text);
  if (!isConstruct) return 'Choose a CONSTRUCT query. An ETL template must be a CONSTRUCT.';
  if (!UNDEF_SLOT.test(text)) {
    return 'Choose a query with a parameter slot, such as VALUES (?a ?b) { (UNDEF UNDEF) }.';
  }
  return null;
}

/**
 * Whether a stored query type names CONSTRUCT. The API stores the type as an
 * IRI; older data holds the bare keyword.
 */
export function isConstructType(queryType: string | null | undefined): boolean {
  return toQueryTypeIri(queryType) === QueryTypeIri.construct;
}
