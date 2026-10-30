/**
 * SELECT results in the formats a SPARQL endpoint answers with, and the
 * `Accept` negotiation that picks one.
 *
 * Every SELECT sqlib runs comes back as SPARQL JSON at some point: Oxigraph
 * only produces that, a query group chains JSON from node to node, and an HTTP
 * endpoint is free to ignore the Accept header it was sent. So the format a
 * caller asked for is rendered here, from the JSON, rather than hoped for from
 * the backend. The serialisations follow the W3C recommendations:
 *
 * - XML: https://www.w3.org/TR/rdf-sparql-XMLres/
 * - CSV and TSV: https://www.w3.org/TR/sparql11-results-csv-tsv/
 */

import { SPARQL_RESULTS_MEDIA_TYPES } from '../types/media-types.js';

export type SparqlResultsMediaType =
  (typeof SPARQL_RESULTS_MEDIA_TYPES)[keyof typeof SPARQL_RESULTS_MEDIA_TYPES];

/** One RDF term in a binding, as SPARQL JSON spells it. */
type ResultTerm = {
  type: string;
  value: string;
  datatype?: string;
  'xml:lang'?: string;
};

export type SelectResults = {
  head: { vars: string[]; link?: string[] };
  results: { bindings: Array<Record<string, ResultTerm | undefined>> };
};

/** Whether a node or executor result is a SELECT result set in SPARQL JSON. */
export function isSelectResults(result: unknown): result is SelectResults {
  if (!result || typeof result !== 'object') return false;
  const candidate = result as Partial<SelectResults>;
  return Array.isArray(candidate.head?.vars) && Array.isArray(candidate.results?.bindings);
}

const ALIASES: Record<string, SparqlResultsMediaType> = {
  'application/json': SPARQL_RESULTS_MEDIA_TYPES.JSON,
  'application/xml': SPARQL_RESULTS_MEDIA_TYPES.XML,
  'text/xml': SPARQL_RESULTS_MEDIA_TYPES.XML,
  'text/tsv': SPARQL_RESULTS_MEDIA_TYPES.TSV,
};

const MEDIA_TYPES = Object.values(SPARQL_RESULTS_MEDIA_TYPES) as string[];

/**
 * Which SELECT results format an `Accept` header asks for.
 *
 * Returns `undefined` when the header names none of them, including a missing
 * header and a bare wildcard: the caller then gets what it always got. A
 * header naming only formats sqlib cannot produce is not answered with a 406,
 * because `/execute` never refused one before and a browser's default Accept
 * would start failing.
 */
export function negotiateSelectResultsFormat(header: string | undefined | null): SparqlResultsMediaType | undefined {
  if (!header) return undefined;
  const entries = header
    .split(',')
    .map((part, order) => {
      const [type, ...params] = part.trim().split(';');
      const qParam = params.map(p => p.trim()).find(p => p.toLowerCase().startsWith('q='));
      const parsed = qParam ? Number.parseFloat(qParam.slice(2)) : 1;
      return { type: (type ?? '').trim().toLowerCase(), q: Number.isFinite(parsed) ? parsed : 1, order };
    })
    .filter(entry => entry.type !== '' && entry.q > 0)
    .sort((a, b) => (b.q - a.q) || (a.order - b.order));

  for (const { type } of entries) {
    if (MEDIA_TYPES.includes(type)) return type as SparqlResultsMediaType;
    if (ALIASES[type]) return ALIASES[type];
  }
  return undefined;
}

/** The `Content-Type` a rendered result is sent with. */
export function contentTypeForSelectResults(mediaType: SparqlResultsMediaType): string {
  return mediaType === SPARQL_RESULTS_MEDIA_TYPES.JSON ? mediaType : `${mediaType}; charset=utf-8`;
}

/**
 * The results as the body of a reply in `mediaType`.
 *
 * JSON is returned as the object itself, so Fastify serialises it as it did
 * before; the other formats are strings.
 */
export function renderSelectResults(results: SelectResults, mediaType: SparqlResultsMediaType): SelectResults | string {
  switch (mediaType) {
    case SPARQL_RESULTS_MEDIA_TYPES.CSV:
      return toCsv(results);
    case SPARQL_RESULTS_MEDIA_TYPES.TSV:
      return toTsv(results);
    case SPARQL_RESULTS_MEDIA_TYPES.XML:
      return toXml(results);
    default:
      return results;
  }
}

/**
 * CSV keeps only the value of each term: an IRI without brackets, a literal's
 * lexical form, a blank node as `_:label`. Lines end in CRLF, as RFC 4180 has it.
 */
export function toCsv(results: SelectResults): string {
  const vars = results.head.vars;
  const lines = [vars.map(csvField).join(',')];
  for (const binding of results.results.bindings) {
    lines.push(vars.map(name => {
      const term = binding[name];
      if (!term) return '';
      return csvField(isBlankNode(term) ? `_:${term.value}` : term.value);
    }).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** TSV keeps each term whole, in Turtle syntax, under a `?var` header. */
export function toTsv(results: SelectResults): string {
  const vars = results.head.vars;
  const lines = [vars.map(name => `?${name}`).join('\t')];
  for (const binding of results.results.bindings) {
    lines.push(vars.map(name => {
      const term = binding[name];
      return term ? turtleTerm(term) : '';
    }).join('\t'));
  }
  return `${lines.join('\n')}\n`;
}

function turtleTerm(term: ResultTerm): string {
  if (term.type === 'uri') return `<${term.value}>`;
  if (isBlankNode(term)) return `_:${term.value}`;
  const lexical = `"${term.value.replace(/[\\"\t\n\r]/g, ch => TURTLE_ESCAPES[ch]!)}"`;
  if (term['xml:lang']) return `${lexical}@${term['xml:lang']}`;
  if (term.datatype) return `${lexical}^^<${term.datatype}>`;
  return lexical;
}

const TURTLE_ESCAPES: Record<string, string> = {
  '\\': '\\\\',
  '"': '\\"',
  '\t': '\\t',
  '\n': '\\n',
  '\r': '\\r',
};

export function toXml(results: SelectResults): string {
  const vars = results.head.vars;
  const out: string[] = [
    '<?xml version="1.0"?>',
    '<sparql xmlns="http://www.w3.org/2005/sparql-results#">',
    '  <head>',
    ...vars.map(name => `    <variable name="${xmlEscape(name)}"/>`),
    ...(results.head.link ?? []).map(href => `    <link href="${xmlEscape(href)}"/>`),
    '  </head>',
    '  <results>',
  ];
  for (const binding of results.results.bindings) {
    out.push('    <result>');
    for (const name of vars) {
      const term = binding[name];
      if (!term) continue;
      out.push(`      <binding name="${xmlEscape(name)}">${xmlTerm(term)}</binding>`);
    }
    out.push('    </result>');
  }
  out.push('  </results>', '</sparql>');
  return `${out.join('\n')}\n`;
}

function xmlTerm(term: ResultTerm): string {
  const value = xmlEscape(term.value);
  if (term.type === 'uri') return `<uri>${value}</uri>`;
  if (isBlankNode(term)) return `<bnode>${value}</bnode>`;
  if (term['xml:lang']) return `<literal xml:lang="${xmlEscape(term['xml:lang'])}">${value}</literal>`;
  if (term.datatype) return `<literal datatype="${xmlEscape(term.datatype)}">${value}</literal>`;
  return `<literal>${value}</literal>`;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isBlankNode(term: ResultTerm): boolean {
  return term.type === 'bnode';
}
