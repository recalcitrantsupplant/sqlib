/**
 * LDKit Schema for QueryIdInput Entity
 *
 * QueryIdInput represents a queryId input slot on a DynamicQueryNode.
 * This enables dynamic query selection where a previous query outputs
 * a query IRI that determines which query the DynamicQueryNode executes.
 */

import type { Schema } from '../schema.js';
import { ldkit, xsd, sqlib, sdo } from '../namespaces.js';

export const QueryIdInputSchema = {
  '@type': sqlib.QueryIdInput,
  name: {
    '@id': sdo.name,
    '@optional': true,
  },
  description: {
    '@id': sdo.description,
    '@optional': true,
  },
  isPartOf: {
    '@id': sdo.isPartOf,
    '@type': ldkit.IRI,
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
} as const satisfies Schema;

export interface LdkitQueryIdInput {
  $id: string;
  '@type'?: 'QueryIdInput';
  name?: string | null;        // e.g., "dynamicQuery"
  description?: string | null; // e.g., "Runtime-selected query to execute"
  isPartOf: string;            // IRI of the DynamicQueryNode
  dateCreated?: string | null; // ISO string format for RDF/JSON-LD compatibility
  dateModified?: string | null; // ISO string format for RDF/JSON-LD compatibility
}
