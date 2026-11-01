/**
 * Entity schema for RuleSetNode Entity
 *
 * Represents a query group execution node that runs a RuleSetVersion
 * against an ephemeral Oxigraph store. The node only accepts/produces
 * TriplesQuads IO entities (RDF graphs).
 */

import type { Schema } from '../schema.js';
import { sqlib } from '../namespaces.js';

export const RuleSetNodeSchema = {
  '@type': sqlib.RuleSetNode,
  ruleSetVersion: {
    '@id': sqlib.ruleSetVersion,
    '@type': sqlib.IRI,
    '@references': { types: ['RuleSetVersion'] },
  },
  inputs: {
    '@id': sqlib.inputs,
    '@array': true,
    '@type': sqlib.IRI,
    '@optional': true,
  },
  outputs: {
    '@id': sqlib.outputs,
    '@array': true,
    '@type': sqlib.IRI,
    '@optional': true,
  },
  nodeType: {
    '@id': sqlib.nodeType,
    '@optional': true,
  },
} as const satisfies Schema;

export interface PersistedRuleSetNode {
  '$id': string;
  '@type'?: 'RuleSetNode';
  ruleSetVersion: string;
  inputs?: string[] | null;
  outputs?: string[] | null;
  nodeType?: string | null;
}
