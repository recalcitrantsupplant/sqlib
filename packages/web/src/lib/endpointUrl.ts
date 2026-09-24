/**
 * What counts as a SPARQL endpoint URL, and what to call one.
 *
 * Shared because two screens ask the same question of the same string: the
 * backend form, where a URL is typed into a labelled field, and the run bar's
 * picker, where one is pasted straight into the dropdown. A second copy of the
 * scheme check is a second answer to "is `localhost:7878/sparql` an endpoint",
 * and they would not stay the same for long.
 */

/** The complaint about this URL, or null when there is none. */
export function validateEndpoint(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'An endpoint URL is required.';
  try {
    const url = new URL(trimmed);
    // `localhost:7878/sparql` parses — as a URL whose scheme is `localhost`.
    // Only http(s) is a SPARQL endpoint, so the check is on the scheme itself
    // rather than on whether anything parsed.
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return 'Include a scheme, e.g. https://query.wikidata.org/sparql';
    }
    return null;
  } catch {
    return 'Include a scheme, e.g. https://query.wikidata.org/sparql';
  }
}

/**
 * What an endpoint is called before anyone names it: the URL, without the
 * scheme.
 *
 * A pasted endpoint has no name and does not need one to run — so rather than
 * inventing something ("Endpoint 3") or asking for one up front, the URL is
 * the name, and naming it is a later, optional edit. `https://` carries no
 * information in a list where every row is an endpoint, so it goes; the rest
 * is left alone, because the part that distinguishes two endpoints on one host
 * is the path.
 */
export function endpointDisplayName(endpoint: string): string {
  return endpoint.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
}
