/**
 * What a data graph's content is allowed to be, and how big it is allowed to get.
 *
 * One module rather than logic spread across the writer and the execute routes,
 * because inline data graphs (`dataGraphInline` on an execute request) go
 * through exactly the same parse and the same caps as saved ones. An inline
 * graph is ephemeral, not unchecked: the cap is what makes "the library stores
 * your reference data" an honest offer rather than bulk hosting, and a caller
 * who could dodge it by sending the same bytes to `/execute` would make the cap
 * decorative.
 *
 * Parsing is done by loading into a throwaway Oxigraph store — the same engine
 * that will hold the graph at execution time. So "it parses" here means "it
 * loads there", rather than meaning "some other parser accepted it".
 */

import * as oxigraph from 'oxigraph';

/** The serialisations a data graph may be written in. */
export const DATA_GRAPH_FORMATS = ['text/turtle', 'application/n-triples', 'application/n-quads'] as const;

export type DataGraphFormat = (typeof DATA_GRAPH_FORMATS)[number];

export const DEFAULT_DATA_GRAPH_FORMAT: DataGraphFormat = 'text/turtle';

/**
 * Per-version content cap, in bytes.
 *
 * Dev/test/reference data, not bulk hosting — 1 MB of Turtle is on the order of
 * ten thousand triples, which is more than any example needs and far less than
 * anything that would want a real store behind it. Tunable by environment so a
 * self-hosted deployment can make its own call.
 */
export const MAX_DATA_GRAPH_VERSION_BYTES = Number.parseInt(
  process.env.DATA_GRAPH_MAX_VERSION_BYTES ?? '1048576',
  10,
) || 1048576;

/**
 * Per-library total across every stored data graph version, in bytes.
 *
 * The per-version cap alone bounds nothing: a thousand versions of a megabyte
 * each is a gigabyte held in the entity store. This is the cap that actually
 * limits what a library costs.
 */
export const MAX_DATA_GRAPH_LIBRARY_BYTES = Number.parseInt(
  process.env.DATA_GRAPH_MAX_LIBRARY_BYTES ?? '16777216',
  10,
) || 16777216;

export function isDataGraphFormat(value: unknown): value is DataGraphFormat {
  return typeof value === 'string' && (DATA_GRAPH_FORMATS as readonly string[]).includes(value);
}

/** The format name `OxigraphStoreManager.loadDataFromString` takes. */
export function storeManagerFormat(format: DataGraphFormat): string {
  switch (format) {
    case 'text/turtle':
      return 'turtle';
    case 'application/n-triples':
      return 'ntriples';
    case 'application/n-quads':
      return 'nquads';
  }
}

/** The short token `oxigraph.Store.load` itself takes. */
function oxigraphLoadFormat(format: DataGraphFormat): string {
  switch (format) {
    case 'text/turtle':
      return 'ttl';
    case 'application/n-triples':
      return 'nt';
    case 'application/n-quads':
      return 'nq';
  }
}

export class DataGraphContentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataGraphContentError';
  }
}

/**
 * Re-serialise RDF text as N-Quads.
 *
 * For the comparators, which reduce graph equality to string equality of
 * canonical N-Quads and so cannot read anything else. Anywhere a graph may be
 * *written* in the serialisation its author chose — an expected result pasted
 * into a test, a `.ttl` from a vendored suite — this is the one hop that makes
 * it comparable, rather than every producer having to convert first.
 *
 * Parsing is loading into a throwaway store, as everywhere else in this module:
 * "it converts" means "the engine read it".
 */
export function rdfToNQuads(content: string, format: string = DEFAULT_DATA_GRAPH_FORMAT): string {
  if (!isDataGraphFormat(format)) {
    throw new DataGraphContentError(
      `Unsupported RDF format "${format}". Expected one of: ${DATA_GRAPH_FORMATS.join(', ')}`,
    );
  }
  if (!content.trim()) return '';

  const store = new oxigraph.Store();
  try {
    store.load(content, { format: oxigraphLoadFormat(format) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new DataGraphContentError(`Invalid ${format} content: ${message}`);
  }
  return store.dump({ format: 'nq' });
}

export interface DataGraphContentFacts {
  contentString: string;
  contentFormat: DataGraphFormat;
  /** Quads the content actually parsed to, counted by the store that loaded it. */
  tripleCount: number;
  /** UTF-8 length of `contentString`. What the caps are measured in. */
  byteSize: number;
}

export function dataGraphByteSize(contentString: string): number {
  return Buffer.byteLength(contentString, 'utf8');
}

/**
 * Parse, count and size-check one piece of data-graph content.
 *
 * Throws `DataGraphContentError` on anything a caller could have got right:
 * unknown format, unparseable RDF, over the per-version cap. The caller turns
 * that into a 400 — none of these are server faults.
 */
export function inspectDataGraphContent(
  contentString: string,
  contentFormat: string = DEFAULT_DATA_GRAPH_FORMAT,
): DataGraphContentFacts {
  if (!isDataGraphFormat(contentFormat)) {
    throw new DataGraphContentError(
      `Unsupported data graph format "${contentFormat}". Expected one of: ${DATA_GRAPH_FORMATS.join(', ')}`,
    );
  }

  if (!contentString.trim()) {
    throw new DataGraphContentError('Data graph content must not be empty');
  }

  const byteSize = dataGraphByteSize(contentString);
  if (byteSize > MAX_DATA_GRAPH_VERSION_BYTES) {
    throw new DataGraphContentError(
      `Data graph content is ${byteSize} bytes, over the ${MAX_DATA_GRAPH_VERSION_BYTES}-byte limit for one version`,
    );
  }

  // Parse by loading, so "valid" means "the execution engine can read it".
  const store = new oxigraph.Store();
  try {
    store.load(contentString, { format: oxigraphLoadFormat(contentFormat) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new DataGraphContentError(`Invalid ${contentFormat} content: ${message}`);
  }

  return { contentString, contentFormat, tripleCount: store.size, byteSize };
}
