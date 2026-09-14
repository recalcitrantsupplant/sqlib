/**
 * Named tuple rows, on the two sides of the seam they now cross.
 *
 * A rule set reads its named tuples as SRL: `TUPLE(:reach, :a, :b)` — positional
 * terms, written with the document's own prefixes. A **tuple set** stores rows
 * as SPARQL Results, because that is the tabular asset every other consumer in
 * the library reads (`docs/concepts.md`). Making named
 * tuples a saveable input means those two have to meet, so the mapping is
 * stated here once rather than guessed at each call site.
 *
 * The mapping, in full:
 *
 * - **Rows are positional.** SRL tuples have no column names, so the columns
 *   are `p1 … pn`. A tuple's name is simply its first position, exactly as the
 *   SRL text writes it — nothing is lifted out into a header.
 * - **IRIs are expanded on the way out.** SPARQL Results TSV requires full
 *   IRIs, and the document's prologue is the only thing that can resolve a
 *   prefixed name. A row that uses a prefix the document does not declare is a
 *   refusal, not a guess.
 * - **Literals pass through** as written, which is Turtle syntax on both sides.
 * - **Blank nodes are refused.** A blank node has no identity outside the
 *   document that minted it, so a saved row containing one would mean
 *   something different every time it was read back.
 */

/** A prefix table read from a document's prologue. */
export type PrefixMap = Record<string, string>;

export function readProloguePrefixes(document: string): PrefixMap {
  const prefixes: PrefixMap = {};
  for (const line of document.split('\n')) {
    const match = /^\s*PREFIX\s+([A-Za-z][\w.-]*)?:\s*<([^>]*)>/i.exec(line);
    if (match) prefixes[match[1] ?? ''] = match[2];
  }
  return prefixes;
}

/**
 * Split `TUPLE( a, b, c )` rows into their terms.
 *
 * Commas inside a quoted literal do not separate positions, which is the only
 * thing here that a naive `split(',')` gets wrong — and it gets it wrong on
 * exactly the rows (string data) someone is most likely to paste in.
 */
export function parseTupleRows(text: string): string[][] {
  const rows: string[][] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^TUPLE\s*\((.*)\)\s*\.?$/is.exec(line);
    if (!match) continue;
    rows.push(splitTerms(match[1]));
  }
  return rows;
}

function splitTerms(body: string): string[] {
  const terms: string[] = [];
  let current = '';
  let inQuote = false;
  let escaped = false;
  for (const character of body) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === '\\') {
      current += character;
      escaped = true;
      continue;
    }
    if (character === '"') {
      inQuote = !inQuote;
      current += character;
      continue;
    }
    if (character === ',' && !inQuote) {
      terms.push(current.trim());
      current = '';
      continue;
    }
    current += character;
  }
  if (current.trim()) terms.push(current.trim());
  return terms;
}

export class TupleRowError extends Error {}

/** One SRL term, written the way SPARQL Results TSV wants it. */
export function expandTerm(term: string, prefixes: PrefixMap): string {
  if (term.startsWith('_:')) {
    throw new TupleRowError(
      `A tuple row cannot be saved with the blank node ${term}: a blank node has no identity outside `
      + 'the document that minted it, so the saved row would mean something different every time it '
      + 'was read back.',
    );
  }
  if (term.startsWith('<') || term.startsWith('"') || term.startsWith("'")) return term;
  // Plain literals SRL writes bare: numbers, and true/false.
  if (/^[+-]?\d/.test(term) || term === 'true' || term === 'false') return term;

  const colon = term.indexOf(':');
  if (colon < 0) {
    throw new TupleRowError(`“${term}” is not a term a tuple row can hold.`);
  }
  const prefix = term.slice(0, colon);
  const local = term.slice(colon + 1);
  const base = prefixes[prefix];
  if (base === undefined) {
    throw new TupleRowError(
      `The prefix “${prefix}:” is not declared in this document, so ${term} cannot be `
      + 'written as a full IRI. Declare it with PREFIX and try again.',
    );
  }
  return `<${base}${local}>`;
}

export interface TupleTable {
  columns: string[];
  /** A SPARQL Results TSV document — header row, then one row per tuple. */
  tsv: string;
}

/** Inline SRL tuple rows, as a tuple set version's content. */
export function tupleRowsToTable(text: string, prefixes: PrefixMap): TupleTable {
  const rows = parseTupleRows(text);
  if (!rows.length) throw new TupleRowError('There are no TUPLE( … ) rows to save.');

  const width = Math.max(...rows.map((row) => row.length));
  const columns = Array.from({ length: width }, (_, index) => `p${index + 1}`);
  const header = columns.map((name) => `?${name}`).join('\t');
  const body = rows.map((row) => {
    const cells = columns.map((_, index) => {
      const term = row[index];
      // A short row leaves the trailing positions unbound rather than padded
      // with an empty literal — "absent" and "the empty string" are different
      // facts, and only one of them is true.
      return term === undefined ? '' : expandTerm(term, prefixes);
    });
    return cells.join('\t');
  });
  return { columns, tsv: [header, ...body].join('\n') };
}

/** One SPARQL Results value, as SRL would write it. */
function termToSrl(value: { type?: string; value?: string; datatype?: string; 'xml:lang'?: string } | undefined): string {
  if (!value || value.value === undefined) return '""';
  if (value.type === 'uri') return `<${value.value}>`;
  if (value.type === 'bnode') return `_:${value.value}`;
  const literal = `"${value.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  if (value['xml:lang']) return `${literal}@${value['xml:lang']}`;
  if (value.datatype) return `${literal}^^<${value.datatype}>`;
  return literal;
}

/**
 * A saved tuple set's rows, as the SRL seed document a run is given.
 *
 * Positional again, and in the version's own column order: `tupleColumns` is
 * `head.vars` lifted onto the version precisely so the order survives storage.
 */
export function bindingsToTupleRows(
  columns: string[],
  bindings: Array<Record<string, { type?: string; value?: string; datatype?: string; 'xml:lang'?: string }>>,
): string {
  return bindings
    .map((binding) => {
      const terms = columns
        .map((column) => (binding[column] === undefined ? null : termToSrl(binding[column])))
        .filter((term): term is string => term !== null);
      return `TUPLE(${terms.join(', ')})`;
    })
    .join('\n');
}
