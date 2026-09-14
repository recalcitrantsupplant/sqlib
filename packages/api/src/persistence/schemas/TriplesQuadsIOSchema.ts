/**
 * LDKit Schema for TriplesQuadsIO Entity
 *
 * Represents RDF graph input/output for CONSTRUCT and DESCRIBE queries.
 * Can specify whether data is triples or quads, input or output direction,
 * and target graph for explicit graph assignment.
 */

import type { Schema } from '../schema.js';
import { ldkit, xsd, sqlib, sdo } from '../namespaces.js';

export const TriplesQuadsIOSchema = {
  '@type': sqlib.TriplesQuadsIO,
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
  triplesOrQuads: {
    '@id': sqlib.triplesOrQuads,
    '@optional': true,
  },
  /**
   * The graph a quad is placed in — a term in the data, and deliberately not
   * the IRI of the `DataGraph` a run supplies. The two share a word and
   * nothing else; see `2026-09-07-payload-and-routing.md` §6.
   */
  specifiedGraph: {
    '@id': sqlib.specifiedGraph,
    '@type': ldkit.IRI,
    '@optional': true,
  },
  /**
   * Declaration ordinal, set only on a query group's start-node graph ports.
   * The routing key a supplied graph's `position` pairs against, for the same
   * reason `QueryInputTuple.position` exists.
   */
  position: {
    '@id': sqlib.position,
    '@type': xsd.integer,
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

export interface LdkitTriplesQuadsIO {
  $id: string;
  '@type'?: 'TriplesQuadsIO';
  name?: string | null; // Optional descriptive name
  description?: string | null;
  ioType?: 'input' | 'output' | null; // Direction of data flow
  outputType?: 'outputTuple' | 'RDFGraph' | 'Boolean' | null; // Type of output data
  triplesOrQuads?: 'triples' | 'quads' | null; // Data format
  specifiedGraph?: string | null; // The graph term quads are placed in — not a DataGraph IRI
  position?: number | null; // Start-node graph ports only: declaration ordinal
  dateCreated?: string | null; // ISO string format for RDF/JSON-LD compatibility
  dateModified?: string | null; // ISO string format for RDF/JSON-LD compatibility
}