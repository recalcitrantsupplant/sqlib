/**
 * LDKit Schema for BooleanIO Entity
 *
 * Represents boolean input/output for ASK queries.
 * ASK queries return a single boolean value indicating whether
 * the query pattern has any matches in the dataset.
 */

import type { Schema } from '../schema.js';
import { ldkit, xsd, sqlib, sdo } from '../namespaces.js';

export const BooleanIOSchema = {
  '@type': sqlib.BooleanIO,
  name: {
    '@id': sdo.name,
    '@optional': true,
  },
  description: {
    '@id': sdo.description,
    '@optional': true,
  },
  ioType: {
    '@id': sqlib.ioType,
    '@optional': true,
  },
  outputType: {
    '@id': sqlib.outputType,
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

export interface LdkitBooleanIO {
  $id: string;
  '@type'?: 'BooleanIO';
  name?: string | null; // Optional descriptive name
  description?: string | null;
  ioType?: 'input' | 'output' | null; // Direction of data flow
  outputType?: 'outputTuple' | 'RDFGraph' | 'Boolean' | null; // Type of output data
  dateCreated?: string | null; // ISO string format for RDF/JSON-LD compatibility
  dateModified?: string | null; // ISO string format for RDF/JSON-LD compatibility
}