/**
 * LDKit Schema for QueryNode Entity
 * 
 * This entity represents nodes in a query execution graph.
 */

import type { Schema } from '../schema.js';
import { ldkit, rdf, sqlib, sdo } from '../namespaces.js';

export const QueryNodeSchema = {
  '@type': sqlib.QueryNode,
  queryId: {
    '@id': sqlib.queryId,
    '@type': ldkit.IRI,
    '@references': { types: ['QueryVersion'] },
  },
  /**
   * Optional because a node with an ephemeral `backendConfig` never reads it:
   * `ExecutorFactory` branches on the config first and builds an executor over
   * the ephemeral store. Requiring it made every all-ephemeral group name an
   * irrelevant backend, which read as a coupling the group did not have and
   * broke if that backend was deleted (issue #297).
   *
   * "Exactly one of a resolvable `backendId` or an ephemeral `backendConfig`"
   * is the real rule, and it is a relationship between two properties rather
   * than a cardinality on either, so `GroupVersionWriter` enforces it.
   */
  backendId: {
    '@id': sqlib.backendId,
    '@type': ldkit.IRI,
    '@optional': true,
    '@references': { types: ['Backend'] },
  },
  inputs: {
    '@id': sqlib.inputs,
    '@array': true,
    '@type': ldkit.IRI,
    '@optional': true,
  },
  outputs: {
    '@id': sqlib.outputs,
    '@array': true,
    '@type': ldkit.IRI,
    '@optional': true,
  },
  /**
   * `rdf:JSON`, not a plain literal: the value is a document. Undeclared, it
   * reached the serialiser's string fallback and was stored as
   * `String(value)` — the literal `"[object Object]"` — so the config survived
   * only as long as the write-through cache held the original object and was
   * gone from every node the moment the cache was rebuilt (issue #305).
   */
  backendConfig: {
    '@id': sqlib.backendConfig,
    '@type': rdf.JSON,
    '@jsonShape': 'EphemeralBackendConfig',
    '@optional': true,
  },
  nodeType: {
    '@id': sqlib.nodeType,
    '@optional': true,
  },
} as const satisfies Schema;

export interface EphemeralBackendConfig {
  type: 'ephemeral-oxigraph';
  storeId: string;
}

export interface LdkitQueryNode {
  '$id': string;
  '@type'?: 'QueryNode';
  queryId: string; // Required - reference to QueryVersion
  backendId?: string | null; // Reference to Backend; absent on a node with an ephemeral backendConfig
  inputs?: string[] | null; // Array of IRIs referencing any input entities (QueryInputTuple, TriplesQuadsIO, etc.)
  outputs?: string[] | null; // Array of IRIs referencing any output entities (QueryOutputTuple, TriplesQuadsIO, etc.)
  backendConfig?: EphemeralBackendConfig | null; // For ephemeral oxigraph backends
  nodeType?: string; // Explicit node type field for REST API discrimination
}
