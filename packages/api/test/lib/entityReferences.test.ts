/**
 * Reading `@references` back out, and the two things that used to restate it.
 *
 * The parity block matters more than the unit tests around it: the reference
 * rules were hand-written, so the case for deriving them rests on the derived
 * table being the same table. It is asserted here against a literal copy of
 * what `groupVersionReferences.ts` declared before Phase B3, rather than left
 * to a reviewer's eye.
 */
import { describe, expect, it } from 'vitest';
import {
  analyseReferences,
  describeWrongType,
  referencesFor,
  referenceTypesOf,
  requireReferences,
} from '../../src/lib/entityReferences.js';
import { NODE_REFERENCE_RULES } from '../../src/lib/groupVersionReferences.js';

/**
 * What `groupVersionReferences.ts` declared by hand before the model carried it.
 *
 * One key differs from the original: `RuleSetNode.ruleSetVersionId` is now
 * `ruleSetVersion`. That is the rename, not a derivation error — the wire field
 * was the only place in the system that spelled it with the `Id` suffix, and it
 * now matches the property, the predicate and every read response. The old
 * spelling is still accepted on the wire; it is no longer a *rule* key.
 */
const HAND_WRITTEN_NODE_RULES = {
  QueryNode: {
    queryId: { category: 'external', allowedTypes: ['QueryVersion'] },
    backendId: { category: 'external', allowedTypes: ['Backend'] },
  },
  DynamicQueryNode: {
    backendId: { category: 'external', allowedTypes: ['Backend'] },
  },
  RuleSetNode: {
    ruleSetVersion: { category: 'external', allowedTypes: ['RuleSetVersion'] },
  },
  PatchNode: {
    queryId: { category: 'external', allowedTypes: ['QueryVersion'] },
    backendId: { category: 'external', allowedTypes: ['Backend'] },
  },
};

describe('reading a property’s reference declaration', () => {
  it('reports the declared targets', () => {
    expect(referenceTypesOf('QueryNode', 'queryId')).toEqual(['QueryVersion']);
    expect(referenceTypesOf('RuleSetNode', 'ruleSetVersion')).toEqual(['RuleSetVersion']);
    expect(requireReferences('Query', 'isPartOf')).toEqual({
      types: ['Library', 'QueryGroup'],
      exactlyOne: 'Library',
    });
  });

  it('reports null where the model has no opinion', () => {
    // `defaultBackend` is an IRI the model does not constrain. This used to be
    // `currentVersion`, until it gained a declaration so a projection could
    // read the version's number through it — the example has to be a property
    // that is genuinely undeclared, not one that happens to be.
    expect(referencesFor('Query', 'defaultBackend')).toBeNull();
  });

  it('throws rather than passing everything when a rule reads an undeclared property', () => {
    expect(() => requireReferences('Query', 'defaultBackend')).toThrow(/no "@references"/);
  });
});

describe('checking a payload against the declaration', () => {
  const library = { '@type': 'Library' };
  const group = { '@type': 'QueryGroup' };
  const backend = { '@type': 'Backend' };
  const store: Record<string, { '@type': string }> = {
    'urn:lib:1': library,
    'urn:lib:2': library,
    'urn:group:1': group,
    'urn:backend:1': backend,
  };
  const lookup = (iri: string) => store[iri] ?? null;

  it('counts the exactlyOne type across the values', () => {
    const findings = analyseReferences('Query', 'isPartOf', ['urn:lib:1', 'urn:group:1'], lookup);

    expect(findings).toEqual({ missing: [], wrongType: [], exactlyOneCount: 1 });
  });

  it('counts a second library rather than stopping at the first', () => {
    const findings = analyseReferences('Query', 'isPartOf', ['urn:lib:1', 'urn:lib:2'], lookup);

    expect(findings.exactlyOneCount).toBe(2);
  });

  it('accumulates every unresolvable reference', () => {
    const findings = analyseReferences(
      'Query',
      'isPartOf',
      ['urn:lib:1', 'urn:missing:1', 'urn:missing:2'],
      lookup,
    );

    expect(findings.missing).toEqual(['urn:missing:1', 'urn:missing:2']);
    expect(findings.exactlyOneCount).toBe(1);
  });

  it('reports a reference that resolves to a type the property does not permit', () => {
    const findings = analyseReferences('Query', 'isPartOf', ['urn:lib:1', 'urn:backend:1'], lookup);

    expect(findings.wrongType).toEqual([
      { reference: 'urn:backend:1', type: 'Backend', allowed: ['Library', 'QueryGroup'] },
    ]);
    expect(describeWrongType(findings.wrongType[0])).toBe(
      'Referenced entity urn:backend:1 is a Backend, expected Library or QueryGroup',
    );
  });

  it('leaves exactlyOneCount null for a property that declares none', () => {
    const findings = analyseReferences('QueryNode', 'backendId', ['urn:backend:1'], lookup);

    expect(findings.exactlyOneCount).toBeNull();
  });
});

describe('the derived node reference rules', () => {
  it('match the table that was written out by hand', () => {
    expect(NODE_REFERENCE_RULES).toEqual(HAND_WRITTEN_NODE_RULES);
  });

  it('key every node field on the property that stores it', () => {
    // The rename's actual invariant: no rule may name a field the entity does
    // not have. `requireReferences` throws on one that does, so building the
    // table at all is the assertion — this states why it is one.
    for (const [nodeType, fields] of Object.entries(NODE_REFERENCE_RULES)) {
      for (const field of Object.keys(fields)) {
        expect(() => requireReferences(nodeType as 'QueryNode', field)).not.toThrow();
      }
    }
  });
});
