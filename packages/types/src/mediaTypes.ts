import { isGraphQueryType, isResultSetQueryType, isUpdateQueryType } from './queryTypes.js';

export const SPARQL_RESULTS_MEDIA_TYPES = {
  JSON: 'application/sparql-results+json',
  XML: 'application/sparql-results+xml',
  CSV: 'text/csv',
  TSV: 'text/tab-separated-values',
} as const;

export const RDF_MEDIA_TYPES = {
  TURTLE: 'text/turtle',
  N_TRIPLES: 'application/n-triples',
  RDF_XML: 'application/rdf+xml',
  JSON_LD: 'application/ld+json',
  N3: 'text/n3',
  TRIG: 'application/trig',
  N_QUADS: 'application/n-quads',
} as const;

/**
 * The output an update has.
 *
 * Running an update produces nothing to render, which is why every media type
 * used to be invalid for one. `packages/rdf-delta` changes that: the ground
 * diff an update would make is derivable without executing it, so an update
 * query in the library gains an output after all — the patch, in the RDF Patch
 * dialect RDF-Delta uses, which is the format a consumer of these already
 * speaks. It is a family of one; the JSON shape of a patch is the `/patches`
 * entity, not an output format a query can be asked for.
 */
export const PATCH_MEDIA_TYPES = {
  RDF_PATCH: 'text/rdf-patch',
} as const;

export const OUTPUT_MEDIA_TYPES = {
  ...SPARQL_RESULTS_MEDIA_TYPES,
  ...RDF_MEDIA_TYPES,
  ...PATCH_MEDIA_TYPES,
} as const;

export type OutputMediaType = typeof OUTPUT_MEDIA_TYPES[keyof typeof OUTPUT_MEDIA_TYPES];

export const OUTPUT_MEDIA_TYPE_VALUES = Object.values(OUTPUT_MEDIA_TYPES);

export function getDefaultMediaType(queryType: string | null | undefined): OutputMediaType {
  if (isResultSetQueryType(queryType)) {
    return OUTPUT_MEDIA_TYPES.JSON;
  }

  if (isGraphQueryType(queryType)) {
    return OUTPUT_MEDIA_TYPES.TURTLE;
  }

  if (isUpdateQueryType(queryType)) {
    return OUTPUT_MEDIA_TYPES.RDF_PATCH;
  }

  return OUTPUT_MEDIA_TYPES.JSON;
}

export function isMediaTypeValidForQuery(mediaType: string, queryType: string | null | undefined): boolean {
  if (isResultSetQueryType(queryType)) {
    return Object.values(SPARQL_RESULTS_MEDIA_TYPES).includes(mediaType as any);
  }

  if (isGraphQueryType(queryType)) {
    return Object.values(RDF_MEDIA_TYPES).includes(mediaType as any);
  }

  if (isUpdateQueryType(queryType)) {
    return (Object.values(PATCH_MEDIA_TYPES) as readonly string[]).includes(mediaType);
  }

  return false;
}

export const MEDIA_TYPE_LABELS = {
  [OUTPUT_MEDIA_TYPES.JSON]: 'JSON (SPARQL Results)',
  [OUTPUT_MEDIA_TYPES.XML]: 'XML (SPARQL Results)',
  [OUTPUT_MEDIA_TYPES.CSV]: 'CSV',
  [OUTPUT_MEDIA_TYPES.TSV]: 'TSV',
  [OUTPUT_MEDIA_TYPES.TURTLE]: 'Turtle',
  [OUTPUT_MEDIA_TYPES.N_TRIPLES]: 'N-Triples',
  [OUTPUT_MEDIA_TYPES.RDF_XML]: 'RDF/XML',
  [OUTPUT_MEDIA_TYPES.JSON_LD]: 'JSON-LD',
  [OUTPUT_MEDIA_TYPES.N3]: 'N3',
  [OUTPUT_MEDIA_TYPES.TRIG]: 'TriG',
  [OUTPUT_MEDIA_TYPES.N_QUADS]: 'N-Quads',
  [OUTPUT_MEDIA_TYPES.RDF_PATCH]: 'RDF Patch',
} as const;
