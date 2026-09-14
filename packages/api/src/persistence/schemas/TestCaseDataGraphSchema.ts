/**
 * Schema for the TestCaseDataGraph entity.
 *
 * One RDF input a case supplies, and which of the group's declared inputs it
 * fills.
 *
 * A `TestCase` could name only one `dataGraphVersion`, so a query group with
 * several RDF inputs could not be covered by a Test at all — the run failed
 * with "the query group's start node declares data graph input …, which this
 * run did not supply" (issue #298). The execution engine was never the limit;
 * only the *test* entity could not say more than one.
 *
 * A child entity rather than an array on the case, for the same reason
 * `TupleMember` is one: RDF carries no order, and which graph fills which
 * start-node port is decided by position — a case says what it supplies and in
 * what order, and the group routes it. `position` is what makes "shapes first,
 * then data" a fact of the stored case rather than of the order a SPARQL result
 * happened to come back in.
 */

import type { Schema } from '../schema.js';
import { ldkit, xsd, sqlib, sdo } from '../namespaces.js';

export const TestCaseDataGraphSchema = {
  '@type': sqlib.TestCaseDataGraph,
  isPartOf: {
    '@id': sdo.isPartOf,
    '@type': ldkit.IRI,
    '@references': { types: ['TestCase'] },
  },
  /** 0-based, because RDF arrays carry no order. Same reason as `TupleMember`. */
  position: {
    '@id': sqlib.position,
    '@type': xsd.integer,
  },
  dataGraphVersion: {
    '@id': sqlib.dataGraphVersion,
    '@type': ldkit.IRI,
    '@references': { types: ['DataGraphVersion'] },
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

export interface LdkitTestCaseDataGraph {
  $id: string;
  '@type'?: 'TestCaseDataGraph';
  isPartOf: string;
  position: number;
  dataGraphVersion: string;
  dateCreated?: string | null;
  dateModified?: string | null;
}
