/**
 * How one VALUES cell reads: its short type label, its placeholder, and the
 * SPARQL text it becomes.
 *
 * Three views of a clause now render the same term — the stacked field, the
 * grid, and the clause view — so the strings they show it with live here
 * rather than three times over.
 */
import { XSD_DATATYPES, type SparqlValue } from '@/types/argument-sets';

/** A blank lexical form binds UNDEF; that is a value, not an unfinished one. */
export function isUndef(value: SparqlValue | undefined): boolean {
  return (value?.value ?? '').trim().length === 0;
}

/** The badge on a cell: `IRI`, `@en`, `Lit`, or the datatype's short name. */
export function termTypeLabel(value: SparqlValue): string {
  if (value.type !== 'literal') return 'IRI';
  if (value['xml:lang']) return `@${value['xml:lang']}`;
  const datatype = value.datatype;
  if (!datatype) return 'Lit';
  const short = XSD_DATATYPES.find((entry) => entry.value === datatype)?.label;
  return short ?? datatype.split(/[#/]/).pop() ?? 'Lit';
}

/** What an empty cell suggests typing, taken from the type it already carries. */
export function termPlaceholder(value: SparqlValue): string {
  if (value.type === 'uri') return 'http://example.org/resource';
  const datatype = value.datatype ?? '';
  if (datatype.includes('integer')) return '123';
  if (datatype.includes('decimal') || datatype.includes('double') || datatype.includes('float')) return '123.45';
  if (datatype.includes('boolean')) return 'true';
  if (datatype.includes('dateTime')) return '2024-01-01T00:00:00Z';
  if (datatype.includes('date')) return '2024-01-01';
  return 'value';
}

/**
 * The term as SPARQL would carry it, for the clause view.
 *
 * Not a serializer for the wire — the wire is SRJ — but the clause view claims
 * to show the clause as it will be sent, so `<…>`, `"…"^^…` and `UNDEF` have
 * to be what it shows.
 */
export function termToSparql(value: SparqlValue | undefined): string {
  if (!value || isUndef(value)) return 'UNDEF';
  const lexical = value.value;
  if (value.type === 'uri') return `<${lexical}>`;
  const quoted = `"${lexical.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  if (value['xml:lang']) return `${quoted}@${value['xml:lang']}`;
  if (value.datatype) {
    const short = XSD_DATATYPES.find((entry) => entry.value === value.datatype)?.label;
    return `${quoted}^^${short ?? `<${value.datatype}>`}`;
  }
  return quoted;
}

/**
 * What a pasted or typed lexical form most likely means.
 *
 * The grid is one text box per cell, which is the point of it — so something
 * has to decide that `http://…` is an IRI and `42` an integer. Only ever
 * applied to a cell the author has not already typed by hand: an explicit
 * choice in the term menu is never second-guessed.
 */
export function inferTerm(text: string): SparqlValue {
  const trimmed = text.trim();
  if (!trimmed) return { type: 'uri', value: '' };
  if (/^<.*>$/.test(trimmed)) return { type: 'uri', value: trimmed.slice(1, -1) };
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\S*$/.test(trimmed) && !/^\d/.test(trimmed)) {
    return { type: 'uri', value: trimmed };
  }
  if (/^[+-]?\d+$/.test(trimmed)) {
    return { type: 'literal', value: trimmed, datatype: 'http://www.w3.org/2001/XMLSchema#integer' };
  }
  if (/^[+-]?(\d+\.\d*|\.\d+)$/.test(trimmed)) {
    return { type: 'literal', value: trimmed, datatype: 'http://www.w3.org/2001/XMLSchema#decimal' };
  }
  if (/^(true|false)$/i.test(trimmed)) {
    return { type: 'literal', value: trimmed.toLowerCase(), datatype: 'http://www.w3.org/2001/XMLSchema#boolean' };
  }
  return { type: 'literal', value: text };
}

/** Split a clipboard payload into rows of cells, TSV first and CSV after. */
export function parsePastedRows(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n');
  const separator = lines.some((line) => line.includes('\t')) ? '\t' : ',';
  return lines.map((line) => line.split(separator).map((cell) => cell.trim()));
}
