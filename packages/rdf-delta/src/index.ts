/**
 * `@sparql-query-lib/rdf-delta` — what a SPARQL update *would* do.
 *
 * Every update sqlib runs today mutates a store and leaves nothing behind: no
 * record of which triples changed, no way to see the effect first, no way to
 * undo it. This package is the missing half — the ground set of quads an update
 * adds and removes, derived with read-only access and without executing it.
 *
 * It has no Fastify, no `fs` and no network: pure functions over quad arrays and
 * an abstract store. Server-side, browser-side and worker-side derivation are
 * then the same code, and where the resulting patches get stored stays a late,
 * reversible decision.
 *
 * See `docs/explanation/rdf-patch.md`.
 */

export { EnumerationCapExceededError, UnsupportedUpdateError } from './errors.js';
export { planUpdate } from './plan.js';
export type {
  GraphOperationPlan,
  GraphRef,
  GraphTarget,
  OperationPlan,
  QuadOperationPlan,
  TemplatePart,
  UpdatePlan,
} from './plan.js';
export { derivePatch, probeUnionDefaultGraph } from './derive.js';
export type { DeriveOptions, Patch } from './derive.js';
export type { DeltaStore, SimulationStore } from './deltaStore.js';
export type { GraphOperationRecord } from './graphOps.js';
export { oxigraphDeltaStore } from './oxigraph.js';
export type { OxigraphDeltaStoreOptions, OxigraphStoreLike } from './oxigraph.js';
export {
  invertPatch,
  patchToNQuads,
  patchToRdfPatch,
  patchToSparqlUpdate,
} from './patch.js';
export type { RdfPatchOptions } from './patch.js';
export {
  QuadSet,
  graphIri,
  quadHasBlankNode,
  quadKey,
  quadToNQuad,
  quadsToNQuads,
  termToNTriples,
  withGraph,
} from './terms.js';
export type {
  BlankNodeLike,
  DefaultGraphLike,
  GraphTermLike,
  LiteralLike,
  NamedNodeLike,
  QuadLike,
  QuadTermLike,
  TermLike,
} from './terms.js';
