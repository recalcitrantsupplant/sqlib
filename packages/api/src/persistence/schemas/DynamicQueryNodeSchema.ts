/**
 * LDKit Schema for DynamicQueryNode Entity
 * 
 * DynamicQueryNode represents a query execution node where the query to execute
 * can be determined at runtime. This supports two main use cases:
 * 1. Query ID selection: Another node outputs a queryId which determines which query to run
 * 2. Runtime query generation: Query is constructed dynamically based on parameters
 */

import type { Schema } from '../schema.js';
import type { EphemeralBackendConfig } from './QueryNodeSchema.js';
import { ldkit, rdf, xsd, sqlib, sdo } from '../namespaces.js';

export const DynamicQueryNodeSchema = {
  '@type': sqlib.DynamicQueryNode,
  queryId: {
    '@id': sqlib.queryId,
    '@type': ldkit.IRI,
    '@optional': true,
    '@references': { types: ['QueryVersion'] },
  },
  /** Optional for the same reason as `QueryNode.backendId` — see that schema. */
  backendId: {
    '@id': sqlib.backendId,
    '@type': ldkit.IRI,
    '@optional': true,
    '@references': { types: ['Backend'] },
  },
  /**
   * Declared here because `GroupVersionWriter` stages it for both node types
   * and the orchestration layer reads it off either, so leaving it undeclared
   * meant a dynamic node's ephemeral store was dropped on write without a word
   * — the silent-loss half of issue #305.
   */
  backendConfig: {
    '@id': sqlib.backendConfig,
    '@type': rdf.JSON,
    '@jsonShape': 'EphemeralBackendConfig',
    '@optional': true,
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
  dateCreated: {
    '@id': sdo.dateCreated,
    '@type': xsd.dateTime,
    '@optional': true,
  },
  dateModified: {
    '@id': sdo.dateModified,
    '@type': xsd.dateTime,
    '@optional': true,
  },
  nodeType: {
    '@id': sqlib.nodeType,
    '@optional': true,
  },
} as const satisfies Schema;

export interface LdkitDynamicQueryNode {
  '$id': string;
  '@type'?: 'DynamicQueryNode';
  queryId?: string | null; // Runtime-determined query reference
  backendId?: string | null; // Backend reference; absent on a node with an ephemeral backendConfig
  backendConfig?: EphemeralBackendConfig | null; // For ephemeral oxigraph backends
  inputs?: string[] | null; // References to IO entities
  outputs?: string[] | null; // References to individual QueryOutput entities
  dateCreated?: string | null; // ISO string format for RDF/JSON-LD compatibility
  dateModified?: string | null; // ISO string format for RDF/JSON-LD compatibility
  nodeType?: string; // Explicit node type field for REST API discrimination
}
