/**
 * Entity schema for DuckDbEtlNode Entity
 *
 * This entity represents DuckDB ETL nodes in a query execution graph.
 */

import type { Schema } from '../schema.js';
import { sqlib } from '../namespaces.js';

export const DuckDbEtlNodeSchema = {
  '@type': sqlib.DuckDbEtlNode,
  etlJobVersionId: {
    '@id': sqlib.etlJobVersionId,
    '@type': sqlib.IRI,
  },
  inputs: {
    '@id': sqlib.inputs,
    '@array': true,
    '@type': sqlib.IRI,
    '@optional': true,
  },
  outputs: {
    '@id': sqlib.outputs,
    '@array': true,
    '@type': sqlib.IRI,
    '@optional': true,
  },
  nodeType: {
    '@id': sqlib.nodeType,
    '@optional': true,
  },
} as const satisfies Schema;

export interface PersistedDuckDbEtlNode {
  '$id': string;
  '@type'?: 'DuckDbEtlNode';
  etlJobVersionId: string; // Required - reference to EtlJobVersion
  inputs?: string[] | null; // Array of IRIs referencing input entities
  outputs?: string[] | null; // Array of IRIs referencing output entities (QueryOutputTuple)
  nodeType?: string; // Explicit node type field for REST API discrimination
}
