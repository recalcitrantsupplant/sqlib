/**
 * Schema for the BrowserDefaultDataGraph entity.
 *
 * The data graph the web app selects for one input when a rule set or a query
 * group opens. A **browser default**: the web app applies it, and `/execute`,
 * rule set execute, tests, benchmarks and MCP never read it. See
 * `docs/proposals/browser-defaults.md`.
 *
 * A child entity rather than an array of IRIs on the owner, for the reason
 * `TestCaseDataGraph` is one: RDF carries no order, and a query group routes
 * graphs to its start-node inputs by position. A rule set takes one graph, so
 * its only child sits at position 0.
 */

import type { Schema } from '../schema.js';
import { ldkit, xsd, sqlib, sdo } from '../namespaces.js';

export const BrowserDefaultDataGraphSchema = {
  '@type': sqlib.BrowserDefaultDataGraph,
  isPartOf: {
    '@id': sdo.isPartOf,
    '@type': ldkit.IRI,
    '@references': { types: ['QueryGroup', 'RuleSet'] },
  },
  /** 0-based: the data graph input this default fills. */
  position: {
    '@id': sqlib.position,
    '@type': xsd.integer,
  },
  /** A `DataGraph` floats to its current version; a `DataGraphVersion` is a pin. */
  dataGraph: {
    '@id': sqlib.dataGraph,
    '@type': ldkit.IRI,
    '@references': { types: ['DataGraph', 'DataGraphVersion'] },
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

export interface LdkitBrowserDefaultDataGraph {
  $id: string;
  '@type'?: 'BrowserDefaultDataGraph';
  isPartOf: string;
  position: number;
  dataGraph: string;
  dateCreated?: string | null;
  dateModified?: string | null;
}
