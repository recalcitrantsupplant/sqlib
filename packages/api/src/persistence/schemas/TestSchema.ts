/**
 * LDKit Schema for Test Entity (stable pointer)
 *
 * A test is an invocation spec plus an expectation, run once, judged pass or
 * fail. The invocation half is the same shape benchmarks already discovered
 * (`BenchmarkSubjectSpec` — a callable plus its inputs); the expectation is
 * what makes it a test rather than a measurement. Tests are therefore a
 * general library feature, not an SRL one: a test of a query (arguments in,
 * bindings out) is the same shape as a test of a rule set (data graph in,
 * inference graph out). See `docs/guides/testing-and-conformance.md`.
 *
 * The subject lives here rather than on the version, following `ArgumentSet`'s
 * `targetEntity`: the Tests tab on a record page filters by subject, and that
 * listing should not have to open every version to do it. The *inputs* and the
 * *expectation* are what versioning is for, and they live on the version.
 *
 * The reference points at the subject, so the subject stays uncoupled — a
 * RuleSet does not know it is tested, exactly as a RuleSet does not know it is
 * benchmarked.
 */

import type { Schema } from '../schema.js';
import { ldkit, xsd, sqlib, sdo } from '../namespaces.js';

export const TestSchema = {
  '@type': sqlib.Test,
  name: {
    '@id': sdo.name,
  },
  description: {
    '@id': sdo.description,
    '@optional': true,
  },
  subject: {
    '@id': sqlib.subject,
    '@type': ldkit.IRI,
    '@references': { types: ['Query', 'QueryGroup', 'RuleSet'] },
  },
  /**
   * The external criterion this test implements, if it implements one.
   *
   * A W3C manifest entry IRI, for the tests the rules suite seeds
   * (`lib/w3cRulesSuite/seed.ts`). It is deliberately *not* our `$id`: our id is
   * library content — a test can be renamed, re-versioned, seeded twice into
   * two libraries — while the criterion is the fixed thing upstream and this
   * test both refer to, and it is what a conformance report has to cite for a
   * reviewer to look the entry up. Not `@references`d, because the whole point
   * is that it resolves somewhere we do not host.
   */
  criterion: {
    '@id': sqlib.criterion,
    '@type': ldkit.IRI,
    '@optional': true,
  },
  /** `query` | `queryGroup` | `ruleSet`. The EtlJob slot is reserved, not filled. */
  subjectKind: {
    '@id': sqlib.subjectKind,
  },
  currentVersion: {
    '@id': sqlib.currentVersion,
    '@type': ldkit.IRI,
    '@optional': true,
    '@references': { types: ['TestVersion'] },
    // The number lives on the version; callers listing these want it
    // beside the entity. See `Property['@projects']`.
    '@projects': { as: 'currentVersionNumber', property: 'version' },
  },
  isPartOf: {
    '@id': sdo.isPartOf,
    '@array': true,
    '@type': ldkit.IRI,
    '@references': { types: ['Library'], exactlyOne: 'Library' },
  },
  tags: {
    '@id': sqlib.hasTag,
    '@array': true,
    '@type': ldkit.IRI,
    '@optional': true,
    '@references': { types: ['Tag'] },
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

export interface LdkitTest {
  $id: string;
  '@type'?: 'Test';
  name: string;
  description?: string | null;
  subject: string;
  criterion?: string | null;
  subjectKind: string;
  currentVersion?: string | null;
  isPartOf: string[];
  tags?: string[] | null;
  dateCreated?: string | null;
  dateModified?: string | null;
}
