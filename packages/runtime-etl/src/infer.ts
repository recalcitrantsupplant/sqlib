/**
 * Term-type detection for a new column mapping.
 *
 * The preview proposes a mapping from a sample of rows. A text column whose
 * sample values are all IRIs maps to an IRI. Every other column maps to a
 * literal. The person can change either choice before a run.
 */

/**
 * The IRI schemes that detection accepts. The list is fixed, because a
 * generic scheme pattern also matches text such as `Note: x`.
 */
export const DETECTED_IRI_SCHEMES = ['http', 'https', 'urn', 'ftp', 'file', 'mailto', 'tag', 'did'] as const;

const IRI_VALUE = new RegExp(`^(?:${DETECTED_IRI_SCHEMES.join('|')}):\\S+$`, 'i');

/**
 * True when at least one sample value is not null and every value that is not
 * null is a string that starts with a scheme in `DETECTED_IRI_SCHEMES` and has
 * no whitespace.
 */
export function valuesLookLikeIris(values: readonly unknown[]): boolean {
  let seen = 0;
  for (const value of values) {
    if (value === null || value === undefined) continue;
    if (typeof value !== 'string' || !IRI_VALUE.test(value)) return false;
    seen += 1;
  }
  return seen > 0;
}
