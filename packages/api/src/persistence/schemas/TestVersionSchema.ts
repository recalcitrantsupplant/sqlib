/**
 * LDKit Schema for TestVersion entity (immutable version)
 *
 * The invocation inputs and the expectation, versioned together because they
 * only mean anything together: an expectation is an expectation *given* those
 * inputs.
 *
 * **Hermetic vs integration falls out of the inputs.** `dataGraphVersion` set
 * means the subject runs against an ephemeral store seeded from that graph —
 * deterministic and CI-runnable. `backend` set means it runs against a live
 * endpoint — still valuable, environment-dependent, and marked as such by
 * nothing more than the presence of the field. There is no separate flag to
 * keep in step with reality.
 *
 * **The inputs and the expectation live on the cases, not here.** Changing the
 * arguments changes what is correct, so an expectation only means something
 * beside the inputs it was written against — which is what a `TestCase` pairs.
 * One case is an ordinary test; N cases is `@pytest.mark.parametrize`.
 *
 * **The expectation is typed by the subject's ResultKind, not by its entity
 * type.** A CONSTRUCT query and a rule set both produce a graph and are
 * compared the same way; a SELECT query and a query group that ends in one
 * both produce bindings. `expectationKind` records which comparator runs, and
 * `expected` carries its payload as text — a solution multiset as JSON for
 * bindings, `true`/`false` for boolean, RDF for graph. A null `expected` with
 * kind `smoke` is a smoke test: runs, converges, does not error.
 */

import type { Schema } from '../schema.js';
import { ldkit, xsd, sqlib, sdo } from '../namespaces.js';

export const TestVersionSchema = {
  '@type': sqlib.TestVersion,
  isPartOf: {
    '@id': sdo.isPartOf,
    '@type': ldkit.IRI,
    '@references': { types: ['Test'] },
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
  /**
   * Pin the subject to one of its versions, or leave unset to resolve the
   * subject's current version at run time. Both are legitimate: a regression
   * test wants "whatever it is now", a conformance test wants the version it
   * was written against.
   */
  subjectVersion: {
    '@id': sqlib.subjectVersion,
    '@type': ldkit.IRI,
    '@optional': true,
  },
  /**
   * The parametrised cases, in `position` order.
   *
   * A test with one case is the ordinary single test; N cases is
   * `@pytest.mark.parametrize`. The inputs and the expectation live on the case
   * because changing the arguments changes what is correct — see `TestCaseSchema`.
   */
  cases: {
    '@id': sqlib.cases,
    '@array': true,
    '@type': ldkit.IRI,
    '@optional': true,
    '@references': { types: ['TestCase'] },
  },
  backend: {
    '@id': sqlib.refBackend,
    '@type': ldkit.IRI,
    '@optional': true,
    '@references': { types: ['Backend'] },
  },
  /** `bindings` | `boolean` | `graph` | `smoke`. */
  expectationKind: {
    '@id': sqlib.expectationKind,
  },
  maxIterations: {
    '@id': sqlib.maxIterations,
    '@type': xsd.integer,
    '@optional': true,
  },
  timeoutMs: {
    '@id': sqlib.timeoutMs,
    '@type': xsd.integer,
    '@optional': true,
  },
  comment: {
    '@id': sdo.comment,
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

export interface LdkitTestVersion {
  $id: string;
  '@type'?: 'TestVersion';
  isPartOf: string;
  version: number;
  immutable?: boolean | null;
  subjectVersion?: string | null;
  cases?: string[] | null;
  backend?: string | null;
  expectationKind: string;
  maxIterations?: number | null;
  timeoutMs?: number | null;
  comment?: string | null;
  dateCreated?: string | null;
  dateModified?: string | null;
}
