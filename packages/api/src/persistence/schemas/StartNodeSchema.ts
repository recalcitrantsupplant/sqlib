/**
 * LDKit Schema for StartNode Entity
 * 
 * StartNode represents the entry point for query execution in a canvas.
 * It provides external input interface for the QueryGroup and passes inputs through to other nodes.
 * Like a QueryNode but with no processing - just parameter pass-through.
 */

import type { Schema } from '../schema.js';
import { ldkit, xsd, sqlib, sdo } from '../namespaces.js';

export const StartNodeSchema = {
  '@type': sqlib.StartNode,
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
} as const satisfies Schema;

export interface LdkitStartNode {
  '$id': string;
  '@type'?: 'StartNode';
  outputs?: string[] | null; // External outputs that become the query group's external inputs - any output entities (QueryOutputTuple, TriplesQuadsIO, etc.)
  dateCreated?: string | null; // ISO string format for RDF/JSON-LD compatibility
  dateModified?: string | null; // ISO string format for RDF/JSON-LD compatibility
}
