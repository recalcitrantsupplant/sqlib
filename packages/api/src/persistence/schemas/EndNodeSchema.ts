/**
 * LDKit Schema for EndNode Entity
 * 
 * EndNode represents the final output destination in a query canvas.
 * It can specify the desired media type for the final output format.
 */

import type { Schema } from '../schema.js';
import { ldkit, xsd, sqlib, sdo } from '../namespaces.js';
import { OutputMediaType, OUTPUT_MEDIA_TYPE_VALUES } from '../../types/media-types.js';

export const EndNodeSchema = {
  '@type': sqlib.EndNode,
  inputs: {
    '@id': sqlib.inputs,
    '@array': true,
    '@type': ldkit.IRI,
    '@optional': true,
  },
  mediaType: {
    '@id': sqlib.mediaType,
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

export interface LdkitEndNode {
  '$id': string;
  '@type'?: 'EndNode';
  inputs?: string[] | null; // Generic I/O references (QueryOutputTuple, TriplesQuadsIO, BooleanIO, etc.)
  mediaType?: OutputMediaType | null; // One of OUTPUT_MEDIA_TYPE_VALUES
  dateCreated?: string | null; // ISO string format for RDF/JSON-LD compatibility
  dateModified?: string | null; // ISO string format for RDF/JSON-LD compatibility
}

// Schema validation helper for mediaType
export function isValidMediaType(mediaType: string): boolean {
  return (OUTPUT_MEDIA_TYPE_VALUES as readonly string[]).includes(mediaType);
}
