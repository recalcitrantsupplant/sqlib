/**
 * The triple view of a data graph diff: the two sides as sets of triples, so
 * that line order, prefix names and blank node labels do not show as changes.
 *
 * Each side is parsed, canonicalised with RDFC-1.0 (`rdf-canonize`, as the API
 * does for test comparisons and patches), and written back one triple per line
 * in sorted order. Both sides use one prefix table, so a renamed prefix
 * abbreviates to the same text on both sides. Sorted, one-per-line text puts
 * the same triple on the same row, and the text diff viewer then shows only
 * the triples that one side has and the other does not.
 *
 * Canonical blank node labels (`_:c14n0`) are stable for the same graph. When
 * the description of a blank node changes, its label can change too, so its
 * triples show as removed and added. That is a change to the graph, and the
 * view shows it.
 *
 * RDF 1.2 triple terms are refused: `rdf-canonize` does not read them. The API
 * rewrites them before it canonicalises (`rdfCanonicalizer.ts`); this view has
 * not needed to.
 */

import { Parser, type Quad, type Term } from 'n3';
import rdfCanonize from 'rdf-canonize';

const XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string';
const COMMON_PREFIXES: Record<string, string> = {
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
  owl: 'http://www.w3.org/2002/07/owl#',
};
const RDF_LANG_STRING = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#langString';

export interface TripleDiffSide {
  text: string;
  /** `text/turtle`, `application/n-triples` or `application/n-quads`. */
  format: string;
  /** What the error names the side as: `v3`, `Draft`. */
  label: string;
}

export type TripleDiffResult =
  | {
      ok: true;
      leftText: string;
      rightText: string;
      /** Triples on the right side only. */
      added: number;
      /** Triples on the left side only. */
      removed: number;
    }
  | { ok: false; message: string };

interface ParsedSide {
  quads: Quad[];
  prefixes: Map<string, string>;
}

function parseSide(side: TripleDiffSide): ParsedSide {
  const prefixes = new Map<string, string>();
  const parser = new Parser({ format: side.format });
  const quads = parser.parse(side.text, null, (prefix, iri) => {
    if (prefix !== '') prefixes.set(prefix, iri.value);
  });
  return { quads, prefixes };
}

function hasTripleTerm(quad: Quad): boolean {
  // The n3 types predate RDF 1.2 and leave `Quad` out of a term's types.
  return [quad.subject, quad.object].some((term) => (term.termType as string) === 'Quad');
}

function escapeString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

/** A Turtle `PN_LOCAL` with no escapes. Anything else stays a full IRI. */
const SAFE_LOCAL = /^([A-Za-z0-9_]([A-Za-z0-9_.-]*[A-Za-z0-9_-])?)?$/;

/** One prefix table, longest namespace first, so the most specific one wins. */
type PrefixTable = Array<[prefix: string, namespace: string]>;

function renderIri(iri: string, table: PrefixTable, used: Set<string>): string {
  for (const [prefix, namespace] of table) {
    if (!iri.startsWith(namespace)) continue;
    const local = iri.slice(namespace.length);
    if (!SAFE_LOCAL.test(local)) continue;
    used.add(prefix);
    return `${prefix}:${local}`;
  }
  return `<${iri}>`;
}

function renderTerm(term: Term, table: PrefixTable, used: Set<string>): string {
  switch (term.termType) {
    case 'NamedNode':
      return renderIri(term.value, table, used);
    case 'BlankNode':
      return `_:${term.value}`;
    case 'Literal': {
      const lexical = `"${escapeString(term.value)}"`;
      if (term.language) return `${lexical}@${term.language}`;
      const datatype = term.datatype?.value;
      if (!datatype || datatype === XSD_STRING || datatype === RDF_LANG_STRING) return lexical;
      return `${lexical}^^${renderIri(datatype, table, used)}`;
    }
    default:
      return term.value;
  }
}

function renderQuad(quad: Quad, table: PrefixTable, used: Set<string>): string {
  const parts = [quad.subject, quad.predicate, quad.object].map((term) => renderTerm(term, table, used));
  if (quad.graph.termType !== 'DefaultGraph') parts.push(renderTerm(quad.graph, table, used));
  return `${parts.join(' ')} .`;
}

/** Canonical N-Quads lines, one per distinct quad. */
async function canonicalLines(quads: Quad[]): Promise<string[]> {
  if (quads.length === 0) return [];
  const nquads = quads.map((quad) => `${nquadTerm(quad.subject)} ${nquadTerm(quad.predicate)} ${nquadTerm(quad.object)}${
    quad.graph.termType === 'DefaultGraph' ? '' : ` ${nquadTerm(quad.graph)}`
  } .`).join('\n');
  const canonical = await rdfCanonize.canonize(rdfCanonize.NQuads.parse(nquads), {
    algorithm: 'RDFC-1.0',
    format: 'application/n-quads',
  });
  return canonical.split('\n').filter((line) => line.trim() !== '');
}

function nquadTerm(term: Term): string {
  switch (term.termType) {
    case 'NamedNode':
      return `<${term.value}>`;
    case 'BlankNode':
      return `_:${term.value}`;
    case 'Literal': {
      const lexical = `"${escapeString(term.value)}"`;
      if (term.language) return `${lexical}@${term.language}`;
      const datatype = term.datatype?.value;
      return !datatype || datatype === XSD_STRING ? lexical : `${lexical}^^<${datatype}>`;
    }
    default:
      return term.value;
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The two sides of the triple view, and how many triples each has that the
 * other does not.
 */
export async function planTripleDiff(left: TripleDiffSide, right: TripleDiffSide): Promise<TripleDiffResult> {
  const parsed: ParsedSide[] = [];
  for (const side of [left, right]) {
    try {
      const result = parseSide(side);
      if (result.quads.some(hasTripleTerm)) {
        return { ok: false, message: `${side.label} has triple terms. Use the text diff.` };
      }
      parsed.push(result);
    } catch (error) {
      return { ok: false, message: `${side.label} does not parse: ${errorText(error)}` };
    }
  }
  const [leftParsed, rightParsed] = parsed as [ParsedSide, ParsedSide];

  // The right side's names win a clash: it is the newer side by default. The
  // common vocabularies fill in where neither side names their namespace, so
  // a datatype reads as `xsd:integer`.
  const merged = new Map<string, string>(leftParsed.prefixes);
  for (const [prefix, namespace] of rightParsed.prefixes) merged.set(prefix, namespace);
  const namespaces = new Set(merged.values());
  for (const [prefix, namespace] of Object.entries(COMMON_PREFIXES)) {
    if (!merged.has(prefix) && !namespaces.has(namespace)) merged.set(prefix, namespace);
  }
  const table: PrefixTable = [...merged.entries()].sort((a, b) => b[1].length - a[1].length);

  const [leftLines, rightLines] = await Promise.all([
    canonicalLines(leftParsed.quads),
    canonicalLines(rightParsed.quads),
  ]);
  const leftSet = new Set(leftLines);
  const rightSet = new Set(rightLines);
  const removed = leftLines.filter((line) => !rightSet.has(line)).length;
  const added = rightLines.filter((line) => !leftSet.has(line)).length;

  // Render from the canonical lines, so blank nodes carry canonical labels.
  const used = new Set<string>();
  const render = (lines: string[]) => {
    // `blankNodePrefix: ''` keeps the labels as written; by default n3 prefixes them.
    const quads = new Parser({ format: 'application/n-quads', blankNodePrefix: '' }).parse(lines.join('\n'));
    return quads.map((quad) => renderQuad(quad, table, used)).sort();
  };
  const leftBody = render(leftLines);
  const rightBody = render(rightLines);

  const header = [...used]
    .sort()
    .map((prefix) => `@prefix ${prefix}: <${merged.get(prefix)}> .`);
  const compose = (body: string[]) => [...header, ...(header.length > 0 ? [''] : []), ...body].join('\n') + '\n';

  return { ok: true, leftText: compose(leftBody), rightText: compose(rightBody), added, removed };
}
