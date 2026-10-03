import * as oxigraph from 'oxigraph';

/**
 * RDF moving between the nodes of one group run.
 *
 * Every RDF value in a run is a string in *some* syntax: a CONSTRUCT answers in
 * whatever its backend sent for the run's `Accept`, a rule set answers in
 * N-Quads, a caller's data graph arrives in the format they named. Joining two
 * of those with a newline is only correct when both happen to be N-Triples, so
 * every hand-off that combines or re-labels RDF goes through a store instead.
 *
 * Format tokens are the ones `OxigraphStoreManager.loadDataFromString` takes.
 */
export type RdfPayload = { content: string; format: string };

/** The format token a media type (an `Accept` or a `Content-Type`) names. */
export function rdfFormatFromMediaType(mediaType: string | null | undefined): string {
  if (!mediaType) return 'nquads';
  const lower = mediaType.toLowerCase();
  if (lower.includes('n-quads')) return 'nquads';
  if (lower.includes('n-triples')) return 'ntriples';
  if (lower.includes('turtle')) return 'turtle';
  if (lower.includes('rdf+xml')) return 'rdfxml';
  if (lower.includes('json-ld') || lower.includes('ld+json')) return 'jsonld';
  if (lower.includes('trig')) return 'trig';
  return 'nquads';
}

const OXIGRAPH_FORMATS: Record<string, string> = {
  nquads: 'nq', nq: 'nq',
  ntriples: 'nt', nt: 'nt',
  turtle: 'ttl', ttl: 'ttl',
  rdfxml: 'xml', rdf: 'xml', xml: 'xml',
  jsonld: 'jsonld', 'json-ld': 'jsonld',
  trig: 'trig',
};

/** Syntaxes that can carry named graphs; the rest hold one graph only. */
const DATASET_FORMATS = new Set(['nq', 'trig', 'jsonld']);

function oxigraphFormat(format: string): string {
  const mapped = OXIGRAPH_FORMATS[format.toLowerCase()];
  if (!mapped) throw new Error(`Unsupported RDF format "${format}"`);
  return mapped;
}

/**
 * Whether text in `from` can be handed on as `to` unchanged: the same syntax,
 * or N-Triples where N-Quads is wanted (every N-Triples document is one).
 */
export function rdfFormatsAgree(from: string, to: string): boolean {
  const a = oxigraphFormat(from);
  const b = oxigraphFormat(to);
  return a === b || (a === 'nt' && b === 'nq');
}

/**
 * Parse every payload into one store and write it out as `format`.
 *
 * Each payload is parsed on its own, so blank node labels are local to the
 * payload that used them, as RDF merge requires. A single-graph target refuses
 * named-graph content rather than dropping it.
 */
export function mergeRdf(payloads: RdfPayload[], format: string): string {
  const store = new oxigraph.Store();
  for (const { content, format: from } of payloads) {
    if (!content.trim()) continue;
    store.load(content, { format: oxigraphFormat(from) });
  }
  const target = oxigraphFormat(format);
  if (DATASET_FORMATS.has(target)) return store.dump({ format: target });
  const named = store.match(null, null, null, null).find(quad => quad.graph.termType !== 'DefaultGraph');
  if (named) {
    throw new Error(
      `RDF in named graph ${named.graph.value} cannot be written as ${format}, which holds a single graph. `
      + 'Ask for N-Quads, TriG or JSON-LD instead.'
    );
  }
  return store.dump({ format: target, from_graph_name: oxigraph.defaultGraph() });
}

/** One payload as `format`: untouched when it already is, re-written otherwise. */
export function convertRdf(payload: RdfPayload, format: string): string {
  return rdfFormatsAgree(payload.format, format) ? payload.content : mergeRdf([payload], format);
}
