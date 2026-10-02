/**
 * Reading argument documents off the wire.
 *
 * Every argument a caller supplies for a table parameter is a **SPARQL Query
 * Results JSON** document, `{ head: { vars }, results: { bindings } }`, the same
 * shape a SELECT returns and a stored argument set or tuple set holds. That is
 * the whole point of the format: a query's output, a saved table, or another
 * endpoint's response can be handed over as an argument without being edited.
 *
 * This module is the one gate between that document and the runtime shape
 * {@link TemplateArgumentSet}. It accepts slightly more than strict Results JSON
 * and refuses one thing Results JSON allows:
 *
 * - **Nulls.** A row is a partial binding: an absent key is UNDEF. Clients that
 *   build rows from a grid send `null` for blank cells and a whole `null` row
 *   for a blank row, so both are normalised to absence.
 * - **`typed-literal`.** The 2008 draft spelling some endpoints still emit is
 *   folded into `literal` with its `datatype`, so their output pastes in as is.
 * - **Blank nodes are refused.** A blank node label is scoped to the document
 *   it appears in, so as a VALUES term it could join with nothing in the target
 *   store. Tuple set import refuses them for the same reason.
 * - **A literal with both a datatype and a language tag is refused**, unless
 *   the datatype is `rdf:langString` (or `rdf:dirLangString`), which is what a
 *   language tag implies anyway and some RDF 1.1 stores spell out.
 *
 * Extracted so an exported bundle and `POST /execute` accept exactly the same
 * payload, refused with exactly the same messages.
 */

import type { TemplateArgumentSet } from './query-template.js';
import type { TermValue } from './sparql-terms.js';

/** One argument as it arrives on the wire: a SPARQL Results JSON document. */
export interface WireArgumentSet {
  head: { vars: string[] };
  results: { bindings: unknown[] };
}

/** Raised when an argument document is not a usable SPARQL Results JSON document. */
export class InvalidArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidArgumentError';
  }
}

const XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string';

/** The datatypes a language-tagged literal has by definition. */
const LANG_DATATYPES = new Set([
  'http://www.w3.org/1999/02/22-rdf-syntax-ns#langString',
  'http://www.w3.org/1999/02/22-rdf-syntax-ns#dirLangString',
]);

/**
 * Bring one wire term to the runtime shape: `uri`, or `literal` with at most
 * one of a datatype and a language tag. `null`/`undefined` is an unbound cell.
 *
 * Also what a group runs an upstream row's cells through before splicing them
 * downstream, so a Virtuoso-shaped answer chains exactly as it pastes.
 */
export function normalizeWireTerm(term: unknown, where: string): TermValue | undefined {
  if (term === null || term === undefined) return undefined;
  if (typeof term !== 'object') {
    throw new InvalidArgumentError(`${where} is not an RDF term object.`);
  }
  const { type, value, datatype } = term as Record<string, unknown>;
  const lang = (term as Record<string, unknown>)['xml:lang'];
  if (typeof value !== 'string') {
    throw new InvalidArgumentError(`${where} has no string value.`);
  }
  if (type === 'bnode') {
    throw new InvalidArgumentError(
      `${where} is a blank node. A blank node label only means something inside the document it came from, so it cannot be passed as an argument; use an IRI.`,
    );
  }
  if (type === 'uri') return { type: 'uri', value };
  if (type === 'literal' || type === 'typed-literal') {
    const out: TermValue = { type: 'literal', value };
    if (typeof lang === 'string' && typeof datatype === 'string' && !LANG_DATATYPES.has(datatype)) {
      throw new InvalidArgumentError(
        `${where} is a literal with both a datatype and a language tag; RDF allows one or the other.`,
      );
    }
    if (typeof lang === 'string') out['xml:lang'] = lang;
    else if (typeof datatype === 'string') out.datatype = datatype;
    else if (type === 'typed-literal') out.datatype = XSD_STRING;
    return out;
  }
  throw new InvalidArgumentError(
    `${where} has type ${JSON.stringify(type)}; an argument term is a "uri" or a "literal".`,
  );
}

/**
 * Validate argument documents and bring them to the runtime shape.
 *
 * Throws {@link InvalidArgumentError} naming the offending argument, row and
 * variable. The result carries only `head` and `results`: anything else on the
 * wire is dropped here rather than trusted downstream.
 */
export function normalizeArguments(
  argumentSets: readonly WireArgumentSet[] | undefined,
): TemplateArgumentSet[] | undefined {
  if (argumentSets === undefined) return undefined;
  if (!Array.isArray(argumentSets)) {
    throw new InvalidArgumentError('arguments must be an array of SPARQL Results JSON documents.');
  }
  return argumentSets.map((argumentSet, index) => {
    const at = `Argument ${index}`;
    const record = (argumentSet ?? {}) as unknown as Record<string, unknown>;
    const head = record.head as { vars?: unknown } | undefined;
    const results = record.results as { bindings?: unknown } | undefined;
    if (!head || !Array.isArray(head.vars) || !head.vars.every((v) => typeof v === 'string')) {
      throw new InvalidArgumentError(`${at} has no head.vars naming the variables it binds.`);
    }
    if (!results || !Array.isArray(results.bindings)) {
      throw new InvalidArgumentError(
        'arguments' in record
          ? `${at} puts its rows under "arguments"; an argument is a SPARQL Results JSON document, so they go under "results".`
          : `${at} has no results.bindings array.`,
      );
    }
    const vars = head.vars as string[];
    const bindings = results.bindings.map((row: unknown, rowIndex) => {
      if (row === null || row === undefined) return {};
      if (typeof row !== 'object' || Array.isArray(row)) {
        throw new InvalidArgumentError(`${at}, row ${rowIndex} is not an object.`);
      }
      const out: Record<string, TermValue> = {};
      for (const [name, term] of Object.entries(row as Record<string, unknown>)) {
        const normalized = normalizeWireTerm(term, `${at}, row ${rowIndex}, ?${name}`);
        if (normalized) out[name] = normalized;
      }
      return out;
    });
    return { head: { vars: [...vars] }, results: { bindings } };
  });
}
