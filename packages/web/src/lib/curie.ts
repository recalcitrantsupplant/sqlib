/**
 * CURIE <-> IRI, against the grammar rather than against a guess at it.
 *
 * Plain functions over an explicit prefix list: no Vue, no settings, no
 * storage. `usePrefixManager` supplies the mappings and owns the memo; this
 * owns what a CURIE is. Keeping them apart is what makes the rules testable
 * against a parser instead of against a rendered table.
 *
 * The bar is not "looks like a CURIE", and deliberately not the CURIE spec
 * either. W3C CURIE Syntax 1.0 defines `reference` as an RFC 3987
 * irelative-ref, which is far wider than what a query accepts: `foaf:a/b` is a
 * well-formed CURIE and is NOT a well-formed SPARQL prefixed name. Validating
 * against CURIE would put us back to emitting text that does not parse.
 *
 * So the grammar here is PNAME_LN / PN_LOCAL from SPARQL 1.1, which Turtle
 * shares. The productions below are transcribed from it. The parsers in the
 * specs beside this file are a differential check on that transcription, not
 * the authority — hand-writing a Unicode character class from a grammar is
 * exactly where a silent mistake lives, and two independent readings
 * disagreeing is the cheapest way to find one. Where a parser and the grammar
 * disagree the grammar wins: traqula accepts a bare `\`, PN_LOCAL_ESC does
 * not, and `shrink` declines it.
 *
 * (What the UI calls prefixed names is therefore exactly that, not CURIEs —
 * the two are close enough to be confused, but the rules are not CURIE's.)
 */

export interface PrefixPair {
  prefix: string;
  namespace: string;
}

/*
 * PN_LOCAL, from the SPARQL 1.1/1.2 grammar. Turtle's production is the same.
 *
 * Written out as the productions because every approximation of this has been
 * wrong in both directions: the version this replaced emitted `foaf:a.`, which
 * does not parse, while refusing `foaf:123abc`, `foaf:a:b`, `foaf:has%20escape`
 * and every non-ASCII local name, all of which do.
 */
const PN_CHARS_BASE =
  'A-Za-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF' +
  '\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF' +
  '\\uFDF0-\\uFFFD\\u{10000}-\\u{EFFFF}';
const PN_CHARS_U = `${PN_CHARS_BASE}_`;
const PN_CHARS = `${PN_CHARS_U}\\-0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040`;
/** The characters a backslash may escape, per PN_LOCAL_ESC. */
const ESCAPABLE = "_~.\\-!$&'()*+,;=/?#@%";
/** PERCENT | PN_LOCAL_ESC */
const PLX = `(?:%[0-9A-Fa-f]{2}|\\\\[${ESCAPABLE}])`;

const PN_LOCAL = new RegExp(
  `^(?:[${PN_CHARS_U}:0-9]|${PLX})(?:(?:[${PN_CHARS}.:]|${PLX})*(?:[${PN_CHARS}:]|${PLX}))?$`,
  'u',
);

/*
 * The shape almost every local name in almost every vocabulary actually has.
 *
 * Sound by construction rather than by approximation: the first character is
 * PN_CHARS_U, the rest are PN_CHARS, and the last can be neither '.' nor ':',
 * so anything matching this is PN_LOCAL. It only ever returns early on a match
 * — a miss falls through to the full production — which keeps the Unicode
 * alternation off the common path.
 */
const PN_LOCAL_ASCII = /^[A-Za-z_][A-Za-z0-9_-]*$/;

const ESCAPE_SEQUENCE = new RegExp(`\\\\([${ESCAPABLE}])`, 'g');

/** Whether `local` may follow a prefix and still parse. Empty is legal: `skos:`. */
export function isValidLocalName(local: string): boolean {
  if (local.length === 0) return true;
  if (PN_LOCAL_ASCII.test(local)) return true;
  return PN_LOCAL.test(local);
}

export interface ShrinkResult {
  prefix: string;
  namespace: string;
  localName: string;
  curie: string;
}

/**
 * The longest matching prefix, or null when none applies.
 *
 * `sorted` must be ordered by descending namespace length: two registered
 * namespaces can share a start, and the longer one is the more specific
 * reading. Sorting is the caller's job because it holds the list across many
 * lookups and re-sorting per call is how a shrink becomes O(n log n).
 *
 * Null covers both "no prefix matches" and "a prefix matches but the remainder
 * would not parse". Both mean the same thing to a caller: show the full IRI.
 */
export function shrink(iri: string, sorted: readonly PrefixPair[]): ShrinkResult | null {
  for (const { namespace, prefix } of sorted) {
    if (!iri.startsWith(namespace)) continue;
    const localName = iri.slice(namespace.length);
    if (!isValidLocalName(localName)) continue;
    return { prefix, namespace, localName, curie: `${prefix}:${localName}` };
  }
  return null;
}

/**
 * A CURIE back to the IRI it denotes, or null when it denotes nothing.
 *
 * Split on the FIRST colon, never `split(':')`: ':' is legal throughout
 * PN_LOCAL, so `foaf:a:b` is one prefix and a local name containing a colon.
 * Splitting on all of them either drops the tail or rejects the whole thing,
 * and both have shipped in real prefix libraries.
 *
 * Percent sequences are part of the IRI and stay as written; backslash escapes
 * are a serialisation device and come out, so `foaf:a\-b` denotes `…/a-b`.
 */
export function expand(
  curie: string,
  namespaceFor: (prefix: string) => string | undefined,
): string | null {
  const separator = curie.indexOf(':');
  if (separator < 0) return null;

  const localName = curie.slice(separator + 1);
  if (!isValidLocalName(localName)) return null;

  const namespace = namespaceFor(curie.slice(0, separator));
  if (namespace === undefined) return null;

  return `${namespace}${localName.replace(ESCAPE_SEQUENCE, '$1')}`;
}
