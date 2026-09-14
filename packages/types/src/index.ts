/**
 * SPARQL result binding value as described by the SPARQL Query Results JSON format.
 */
export interface SparqlBindingValue {
  type: "uri" | "literal" | "typed-literal" | "bnode"
  value: string
  datatype?: string
  "xml:lang"?: string
}

/**
 * A single SPARQL binding mapping variable names to values.
 */
export type SparqlBinding = Record<string, SparqlBindingValue | undefined>

/**
 * SPARQL SELECT query response payload.
 */
export interface SparqlResults {
  head: {
    vars: string[]
    link?: string[]
  }
  results: {
    bindings: SparqlBinding[]
  }
  boolean?: boolean
}

/**
 * Special backend ID constant for ephemeral (in-memory) Oxigraph execution.
 * This is not a persisted backend entity - it's a special execution mode.
 */
export const EPHEMERAL_BACKEND_ID = 'urn:sparql-query-lib:backend:ephemeral'

/**
 * Special backend ID representing the internal library storage backend.
 * Routes can use this to force execution against the authoritative store.
 */
export const LIBRARY_STORAGE_BACKEND_ID = 'urn:sparql-query-lib:backend:library-storage'

/**
 * Display label for ephemeral backend option in UI.
 */
export const EPHEMERAL_BACKEND_LABEL = 'Ephemeral Oxigraph (In-Memory)'

// Re-export directly from TypeScript sources (TypeScript will resolve the .js extension to .ts)
export * from './featureFlags.js'
export * from './queryTypes.js'
export * from './mediaTypes.js'
export * from './ioTypes.js'
export * from './authEnvKey.js'
export * from './subjectKinds.js'
export * from './parameterKeys.js'
