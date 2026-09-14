/**
 * Reading tabular input into the one stored form: SPARQL Results JSON.
 *
 * Four source formats carrying three different amounts of information, and the
 * rule is stated once here rather than at each call site: **interpretation
 * happens at import, never at read.** Whatever a version stores is read back
 * exactly as written, so a version's meaning cannot drift when this file
 * changes. That is what buys reproducibility for a pinned version id, and it is
 * why the content is normalised rather than kept verbatim — see
 * `docs/concepts.md`.
 *
 * | Source | Types carried |
 * | --- | --- |
 * | `csv`, `tsv` | none — every cell a plain string literal |
 * | `sparql-results-tsv` | full — Turtle term syntax per cell |
 * | `sparql-results-json`, `query-results`, `etl-results` | full — validated, kept as-is |
 */

import type { TupleSourceFormat } from '../persistence/schemas/TupleSetVersionSchema.js';

export class TupleContentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TupleContentError';
  }
}

export interface TupleTerm {
  type: 'uri' | 'literal';
  value: string;
  datatype?: string;
  'xml:lang'?: string;
}

/** A row omits a variable entirely to mean UNDEF; see `normaliseRow`. */
export type TupleRow = Record<string, TupleTerm>;

export interface TupleDocument {
  head: { vars: string[] };
  results: { bindings: TupleRow[] };
}

export interface ParsedTupleContent {
  document: TupleDocument;
  columns: string[];
  rowCount: number;
  byteSize: number;
  /** The canonical serialisation to persist. */
  contentString: string;
}

/** A column-level type an untyped column can be promoted to at import. */
export const SUGGESTED_COLUMN_TYPES = ['xsd:integer', 'xsd:date', 'uri'] as const;
export type SuggestedColumnType = (typeof SUGGESTED_COLUMN_TYPES)[number];

export interface ColumnTypeSuggestion {
  column: string;
  suggested: SuggestedColumnType;
}

const XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string';
const XSD_INTEGER = 'http://www.w3.org/2001/XMLSchema#integer';
const XSD_DATE = 'http://www.w3.org/2001/XMLSchema#date';

const INTEGER_PATTERN = /^[+-]?\d+$/;
// xsd:date lexical space, with the optional timezone the spec allows.
const DATE_PATTERN = /^-?\d{4,}-\d{2}-\d{2}(Z|[+-]\d{2}:\d{2})?$/;
// An absolute URI: a scheme, "://", and no whitespace — deliberately stricter
// than "contains a colon" so an ordinary string with a colon in it (a time, a
// ratio) is never mistaken for one.
const URI_PATTERN = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\/\S+$/;

const SUGGESTION_DATATYPES: Record<'xsd:integer' | 'xsd:date', string> = {
  'xsd:integer': XSD_INTEGER,
  'xsd:date': XSD_DATE,
};

/**
 * UNDEF is an absent key, never an empty-string literal.
 *
 * `""` binds the empty literal, which matches nothing and reads as a bug in the
 * data — the same reason the arguments panel's `pruneUndef` drops blanks on the
 * way out rather than sending them.
 */
function normaliseRow(row: TupleRow): TupleRow {
  const out: TupleRow = {};
  for (const [key, term] of Object.entries(row)) {
    if (term === undefined || term === null) continue;
    out[key] = term;
  }
  return out;
}

function plainLiteral(value: string): TupleTerm {
  return { type: 'literal', value };
}

/**
 * Split a delimited line, honouring RFC 4180 quoting.
 *
 * Hand-rolled rather than pulled in: the whole grammar is quotes, doubled
 * quotes and the delimiter, and a dependency for that would be larger than the
 * function.
 *
 * **Not for SPARQL Results TSV** — see `splitResultsTsv`. There a `"` opens a
 * Turtle literal and belongs to the value, so RFC 4180 handling would eat the
 * quotes the term parser needs to see.
 */
function splitDelimited(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"' && cell.length === 0) {
      quoted = true;
      continue;
    }
    if (char === delimiter) {
      cells.push(cell);
      cell = '';
      continue;
    }
    cell += char;
  }
  cells.push(cell);
  return cells;
}

/**
 * Split a SPARQL Results TSV line.
 *
 * A plain tab split, deliberately: SPARQL 1.1 §Results TSV makes tab the field
 * separator and requires a tab *inside* a literal to be written `\t`, so no
 * quoting layer sits between the line and its terms. Quotes here are Turtle's
 * and stay in the cell for `parseResultsTsvCell` to read.
 */
function splitResultsTsv(line: string): string[] {
  return line.split('\t');
}

/**
 * Physical lines, with a trailing newline and CRLF tolerated.
 *
 * Only *trailing* blank lines are dropped. An earlier version filtered every
 * whitespace-only line anywhere in the file, which quietly ate two things: a
 * SPARQL-Results-TSV row whose cells are all UNDEF is a line of nothing but
 * tabs, and it is a legitimate row; and removing an interior line shifted every
 * subsequent line number, so a parse error pointed at the wrong place. A blank
 * line elsewhere now reaches the cell-count check and is reported rather than
 * silently discarded.
 */
function contentLines(text: string): string[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  // Strictly empty, not merely whitespace: a results-TSV row of all-UNDEF cells
  // is a line of nothing but tabs, and trimming would discard it as blank.
  while (lines.length > 0 && lines[lines.length - 1].length === 0) {
    lines.pop();
  }
  return lines;
}

function stripLeadingQuestionMark(name: string): string {
  return name.startsWith('?') ? name.slice(1) : name;
}

function assertColumns(columns: string[]): void {
  if (columns.length === 0) {
    throw new TupleContentError('Tuple content has no columns');
  }
  const seen = new Set<string>();
  for (const column of columns) {
    if (!column) {
      throw new TupleContentError('Tuple content has an unnamed column');
    }
    if (seen.has(column)) {
      throw new TupleContentError(`Tuple content repeats the column "${column}"`);
    }
    seen.add(column);
  }
}

/**
 * One cell of SPARQL Results TSV: a Turtle term.
 *
 * A cell that does not parse is an error rather than a string fallback. The
 * whole reason to choose this format over plain TSV is that it declares types;
 * silently degrading `"7"^^xsd:integer` to the string `"7"^^xsd:integer` would
 * turn a typo into data that looks fine and joins with nothing.
 */
function parseResultsTsvCell(cell: string, column: string, line: number): TupleTerm | undefined {
  const text = cell.trim();
  if (text.length === 0) return undefined; // UNDEF

  if (text.startsWith('<') && text.endsWith('>')) {
    return { type: 'uri', value: text.slice(1, -1) };
  }

  if (text.startsWith('_:')) {
    throw new TupleContentError(
      `Blank node in column "${column}" on line ${line}. A blank node label is scoped to its own ` +
        'document, so it cannot join with anything in a target store.'
    );
  }

  if (text.startsWith('"')) {
    // Closing quote is the last unescaped one; everything after it is the
    // datatype or language tag.
    let end = -1;
    for (let i = 1; i < text.length; i += 1) {
      if (text[i] === '\\') {
        i += 1;
        continue;
      }
      if (text[i] === '"') end = i;
    }
    if (end <= 0) {
      throw new TupleContentError(`Unterminated literal in column "${column}" on line ${line}`);
    }
    const lexical = unescapeTurtleString(text.slice(1, end));
    const suffix = text.slice(end + 1);
    if (suffix.length === 0) return { type: 'literal', value: lexical };
    if (suffix.startsWith('@')) {
      return { type: 'literal', value: lexical, 'xml:lang': suffix.slice(1) };
    }
    if (suffix.startsWith('^^<') && suffix.endsWith('>')) {
      const datatype = suffix.slice(3, -1);
      // `xsd:string` is the implicit datatype of a plain literal in RDF 1.1;
      // keeping it would make two equal terms compare unequal as JSON.
      return datatype === XSD_STRING
        ? { type: 'literal', value: lexical }
        : { type: 'literal', value: lexical, datatype };
    }
    throw new TupleContentError(
      `Unrecognised literal suffix "${suffix}" in column "${column}" on line ${line}. ` +
        'Expected a language tag (@en) or a datatype IRI (^^<…>).'
    );
  }

  // Numeric and boolean shorthands are the only bare forms Turtle allows.
  if (/^[+-]?\d+$/.test(text)) {
    return { type: 'literal', value: text, datatype: 'http://www.w3.org/2001/XMLSchema#integer' };
  }
  if (/^[+-]?(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?$/.test(text)) {
    const datatype = /[eE]/.test(text)
      ? 'http://www.w3.org/2001/XMLSchema#double'
      : 'http://www.w3.org/2001/XMLSchema#decimal';
    return { type: 'literal', value: text, datatype };
  }
  if (text === 'true' || text === 'false') {
    return { type: 'literal', value: text, datatype: 'http://www.w3.org/2001/XMLSchema#boolean' };
  }

  throw new TupleContentError(
    `Cannot read "${cell}" in column "${column}" on line ${line} as an RDF term. ` +
      'SPARQL Results TSV expects <iri>, "literal", "literal"@lang, "literal"^^<datatype>, ' +
      'or a numeric/boolean shorthand. Import as plain TSV to take cells as strings.'
  );
}

function unescapeTurtleString(value: string): string {
  return value.replace(/\\(.)/g, (_match, char: string) => {
    switch (char) {
      case 'n': return '\n';
      case 't': return '\t';
      case 'r': return '\r';
      case 'b': return '\b';
      case 'f': return '\f';
      case '"': return '"';
      case "'": return "'";
      case '\\': return '\\';
      default: return char;
    }
  });
}

function parseDelimited(
  text: string,
  delimiter: string,
  typed: boolean,
): TupleDocument {
  const lines = contentLines(text);
  if (lines.length === 0) {
    throw new TupleContentError('Tuple content is empty');
  }

  const split = (line: string) => (typed ? splitResultsTsv(line) : splitDelimited(line, delimiter));

  const columns = split(lines[0]).map(cell => stripLeadingQuestionMark(cell.trim()));
  assertColumns(columns);

  const bindings: TupleRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = split(lines[i]);
    if (cells.length !== columns.length) {
      throw new TupleContentError(
        `Line ${i + 1} has ${cells.length} cells, expected ${columns.length}`
      );
    }
    const row: TupleRow = {};
    for (let c = 0; c < columns.length; c += 1) {
      const term = typed
        ? parseResultsTsvCell(cells[c], columns[c], i + 1)
        : cells[c].length > 0
          ? plainLiteral(cells[c])
          : undefined;
      if (term) row[columns[c]] = term;
    }
    bindings.push(row);
  }

  return { head: { vars: columns }, results: { bindings } };
}

/**
 * Validate a SPARQL Results JSON document and take only what a tuple set holds.
 *
 * An SRJ document may carry members a tuple set has no use for — `boolean` from
 * an ASK, `links` — so they are dropped rather than stored.
 */
function parseResultsJson(text: string): TupleDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new TupleContentError(
      `Tuple content is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const document = parsed as Partial<TupleDocument>;
  const vars = document?.head?.vars;
  if (!Array.isArray(vars)) {
    throw new TupleContentError('SPARQL Results JSON must carry head.vars');
  }
  const columns = vars.map(v => stripLeadingQuestionMark(String(v)));
  assertColumns(columns);

  const rawBindings = document?.results?.bindings;
  if (!Array.isArray(rawBindings)) {
    throw new TupleContentError('SPARQL Results JSON must carry results.bindings');
  }

  const known = new Set(columns);
  const bindings: TupleRow[] = rawBindings.map((row, index) => {
    if (!row || typeof row !== 'object') {
      throw new TupleContentError(`Binding ${index + 1} is not an object`);
    }
    const out: TupleRow = {};
    for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
      if (value === undefined || value === null) continue; // UNDEF
      if (!known.has(key)) {
        throw new TupleContentError(
          `Binding ${index + 1} sets "${key}", which is not in head.vars`
        );
      }
      out[key] = readTerm(value, key, index + 1);
    }
    return out;
  });

  return { head: { vars: columns }, results: { bindings } };
}

function readTerm(value: unknown, column: string, row: number): TupleTerm {
  // Typed loosely on purpose: this is untrusted JSON, so `type` may hold
  // anything the format allows — `bnode` in particular, which is rejected below
  // rather than narrowed away.
  const term = value as {
    type?: string;
    value?: unknown;
    datatype?: string;
    'xml:lang'?: string;
  };
  if (term?.type === 'bnode') {
    throw new TupleContentError(
      `Blank node in column "${column}" of binding ${row}. A blank node label is scoped to its own ` +
        'document, so it cannot join with anything in a target store.'
    );
  }
  if (term?.type !== 'uri' && term?.type !== 'literal') {
    throw new TupleContentError(
      `Column "${column}" of binding ${row} has type "${String(term?.type)}"; expected uri or literal`
    );
  }
  if (typeof term.value !== 'string') {
    throw new TupleContentError(`Column "${column}" of binding ${row} has no string value`);
  }

  const out: TupleTerm = { type: term.type, value: term.value };
  if (term['xml:lang']) out['xml:lang'] = term['xml:lang'];
  else if (term.datatype && term.datatype !== XSD_STRING) out.datatype = term.datatype;
  return out;
}

/**
 * Read source content into the canonical stored form.
 *
 * The returned `contentString` is what gets persisted; `columns` and `rowCount`
 * are lifted onto the version so listings and compatibility verdicts never have
 * to parse it again.
 */
export function parseTupleContent(
  text: string,
  sourceFormat: TupleSourceFormat,
): ParsedTupleContent {
  let document: TupleDocument;

  switch (sourceFormat) {
    case 'csv':
      document = parseDelimited(text, ',', false);
      break;
    case 'tsv':
      document = parseDelimited(text, '\t', false);
      break;
    case 'sparql-results-tsv':
      document = parseDelimited(text, '\t', true);
      break;
    case 'sparql-results-json':
    case 'query-results':
    case 'etl-results':
      document = parseResultsJson(text);
      break;
  }

  document = {
    head: document.head,
    results: { bindings: document.results.bindings.map(normaliseRow) },
  };

  const contentString = JSON.stringify(document);
  return {
    document,
    columns: document.head.vars,
    rowCount: document.results.bindings.length,
    byteSize: Buffer.byteLength(contentString, 'utf8'),
    contentString,
  };
}

/**
 * Propose a type for each column that is currently plain strings.
 *
 * A column is a candidate only if every value present in it (UNDEF cells carry
 * no opinion) is an untyped literal — one with no datatype and no language tag
 * — since a column that already carries type or language information was
 * typed on purpose by an earlier import step, not left plain for want of one.
 * A candidate column is suggested a type only when *every* value in it agrees;
 * one value that does not fit is reason enough to leave the column as strings
 * rather than guess.
 *
 * Purely advisory — nothing here writes anything. See `applyColumnTypes` for
 * turning an accepted suggestion into the persisted outcome.
 */
export function suggestColumnTypes(document: TupleDocument): ColumnTypeSuggestion[] {
  const suggestions: ColumnTypeSuggestion[] = [];

  for (const column of document.head.vars) {
    const values: string[] = [];
    let eligible = true;

    for (const row of document.results.bindings) {
      const term = row[column];
      if (term === undefined) continue; // UNDEF: no opinion
      if (term.type !== 'literal' || term.datatype || term['xml:lang']) {
        eligible = false;
        break;
      }
      values.push(term.value);
    }

    if (!eligible || values.length === 0) continue;

    if (values.every(value => INTEGER_PATTERN.test(value))) {
      suggestions.push({ column, suggested: 'xsd:integer' });
    } else if (values.every(value => DATE_PATTERN.test(value))) {
      suggestions.push({ column, suggested: 'xsd:date' });
    } else if (values.every(value => URI_PATTERN.test(value))) {
      suggestions.push({ column, suggested: 'uri' });
    }
  }

  return suggestions;
}

function convertSuggestedTerm(
  term: TupleTerm,
  type: SuggestedColumnType,
  column: string,
  row: number,
): TupleTerm {
  if (term.type !== 'literal' || term.datatype || term['xml:lang']) {
    throw new TupleContentError(
      `Column "${column}" in row ${row} already carries a type; a suggested type applies only to a ` +
        'plain string cell'
    );
  }

  if (type === 'uri') {
    if (!URI_PATTERN.test(term.value)) {
      throw new TupleContentError(
        `"${term.value}" in column "${column}", row ${row} does not look like a URI`
      );
    }
    return { type: 'uri', value: term.value };
  }

  const pattern = type === 'xsd:integer' ? INTEGER_PATTERN : DATE_PATTERN;
  if (!pattern.test(term.value)) {
    throw new TupleContentError(
      `"${term.value}" in column "${column}", row ${row} does not look like ${type}`
    );
  }
  return { type: 'literal', value: term.value, datatype: SUGGESTION_DATATYPES[type] };
}

/**
 * Turn accepted column-type suggestions into the persisted outcome.
 *
 * This is the one place a column's plain-string cells become typed terms, and
 * it runs at import — never at read — for the same reason the rest of this
 * file normalises on the way in: what a version stores is what it means,
 * forever, regardless of what this file learns to suggest later. The caller
 * passes only the columns the author accepted; anything else is left exactly
 * as parsed.
 *
 * Re-validates every cell against the chosen type rather than trusting the
 * suggestion that produced it, since the accepted map travels from client
 * back to server as plain data and the content it describes could in
 * principle have changed in between.
 */
export function applyColumnTypes(
  parsed: ParsedTupleContent,
  columnTypes: Record<string, SuggestedColumnType>,
): ParsedTupleContent {
  const entries = Object.entries(columnTypes);
  if (entries.length === 0) return parsed;

  const known = new Set(parsed.columns);
  for (const [column] of entries) {
    if (!known.has(column)) {
      throw new TupleContentError(`Cannot type column "${column}": it is not one of this content's columns`);
    }
  }

  const bindings = parsed.document.results.bindings.map((row, index) => {
    const out: TupleRow = { ...row };
    for (const [column, type] of entries) {
      const term = row[column];
      if (term === undefined) continue; // UNDEF stays UNDEF
      out[column] = convertSuggestedTerm(term, type, column, index + 1);
    }
    return out;
  });

  const document: TupleDocument = { head: parsed.document.head, results: { bindings } };
  const contentString = JSON.stringify(document);

  return {
    document,
    columns: parsed.columns,
    rowCount: parsed.rowCount,
    byteSize: Buffer.byteLength(contentString, 'utf8'),
    contentString,
  };
}

/**
 * Read stored content back.
 *
 * Deliberately the JSON path only, whatever the version's `sourceFormat` says —
 * that field is provenance, not an instruction. Content is always SRJ.
 */
export function readStoredTupleContent(contentString: string): TupleDocument {
  return parseResultsJson(contentString);
}

/**
 * Does a header line look like SPARQL Results TSV?
 *
 * Only ever used to pre-select a default in the import UI. The format is an
 * explicit choice because the two share an extension and misreading one as the
 * other would type — or un-type — a whole dataset invisibly.
 */
export function looksLikeResultsTsv(text: string): boolean {
  const [header] = contentLines(text);
  if (!header) return false;
  const cells = splitResultsTsv(header);
  return cells.length > 0 && cells.every(cell => cell.trim().startsWith('?'));
}
