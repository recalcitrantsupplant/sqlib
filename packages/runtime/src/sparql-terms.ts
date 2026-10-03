/**
 * Serialisation of RDF terms into SPARQL surface syntax, with validation.
 *
 * This module is the trust boundary between caller-supplied argument values and
 * the query text we hand to an endpoint. It has no dependencies — not on Traqula,
 * not on Node — so it can be shared by the server and by a browser runtime.
 *
 * **The security contract is validation, not sanitisation.** Every value is either
 * provably inside its SPARQL terminal production or rejected. We never try to make
 * a dangerous value safe by rewriting it, except for the one production where the
 * grammar defines an escape mechanism (string literals). The point is that a term
 * built here cannot terminate its own production early, so it cannot reach the
 * surrounding query structure.
 *
 * This matters because the AST path does not provide that property on its own:
 * Traqula's generator escapes string literals but emits IRIs and language tags
 * verbatim, so `<` + rawIri + `>` was previously enough to inject extra terms into
 * a VALUES block. See test/sparql-terms.security.test.ts.
 */

/**
 * A single RDF term, in the SPARQL Results JSON shape.
 *
 * `type` spans every spelling an endpoint answers with, because the same shape
 * carries a SELECT's rows and the arguments made from them. Two of those are
 * not argument values: `typed-literal` (the 2008 draft spelling Virtuoso still
 * emits) is read as `literal`, and `bnode` is refused — a blank node label only
 * means something inside the document it came from.
 */
export interface TermValue {
  type: 'uri' | 'literal' | 'typed-literal' | 'bnode';
  value: string;
  datatype?: string;
  'xml:lang'?: string;
}

/** Raised when a value cannot be represented safely; always a 4xx, never a 5xx. */
export class InvalidTermError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTermError';
  }
}

/**
 * Characters SPARQL 1.2 `IRIREF` forbids between the angle brackets:
 * `IRIREF ::= '<' ([^<>"{}|^\`\\] | [#x00-#x20])* '>'`.
 *
 * Every character that could close the IRI or start a new token is in this set,
 * which is what makes `<${iri}>` safe once the check passes.
 */
const FORBIDDEN_IN_IRI = /[<>"{}|^`\\\u0000-\u0020]/;

/**
 * `LANGTAG ::= '@' [a-zA-Z]+ ('-' [a-zA-Z0-9]+)*`.
 *
 * Language tags have no escape mechanism, so anything outside this shape is
 * rejected rather than rewritten.
 */
const LANGTAG = /^[a-zA-Z]+(-[a-zA-Z0-9]+)*$/;

/**
 * Conservative `VARNAME`. The spec admits a wide Unicode range; we accept the
 * ASCII core because variable names reach us from an already-parsed query, so a
 * rejection here means "fall back to the AST path", never "reject the user's query".
 */
const VARNAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Characters `STRING_LITERAL_QUOTE` forbids raw:
 * `'"' ([^#x22#x5C#xA#xD] | ECHAR | UCHAR)* '"'`.
 *
 * Exactly these four need escaping; everything else — including tabs and other
 * control characters — is legal inside a quoted literal and is left alone, which
 * keeps the round trip byte-exact.
 */
const LITERAL_ESCAPES: Record<string, string> = {
  '\\': '\\\\',
  '"': '\\"',
  '\n': '\\n',
  '\r': '\\r',
};
const NEEDS_LITERAL_ESCAPE = /["\\\n\r]/g;

const XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string';

/** True when `name` is a variable name this module will emit. */
export function isSafeVariableName(name: string): boolean {
  return VARNAME.test(name);
}

/**
 * Prefix declarations from the query, as `[prefix, namespace]` pairs sorted by
 * descending namespace length so the longest match wins.
 */
export type PrefixTable = ReadonlyArray<readonly [string, string]>;

/**
 * Conservative `PN_LOCAL` check, matching `SparqlQueryParser.buildIriTerm`.
 * A local name is kept only when it is unambiguous, so the abbreviated form
 * cannot be read as anything but one prefixed name.
 */
const SAFE_PN_LOCAL = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

/** Prefix label, per `PNAME_NS`; validated because it is re-emitted verbatim. */
const SAFE_PREFIX = /^[A-Za-z][A-Za-z0-9_.-]*$/;

/** True when `prefix` is a label {@link serializeIri} will abbreviate with. */
export function isSafePrefixLabel(prefix: string): boolean {
  return SAFE_PREFIX.test(prefix);
}

/** RFC 3987 `scheme ":"` — what makes an IRI absolute rather than relative. */
const IRI_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

/**
 * True when `iri` is absolute and spellable inside `<...>`.
 *
 * Used on a bundle's prefix namespaces, which are trusted data rather than
 * caller input but are still the half of an abbreviation that decides which IRI
 * `prefix:local` means — an edited one silently rewrites every abbreviated term.
 */
export function isAbsoluteIri(iri: string): boolean {
  return typeof iri === 'string' && IRI_SCHEME.test(iri) && !FORBIDDEN_IN_IRI.test(iri);
}

/**
 * Serialise a full IRI, rejecting anything that could escape its production.
 *
 * Validation always runs against the *full* IRI, before any abbreviation, so the
 * check cannot be sidestepped by a value that happens to match a namespace.
 * Abbreviation to `prefix:local` mirrors the AST path, which keeps the two
 * implementations byte-identical on queries that declare prefixes.
 */
export function serializeIri(iri: string, prefixes: PrefixTable = []): string {
  if (typeof iri !== 'string' || iri.length === 0) {
    throw new InvalidTermError('IRI must be a non-empty string.');
  }
  const bad = FORBIDDEN_IN_IRI.exec(iri);
  if (bad) {
    const code = bad[0].codePointAt(0)!.toString(16).padStart(4, '0');
    throw new InvalidTermError(
      `IRI contains a character SPARQL forbids in an IRIREF (U+${code.toUpperCase()}) at index ${bad.index}.`,
    );
  }
  for (const [prefix, namespace] of prefixes) {
    if (!namespace || !iri.startsWith(namespace)) continue;
    if (!SAFE_PREFIX.test(prefix)) continue;
    const local = iri.slice(namespace.length);
    if (local.length > 0 && SAFE_PN_LOCAL.test(local) && !local.endsWith('.')) {
      return `${prefix}:${local}`;
    }
  }
  return `<${iri}>`;
}

/** Escape a lexical form for use inside a `"`-quoted literal. */
export function escapeLiteralLexical(value: string): string {
  return value.replace(NEEDS_LITERAL_ESCAPE, (c) => LITERAL_ESCAPES[c]);
}

/** Serialise a variable as `?name`, rejecting names outside {@link VARNAME}. */
export function serializeVariable(name: string): string {
  if (!isSafeVariableName(name)) {
    throw new InvalidTermError(`Unsupported variable name '${name}'.`);
  }
  return `?${name}`;
}

/**
 * Serialise one argument value as a SPARQL term.
 *
 * `context` reads as a trailing clause — `for variable 'x' in argument set 1` —
 * and the messages match the AST path's wording verbatim, so which path served a
 * request is not observable from its errors.
 */
export function serializeTerm(term: TermValue, context: string, prefixes: PrefixTable = []): string {
  if (term === null || typeof term !== 'object') {
    throw new InvalidTermError(`Invalid argument ${context}: expected a term object.`);
  }
  if (term.type === 'uri') {
    try {
      return serializeIri(term.value, prefixes);
    } catch (error) {
      throw new InvalidTermError(`Invalid IRI ${context}. ${(error as Error).message}`);
    }
  }
  if (term.type === 'bnode') {
    throw new InvalidTermError(
      `Invalid argument ${context}: a blank node cannot be passed as an argument, because its label only means something inside the document it came from. Use an IRI.`,
    );
  }
  // `typed-literal` is the 2008 draft spelling of a literal with a datatype, and
  // still what Virtuoso answers with; it reads as `literal`, defaulting to the
  // datatype every plain literal has.
  if (term.type === 'literal' || term.type === 'typed-literal') {
    if (typeof term.value !== 'string') {
      throw new InvalidTermError(`Invalid literal ${context}: value must be a string.`);
    }
    const lexical = `"${escapeLiteralLexical(term.value)}"`;
    const lang = term['xml:lang'];
    // RDF 1.1: a literal has a datatype or a language tag, never both. Picking
    // one would guess at what the caller meant, so a term carrying both is refused.
    if (term.datatype !== undefined && lang !== undefined) {
      throw new InvalidTermError(
        `Invalid literal ${context}: it carries both a datatype and a language tag, which RDF does not allow.`,
      );
    }
    const datatype = term.datatype ?? (term.type === 'typed-literal' ? XSD_STRING : undefined);
    if (datatype !== undefined) {
      try {
        return `${lexical}^^${serializeIri(datatype)}`;
      } catch (error) {
        throw new InvalidTermError(`Invalid datatype IRI ${context}. ${(error as Error).message}`);
      }
    }
    if (lang !== undefined) {
      if (typeof lang !== 'string' || !LANGTAG.test(lang)) {
        throw new InvalidTermError(`Invalid language tag '${lang}' ${context}.`);
      }
      return `${lexical}@${lang}`;
    }
    return lexical;
  }
  throw new InvalidTermError(
    `Invalid argument type '${String((term as { type?: unknown }).type)}' ${context}. Only 'uri' and 'literal' are supported.`,
  );
}

/**
 * Render a complete inline-data block.
 *
 * SPARQL spells one-variable inline data differently from the general form —
 * `InlineDataOneVar ::= Var '{' DataBlockValue* '}'` has no per-row parentheses —
 * and Traqula's generator emits that short form. Matching it keeps this path's
 * output byte-identical to the AST path's rather than merely equivalent.
 *
 * A zero-row block is the empty multiset: it joins to no solutions, which is the
 * faithful rendering of an input that arrived with no rows.
 */
export function renderValuesBlock(
  vars: string[],
  rows: Array<Record<string, TermValue | null | undefined>>,
  argSetIndex: number,
  prefixes: PrefixTable = [],
): string {
  const cellOf = (row: Record<string, TermValue | null | undefined> | null | undefined, v: string) => {
    const cell = row?.[v];
    return cell == null
      ? 'UNDEF'
      : serializeTerm(cell, `for variable '${v}' in argument set ${argSetIndex + 1}`, prefixes);
  };

  if (vars.length === 1) {
    const only = vars[0];
    const header = serializeVariable(only);
    const body = rows.map((row) => cellOf(row, only)).join(' ');
    return rows.length === 0 ? `VALUES ${header} { }` : `VALUES ${header} { ${body} }`;
  }

  // Traqula spells the general form `VALUES( ?a ?b ){ ( <x> "y" ) }` — spaces
  // inside both bracket pairs. Reproduced exactly so the splice output differs
  // from the AST path's only in line breaks, never in tokens.
  const header = vars.map(serializeVariable).join(' ');
  const body = rows.map((row) => `( ${vars.map((v) => cellOf(row, v)).join(' ')} )`).join(' ');
  return rows.length === 0 ? `VALUES( ${header} ){ }` : `VALUES( ${header} ){ ${body} }`;
}
