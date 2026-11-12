/**
 * Whether a saved query can become an ETL template.
 *
 * An ETL template is a CONSTRUCT with one VALUES parameter slot: a VALUES
 * clause whose only row is all UNDEF. The column mapping fills that slot.
 */

const CONSTRUCT_FORM = /\bCONSTRUCT\b/i;
const UNDEF_SLOT = /\bVALUES\s*(?:\?\w+|\(\s*(?:\?\w+\s*)+\))\s*\{\s*(?:UNDEF|\(\s*(?:UNDEF\s*)+\))\s*\}/i;

/** The reason the text cannot be a template, or null when it can. */
export function templateRefusal(text: string, queryType: string | null): string | null {
  const isConstruct = queryType ? queryType.toUpperCase() === 'CONSTRUCT' : CONSTRUCT_FORM.test(text);
  if (!isConstruct) return 'Choose a CONSTRUCT query. An ETL template must be a CONSTRUCT.';
  if (!UNDEF_SLOT.test(text)) {
    return 'Choose a query with a parameter slot, such as VALUES (?a ?b) { (UNDEF UNDEF) }.';
  }
  return null;
}
