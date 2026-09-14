import { describe, it, expect, vi } from 'vitest';
import { expandRuleSetVersion } from '../../src/lib/RuleSetVersionResolver.js';
import type { LdkitRuleSetVersion } from '../../src/persistence/schemas/RuleSetVersionSchema.js';
import type { LdkitRuleVersion } from '../../src/persistence/schemas/RuleVersionSchema.js';
import type { LdkitDataBlockVersion } from '../../src/persistence/schemas/DataBlockVersionSchema.js';

const hoisted = vi.hoisted(() => ({
  mockGet: vi.fn(),
}));

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => ({
    get: hoisted.mockGet,
  }),
}));

vi.mock('../../src/persistence/utils/RuleVersionUtils.js', () => ({
  loadRuleVersionsByIds: vi.fn(async (ids: string[]) => ids.map(id => ({
    $id: id,
    '@type': 'RuleVersion',
    isPartOf: 'urn:rule:1',
    version: 1,
    ruleString: 'RULE {} WHERE {}',
    immutable: 'false',
  } as unknown as LdkitRuleVersion))),
  findRuleVersionById: vi.fn(),
}));

vi.mock('../../src/persistence/utils/DataBlockVersionUtils.js', () => ({
  loadDataBlockVersionsByIds: vi.fn(async (ids: string[]) => ids.map(id => ({
    $id: id,
    '@type': 'DataBlockVersion',
    isPartOf: 'urn:db:1',
    version: 1,
    dataString: 'DATA {}',
    immutable: 'true',
  } as unknown as LdkitDataBlockVersion))),
  findDataBlockVersionById: vi.fn(),
}));

vi.mock('../../src/persistence/utils/RuleUtils.js', () => ({
  findRuleById: vi.fn(async (_id: string) => null),
}));

vi.mock('../../src/persistence/utils/DataBlockUtils.js', () => ({
  findDataBlockById: vi.fn(async (_id: string) => null),
}));

describe('RuleSetVersionResolver', () => {
  it('coerces immutable flags on rule set version and nested entities to booleans', async () => {
    const version: LdkitRuleSetVersion = {
      $id: 'urn:sqlib:ruleset-version:1',
      '@type': 'RuleSetVersion',
      isPartOf: 'urn:sqlib:ruleset:1',
      version: 1,
      immutable: 'false' as any,
      hasRule: ['urn:sqlib:rule-version:1'],
      hasDataBlock: ['urn:sqlib:data-block-version:1'],
    };

    const expanded = await expandRuleSetVersion(version);

    expect(expanded.ruleSetVersion.immutable).toBe(false);
    expect(expanded.rules[0].ruleVersion.immutable).toBe(false);
    expect(expanded.dataBlocks[0].dataBlockVersion.immutable).toBe(true);
  });
});
