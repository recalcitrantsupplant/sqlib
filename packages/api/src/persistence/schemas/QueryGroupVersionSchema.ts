/**
 * LDKit Schema for QueryGroupVersion Entity (Immutable Version)
 * 
 * Represents an immutable version of a query group. Each version has a stable
 * parent QueryGroup and contains snapshots of nodes, edges, and canvas data.
 * Previously the main QueryGroup schema.
 */

import type { Schema } from '../schema.js';
import type { ToolObject as PublishedToolObject } from '@sparql-query-lib/tools';
import { ldkit, rdf, xsd, sqlib, sdo } from '../namespaces.js';

export const QueryGroupVersionSchema = {
  '@type': sqlib.QueryGroupVersion,
  version: {
    '@id': sdo.version,
    '@type': xsd.integer,
  },
  immutable: {
    '@id': sqlib.isImmutable,
    '@type': xsd.boolean,
    '@optional': true,
  },
  startNode: {
    '@id': sqlib.startNode,
    '@type': ldkit.IRI,
    '@optional': true,
  },
  endNode: {
    '@id': sqlib.endNode,
    '@type': ldkit.IRI,
    '@optional': true,
  },
  executionNodes: {
    '@id': sqlib.executionNodes,
    '@array': true,
    '@type': ldkit.IRI,
    '@optional': true,
  },
  edges: {
    '@id': sqlib.edges,
    '@array': true,
    '@type': ldkit.IRI,
    '@optional': true,
  },
  canvasData: {
    '@id': sqlib.canvasData,
    '@optional': true,
  },
  comment: {
    '@id': sdo.comment,
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
  isPartOf: {
    '@id': sdo.isPartOf,
    '@type': ldkit.IRI,
    '@references': { types: ['QueryGroup'] },
  },
  /**
   * The tool this version publishes as (`docs/guides/publishing-tools.md`),
   * or `false` to leave it out of a `publishAll` library. On the version, not
   * the entity, because its `params` name this version's inputs: it is checked
   * against them once, when the version is saved, and a save that sends no
   * `tool` copies the previous version's.
   */
  tool: {
    '@id': sqlib.tool,
    '@type': rdf.JSON,
    '@jsonShape': 'PublishedTool',
    '@optional': true,
  },
} as const satisfies Schema;

export interface LdkitQueryGroupVersion {
  $id: string;
  '@type'?: 'QueryGroupVersion';
  version: number; // 1, 2, 3... (API/UI-friendly numeric version)
  immutable?: boolean | null;
  startNode?: string | null; // Reference to single StartNode IRI
  endNode?: string | null; // Reference to single EndNode IRI
  executionNodes?: string[] | null; // Snapshot of intermediate node IRIs (QueryNode, DynamicQueryNode) - excludes start/end nodes
  edges?: string[] | null; // Snapshot of QueryEdge IRIs
  canvasData?: string | null; // Vue Flow serialized canvas state snapshot
  comment?: string | null; // Optional free-form notes (sdo:comment)
  dateCreated?: string | null; // ISO string format for RDF/JSON-LD compatibility
  dateModified?: string | null; // ISO string for optimistic concurrency control
  isPartOf: string; // IRI back to stable QueryGroup (required)
  // Multiplicity: A QueryGroupVersion belongs to exactly one QueryGroup
  tool?: PublishedToolObject | false | null;
}
