import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { expandRuleSetVersion } from '../../src/lib/RuleSetVersionResolver.js';
import type { LdkitRuleSetVersion } from '../../src/persistence/schemas/RuleSetVersionSchema.js';
import { installFakePersistenceAdapter } from '../support/fakePersistenceAdapter.js';

describe('RuleSetVersionResolver', () => {
  let store: Awaited<ReturnType<typeof installFakePersistenceAdapter>>;

  beforeEach(async () => {
    // Stored with the flags as strings, which is how a literal can come back.
    store = await installFakePersistenceAdapter([
      {
        type: 'RuleVersion',
        entity: {
          $id: 'urn:sqlib:rule-version:1',
          '@type': 'RuleVersion',
          isPartOf: 'urn:rule:1',
          version: 1,
          ruleString: 'RULE {} WHERE {}',
          immutable: 'false',
        },
      },
      {
        type: 'DataBlockVersion',
        entity: {
          $id: 'urn:sqlib:data-block-version:1',
          '@type': 'DataBlockVersion',
          isPartOf: 'urn:db:1',
          version: 1,
          dataString: 'DATA {}',
          immutable: 'true',
        },
      },
    ]);
  });

  afterEach(() => store.restore());

  it('coerces immutable flags on rule set version and nested entities to booleans', async () => {
    const version = {
      $id: 'urn:sqlib:ruleset-version:1',
      '@type': 'RuleSetVersion',
      isPartOf: 'urn:sqlib:ruleset:1',
      version: 1,
      immutable: 'false',
      hasRule: ['urn:sqlib:rule-version:1'],
      hasDataBlock: ['urn:sqlib:data-block-version:1'],
    } as unknown as LdkitRuleSetVersion;

    const expanded = await expandRuleSetVersion(version);

    expect(expanded.ruleSetVersion.immutable).toBe(false);
    expect(expanded.rules[0].ruleVersion.immutable).toBe(false);
    expect(expanded.dataBlocks[0].dataBlockVersion.immutable).toBe(true);
  });
});
