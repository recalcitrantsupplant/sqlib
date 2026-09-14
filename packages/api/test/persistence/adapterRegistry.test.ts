import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getPersistenceAdapter, setPersistenceAdapter } from '../../src/persistence/adapterRegistry.js';
import { selfHostedAdapter } from '../../src/persistence/SelfHostedAdapter.js';
import type { PersistenceAdapter } from '../../src/persistence/PersistenceAdapter.js';

/**
 * The registry used to pick between `LdkitAdapter` and `SelfHostedAdapter` per
 * operation class, driven by four feature flags, so each migration phase could
 * ship dark. LDKit is gone and so are the flags; what is left to pin down is that
 * the self-hosted adapter is the default and that a test can substitute a stub.
 */
describe('persistence adapter registry', () => {
  beforeEach(() => setPersistenceAdapter(null));
  afterEach(() => setPersistenceAdapter(null));

  it('resolves to the self-hosted adapter by default', () => {
    expect(getPersistenceAdapter()).toBe(selfHostedAdapter);
  });

  it('resolves to a registered stub', () => {
    const stub = {} as PersistenceAdapter;
    setPersistenceAdapter(stub);

    expect(getPersistenceAdapter()).toBe(stub);
  });

  it('reverts to the real adapter when the stub is cleared', () => {
    setPersistenceAdapter({} as PersistenceAdapter);
    setPersistenceAdapter(null);

    expect(getPersistenceAdapter()).toBe(selfHostedAdapter);
  });
});
