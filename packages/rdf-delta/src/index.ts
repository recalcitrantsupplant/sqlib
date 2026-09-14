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
export { derivePatch } from './derive.js';
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
  SNAPSHOT_FORMAT,
  SnapshotCapacityError,
  RebaseExhaustedError,
  checkpointGraph,
  contentDigest,
  dumpGraph,
  loadGraph,
  rebaseAndRetry,
} from './blobSnapshot.js';
export type {
  CheckpointInputs,
  CheckpointOutcome,
  GraphNameLike,
  RebaseInputs,
  RebaseResult,
  RebaseStoreLike,
  SnapshotStoreLike,
} from './blobSnapshot.js';
export { memoryConditionalBlobStore } from './blobStore.js';
export type {
  BlobGetOutcome,
  BlobPutCondition,
  BlobPutOutcome,
  ConditionalBlobStore,
} from './blobStore.js';
export { BlobStoreError, httpConditionalBlobStore } from './blobStoreHttp.js';
export type { BlobFetch, BlobResponseLike, HttpBlobStoreOptions } from './blobStoreHttp.js';
export {
  DEFAULT_GRAPH_COLUMN,
  asOfSql,
  checkpointSql,
  churnByPatchSql,
  createPatchLogTableSql,
  fromCheckpointSql,
  hotQuadsSql,
  latestArgMaxSql,
  latestQualifySql,
  nquadsSql,
} from './patchLog.js';
export type { PatchLogRow } from './patchLog.js';
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
