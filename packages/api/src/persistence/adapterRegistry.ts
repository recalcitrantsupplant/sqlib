/**
 * Resolves the persistence adapter.
 *
 * There used to be two — `LdkitAdapter` and `SelfHostedAdapter` — chosen per
 * operation class by four feature flags, so each migration phase could ship dark
 * (plan §2). The migration is done: the self-hosted adapter is in store-state
 * parity with LDKit across every entity type on both internal backend modes, so
 * it is simply the persistence layer now and the flags are gone.
 *
 * The indirection stays for one reason: tests substitute a stub adapter through
 * `setPersistenceAdapter`.
 */
import { selfHostedAdapter } from './SelfHostedAdapter.js';
import type { PersistenceAdapter } from './PersistenceAdapter.js';

let registered: PersistenceAdapter = selfHostedAdapter;

/** Overridable so tests can substitute a stub; resets to the real adapter on null. */
export function setPersistenceAdapter(adapter: PersistenceAdapter | null): void {
  registered = adapter ?? selfHostedAdapter;
}

export function getPersistenceAdapter(): PersistenceAdapter {
  return registered;
}
