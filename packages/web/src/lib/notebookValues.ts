/**
 * What a cell produced, named, measured, and shaped for the cell below it.
 *
 * A notebook value is deliberately the same shape the library already stores:
 * rows carry `rowCount` / `columns` / `byteSize` the way a `TupleSetVersion`
 * does, a graph carries `tripleCount` / `byteSize` the way a
 * `DataGraphVersion` does. That is what makes **Save** a promotion rather than
 * a conversion — the session value and the stored entity are the same facts,
 * one of them just has an IRI.
 *
 * Values live for the session only. The notebook document holds the story; the
 * run is not part of it (`lib/notebookFormat.ts`).
 */
import { Parser as N3Parser } from 'n3';

export type NotebookValueType = 'rows' | 'graph' | 'boolean';

/** A SPARQL JSON binding, as the results come back. */
export type SparqlBindingRow = Record<string, unknown>;

interface ValueCommon {
  /** The name, without `@`. */
  name: string;
  /** The cell that bound it. */
  cellId: string;
  producedAt: string;
  /** Wall time of the run that produced it, in ms. */
  durationMs: number;
  byteSize: number;
}

export interface RowsValue extends ValueCommon {
  type: 'rows';
  columns: string[];
  bindings: SparqlBindingRow[];
}

export interface GraphValue extends ValueCommon {
  type: 'graph';
  /** The serialization as it came back, ready to send on as `dataGraphInline`. */
  content: string;
  /** A media type `dataGraphInline` accepts, so a graph can be piped unchanged. */
  format: 'text/turtle' | 'application/n-triples' | 'application/n-quads';
  tripleCount: number;
}

export interface BooleanValue extends ValueCommon {
  type: 'boolean';
  answer: boolean;
}

export type NotebookValue = RowsValue | GraphValue | BooleanValue;

const NUMBER_FORMAT = new Intl.NumberFormat('en-US');

export function formatCount(value: number): string {
  return NUMBER_FORMAT.format(value);
}

/**
 * Bytes, at the precision the stat chip can use.
 *
 * Decimal units rather than binary: the point of the chip is "is this big
 * enough to worry about", and 2.1 MB answers that better than 2.0 MiB while
 * matching what every other size in the app reads as.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1000 * 1000) return `${Math.round(bytes / 1000)} KB`;
  if (bytes < 1000 * 1000 * 1000) return `${(bytes / 1000 / 1000).toFixed(1)} MB`;
  return `${(bytes / 1000 / 1000 / 1000).toFixed(1)} GB`;
}

/** The stat chip's line: what the value is, in the units it is counted in. */
export function describeValue(value: NotebookValue): string {
  switch (value.type) {
    case 'rows': {
      const rows = `${formatCount(value.bindings.length)} ${value.bindings.length === 1 ? 'row' : 'rows'}`;
      const cols = `${value.columns.length} ${value.columns.length === 1 ? 'col' : 'cols'}`;
      return `${rows} · ${cols} · ${formatBytes(value.byteSize)}`;
    }
    case 'graph': {
      const triples = `${formatCount(value.tripleCount)} ${value.tripleCount === 1 ? 'triple' : 'triples'}`;
      return `${triples} · ${formatBytes(value.byteSize)}`;
    }
    case 'boolean':
      return String(value.answer);
  }
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * Count the triples in a serialization.
 *
 * Parsed with N3 so a Turtle document — where one subject can carry a dozen
 * predicates across as many lines — is counted in triples rather than in lines.
 * A parse failure falls back to counting statement lines: the count is a stat
 * chip, and a wrong-but-close number beats refusing to show a value that ran
 * perfectly well.
 */
export function countTriples(content: string, format: string): number {
  try {
    return new N3Parser({ format }).parse(content).length;
  } catch {
    return content
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0 && !line.trimStart().startsWith('#')).length;
  }
}

/** The RDF media types a graph value can hold, as `dataGraphInline` takes them. */
export function graphFormatFor(contentType: string | null | undefined): GraphValue['format'] {
  const type = (contentType ?? '').toLowerCase();
  if (type.includes('n-quads')) return 'application/n-quads';
  if (type.includes('n-triples')) return 'application/n-triples';
  return 'text/turtle';
}

export interface ValueSource {
  name: string;
  cellId: string;
  durationMs: number;
}

/** A SELECT result, as `/execute` returns it in SPARQL JSON. */
export function rowsValue(
  source: ValueSource,
  payload: { head?: { vars?: string[] }; results?: { bindings?: SparqlBindingRow[] } },
  rawBody: string,
): RowsValue {
  const bindings = payload.results?.bindings ?? [];
  /*
   * Columns come off the head rather than off the rows: an unbound variable is
   * simply absent from a binding, so deriving columns from the first row loses
   * a column that happens to be null in it.
   */
  const columns = payload.head?.vars ?? [...new Set(bindings.flatMap((row) => Object.keys(row)))];
  return {
    type: 'rows',
    ...source,
    producedAt: new Date().toISOString(),
    columns,
    bindings,
    byteSize: byteLength(rawBody),
  };
}

export function graphValue(source: ValueSource, content: string, contentType: string | null): GraphValue {
  const format = graphFormatFor(contentType);
  return {
    type: 'graph',
    ...source,
    producedAt: new Date().toISOString(),
    content,
    format,
    tripleCount: countTriples(content, format),
    byteSize: byteLength(content),
  };
}

export function booleanValue(source: ValueSource, answer: boolean): BooleanValue {
  return {
    type: 'boolean',
    ...source,
    producedAt: new Date().toISOString(),
    answer,
    byteSize: answer ? 4 : 5,
  };
}

/**
 * Pair a value's columns with the variables of the slot it is filling.
 *
 * The rule is the one a query group's edge uses, because a notebook chain that
 * paired columns differently from the group it promotes to would change meaning
 * on promotion: **by name where the names match, by position otherwise**. A
 * target variable with no partner is left unfilled rather than guessed at.
 */
export function mapColumns(sourceColumns: string[], targetVars: string[]): Array<{ source: string; target: string }> {
  const mappings: Array<{ source: string; target: string }> = [];
  const takenSources = new Set<string>();

  for (const target of targetVars) {
    if (sourceColumns.includes(target)) {
      mappings.push({ source: target, target });
      takenSources.add(target);
    }
  }

  if (mappings.length === targetVars.length) return mappings;

  // Positional for whatever is left, source columns in order, skipping the ones
  // already claimed by a name match so a column is never sent twice.
  const spare = sourceColumns.filter((column) => !takenSources.has(column));
  let cursor = 0;
  for (const target of targetVars) {
    if (mappings.some((entry) => entry.target === target)) continue;
    const source = spare[cursor];
    cursor += 1;
    if (source) mappings.push({ source, target });
  }

  return targetVars
    .map((target) => mappings.find((entry) => entry.target === target))
    .filter((entry): entry is { source: string; target: string } => Boolean(entry));
}

/**
 * A rows value, as the `arguments` entry `/execute` splices into one slot.
 *
 * Renaming happens here, client-side, because the route takes bindings keyed by
 * the *target* query's variables — the same thing the group engine does with an
 * edge's `variableMappings` before it runs a downstream node.
 */
export function toSlotArgument(
  value: RowsValue,
  targetVars: string[],
): { head: { vars: string[] }; arguments: { bindings: SparqlBindingRow[] } } {
  const mappings = mapColumns(value.columns, targetVars);
  const bindings = value.bindings.map((row) => {
    const mapped: SparqlBindingRow = {};
    for (const { source, target } of mappings) {
      const term = row[source];
      // An unbound term is left out, not written as null: that is how SPARQL
      // JSON spells UNDEF, and the runtime reads absence the same way.
      if (term !== undefined && term !== null) mapped[target] = term;
    }
    return mapped;
  });
  return { head: { vars: [...targetVars] }, arguments: { bindings } };
}
