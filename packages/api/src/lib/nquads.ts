/**
 * N-Quads rendering of RDF terms now lives in `@sparql-query-lib/runtime-srl`,
 * which hashes datasets with it. Re-exported here for the API modules that
 * import it from this path.
 */
export { quadToNQuad, termToNQuad, type RenderableQuad, type RenderableTerm } from '@sparql-query-lib/runtime-srl';
