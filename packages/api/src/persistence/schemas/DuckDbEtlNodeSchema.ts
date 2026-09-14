/**
 * LDKit Schema for DuckDbEtlNode Entity
 *
 * This entity represents DuckDB ETL nodes in a query execution graph.
 */

import type { Schema } from '../schema.js';
import { ldkit, sqlib } from '../namespaces.js';

export const DuckDbEtlNodeSchema = {
  '@type': sqlib.DuckDbEtlNode,
  etlJobVersionId: {
    '@id': sqlib.etlJobVersionId,
    '@type': ldkit.IRI,
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
  nodeType: {
    '@id': sqlib.nodeType,
    '@optional': true,
  },
} as const satisfies Schema;

export interface LdkitDuckDbEtlNode {
  '$id': string;
  '@type'?: 'DuckDbEtlNode';
  etlJobVersionId: string; // Required - reference to EtlJobVersion
  inputs?: string[] | null; // Array of IRIs referencing input entities
  outputs?: string[] | null; // Array of IRIs referencing output entities (QueryOutputTuple)
  nodeType?: string; // Explicit node type field for REST API discrimination
}
