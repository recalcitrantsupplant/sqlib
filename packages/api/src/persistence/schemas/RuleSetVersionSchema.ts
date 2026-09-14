/**
 * LDKit Schema for RuleSetVersion entity.
 *
 * Represents an immutable snapshot of a ruleset.
 *
 * IMPORTANT: hasRule and hasDataBlock MUST contain Version IDs (RuleVersion and DataBlockVersion),
 * NOT parent entity IDs (Rule and DataBlock). This ensures immutable, reproducible execution.
 * When a parent entity's currentVersion is updated, RuleSets don't automatically change behavior.
 */

import type { Schema } from '../schema.js';
import { ldkit, xsd, sqlib, sdo } from '../namespaces.js';

export const RuleSetVersionSchema = {
  '@type': sqlib.RuleSetVersion,
  isPartOf: {
    '@id': sdo.isPartOf,
    '@type': ldkit.IRI,
    '@references': { types: ['RuleSet'] },
  },
  version: {
    '@id': sdo.version,
    '@type': xsd.integer,
  },
  immutable: {
    '@id': sqlib.isImmutable,
    '@type': xsd.boolean,
    '@optional': true,
  },
  comment: {
    '@id': sdo.comment,
    '@optional': true,
  },
  hasRule: {
    '@id': sqlib.hasRule,
    '@type': ldkit.IRI,
    '@array': true,
    '@optional': true,
  },
  hasDataBlock: {
    '@id': sqlib.hasDataBlock,
    '@type': ldkit.IRI,
    '@array': true,
    '@optional': true,
  },
  stratificationReport: {
    '@id': sqlib.stratificationReport,
    '@type': xsd.string,
    '@optional': true,
  },
  /**
   * The ruleset's initial named tuples, as an SRL tuple-seed document
   * (`TUPLE( … )` rows). Stored as text rather than as DataBlocks on purpose:
   * a data block compiles to `INSERT DATA` against the RDF store, which is
   * precisely what a tuple must never do — tuples are ephemeral and never enter
   * the inference graph.
   */
  tupleSeeds: {
    '@id': sqlib.tupleSeeds,
    '@type': xsd.string,
    '@optional': true,
  },
  /**
   * Whether this version opts into the rule-tuples extension
   * (w3c/data-shapes#752). Off means the document is conformant SRL and a
   * `TUPLE( … )` anywhere in it is a syntax error.
   */
  tuplesEnabled: {
    '@id': sqlib.tuplesEnabled,
    '@type': xsd.boolean,
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

export interface LdkitRuleSetVersion {
  $id: string;
  '@type'?: 'RuleSetVersion';
  isPartOf: string;
  version: number;
  immutable?: boolean | null;
  comment?: string | null;
  hasRule?: string[] | null;
  hasDataBlock?: string[] | null;
  stratificationReport?: string | null;
  tupleSeeds?: string | null;
  tuplesEnabled?: boolean | null;
  dateCreated?: string | null;
  dateModified?: string | null;
}
