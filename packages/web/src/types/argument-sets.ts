/**
 * Type definitions for Argument Sets feature
 *
 * These types align with the backend API schemas defined in:
 * packages/api/src/routes/argument-set-schemas.ts
 */

// ============================================================================
// SPARQL Value Types (W3C SPARQL 1.1 Query Results JSON Format)
// ============================================================================

import type { DataGraphFormat } from './data-graphs'

export interface SparqlValue {
  type: 'uri' | 'literal'
  value: string
  datatype?: string
  'xml:lang'?: string
}

export type SparqlBinding = Record<string, SparqlValue>

// ============================================================================
// Argument Set Core Types
// ============================================================================

export interface ArgumentRow {
  id?: string
  position?: number
  values: SparqlBinding
}

/**
 * A tuple set filling a clause by reference rather than by copy.
 *
 * The two ids are the two lives of one reference. Attaching one on a draft
 * knows the *set* and nothing more: the rows a run gets are whatever its
 * current version holds, so the reference floats.
 * Saving resolves it and writes the *version*, because a saved set has to keep
 * meaning what it meant — the same reason `RuleSetVersion` pins rule versions.
 * A reference read back off the server therefore arrives as a version id alone,
 * with the set recovered by lookup.
 *
 * At least one of the two is always set.
 */
export interface TupleSetReference {
  /** The set this points at, when it is known without a lookup. */
  tupleSetId?: string | null
  /** The version it is pinned to. Null while the reference floats on a draft. */
  versionId?: string | null
}

export interface ArgumentTupleBinding {
  id?: string
  /** Its slot among the set's ordered inputs — the key a group routes against. */
  position?: number
  tupleSignature: string
  variables: string[]
  rows: ArgumentRow[]
  /**
   * Tuple sets filling this clause by reference, unioned with `rows` at
   * execution — the editor's view of them, pinned or floating.
   *
   * `tupleSetVersions` is what the wire carries and is always pinned; this is
   * derived from it on the way in and collapsed back to it on the way out, so
   * only one of the two is ever authoritative at a time.
   */
  tupleSetRefs?: TupleSetReference[]
  /** Pinned `TupleSetVersion` IRIs, as the server stores and returns them. */
  tupleSetVersions?: string[] | null
}

/**
 * One graph among a set's ordered inputs.
 *
 * Groups only. A query declares no graph parameter — its store is its backend,
 * and "run this query over that graph" is a backend hydrated from the graph
 * (`OxigraphDataGraphSource`).
 *
 * Which start-node port it fills is not here: an argument set carries payload
 * and the group owns the routing, so a graph carries only its slot.
 *
 * Exactly one of `dataGraphVersionId` (pinned, reproducible) or
 * `contentString` + `contentFormat` (pasted, stored with the version).
 */
export interface ArgumentGraphBinding {
  id?: string
  /** Its slot among the set's ordered inputs — the key a group routes against. */
  position?: number
  dataGraphVersionId?: string | null
  contentString?: string | null
  contentFormat?: DataGraphFormat | null
}

export interface ArgumentScalarBinding {
  id?: string
  parameterKind: 'limit' | 'offset'
  parameterName: string
  numericValue: number
  parameterIri?: string
}

export interface ArgumentSetVersionDetail {
  id: string
  isPartOf: string
  version: number
  tupleBindings: ArgumentTupleBinding[]
  scalarBindings: ArgumentScalarBinding[]
  graphBindings?: ArgumentGraphBinding[]
  dateCreated: string
  dateModified: string
}

export interface ArgumentSetDetail {
  id: string
  name: string
  description?: string | null
  /**
   * Where the set was made. Null on one composed from the rail, and optional
   * because a response may omit it entirely — provenance, not identity.
   */
  scope?: 'query' | 'queryGroup' | null
  targetId?: string | null
  /** The library that contains it — what the rail lists by. */
  libraryId?: string
  currentVersionId?: string | null
  currentVersion?: ArgumentSetVersionDetail | null
  tupleBindings: ArgumentTupleBinding[]
  scalarBindings: ArgumentScalarBinding[]
  graphBindings?: ArgumentGraphBinding[]
  dateCreated: string
  dateModified: string
}

export interface ArgumentSetInput {
  name: string
  description?: string
  /** The library, for a set composed on the rail rather than under a callable. */
  libraryId?: string
  /* Optional: a set may fill only numbers, or only graph ports. */
  tupleBindings?: ArgumentTupleBinding[]
  scalarBindings?: ArgumentScalarBinding[]
  graphBindings?: ArgumentGraphBinding[]
}

export interface ArgumentSetVersionInput {
  tupleBindings?: ArgumentTupleBinding[]
  scalarBindings?: ArgumentScalarBinding[]
  graphBindings?: ArgumentGraphBinding[]
}

// ============================================================================
// Runtime Execution Types
// ============================================================================

export interface ExecutionArgument {
  head: { vars: string[] }
  arguments: { bindings: SparqlBinding[] }
}

/**
 * One graph a run hands to a query group.
 *
 * Routed by where it sits in the run's list — entry N fills the Nth data input
 * the start node declares. Nothing names a port: a run says what it supplies
 * and in what order, and the group says where each one goes.
 */
export interface ExecutionDataGraphInput {
  dataGraphVersionId?: string | null
  dataGraphId?: string | null
  dataGraphInline?: string | null
  dataGraphInlineFormat?: DataGraphFormat | null
}

export interface ExecutionArgumentsExport {
  arguments: ExecutionArgument[]
  limits: { name: string; value: number }[]
  offsets: { name: string; value: number }[]
  /** The graphs the set supplies, in slot order; a query target ignores these. */
  dataGraphs?: ExecutionDataGraphInput[]
}

/**
 * The editor payload a browser-local argument-set record carries.
 *
 * Stored as `CallableDraft.body` for `section: 'argumentSet'`. The fields a
 * callable record has already — name, description, `basedOn`, `edits` — stay on
 * the record; only what is particular to an argument set lives here.
 */
export interface ArgumentSetDraftBody {
  /** Where it was made. Null on a set composed from the rail. */
  scope: 'query' | 'queryGroup' | null
  targetId: string | null
  /** The version the edits were taken from, so a diff has a left-hand side. */
  basedOnVersion: number | null
  tupleBindings: ArgumentTupleBinding[]
  scalarBindings: ArgumentScalarBinding[]
  graphBindings: ArgumentGraphBinding[]
}

// ============================================================================
// UI-Specific Types
// ============================================================================

export interface TestArgumentValues {
  tuples: Map<string, SparqlBinding[]>
  limits: Map<string, number>
  offsets: Map<string, number>
}

export interface VariableSchema {
  name: string
  nodeKind: 'uri' | 'literal'
  datatype?: string
}

export interface TupleBindingSchema {
  tupleSignature: string
  variables: VariableSchema[]
}

export type ArgumentSetMode = 'view' | 'edit' | 'create'

// ============================================================================
// Common XSD Datatypes
// ============================================================================

export const XSD_DATATYPES = [
  { value: 'http://www.w3.org/2001/XMLSchema#string', label: 'xsd:string' },
  { value: 'http://www.w3.org/2001/XMLSchema#integer', label: 'xsd:integer' },
  { value: 'http://www.w3.org/2001/XMLSchema#decimal', label: 'xsd:decimal' },
  { value: 'http://www.w3.org/2001/XMLSchema#boolean', label: 'xsd:boolean' },
  { value: 'http://www.w3.org/2001/XMLSchema#dateTime', label: 'xsd:dateTime' },
  { value: 'http://www.w3.org/2001/XMLSchema#date', label: 'xsd:date' },
  { value: 'http://www.w3.org/2001/XMLSchema#time', label: 'xsd:time' },
  { value: 'http://www.w3.org/2001/XMLSchema#double', label: 'xsd:double' },
  { value: 'http://www.w3.org/2001/XMLSchema#float', label: 'xsd:float' },
] as const

export const NODE_KINDS = [
  { value: 'uri', label: 'IRI' },
  { value: 'literal', label: 'Literal' },
] as const
