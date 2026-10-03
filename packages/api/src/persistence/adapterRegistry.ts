/**
 * Resolves the persistence adapter.
 *
 * There used to be two — `AdapterEntity` and `SelfHostedAdapter` — chosen per
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

// Null means "the real one", resolved per call rather than copied at load: this
// module sits on an import cycle (`EntityStore` -> `ExecutorFactory` -> the
// cache -> here -> `SelfHostedAdapter` -> `EntityStore`), and reading
// `selfHostedAdapter` while the module evaluates would throw whenever the cycle
// is entered from the adapter's side.
let registered: PersistenceAdapter | null = null;

/** Overridable so tests can substitute a stub; resets to the real adapter on null. */
export function setPersistenceAdapter(adapter: PersistenceAdapter | null): void {
  registered = adapter;
}

export function getPersistenceAdapter(): PersistenceAdapter {
  return registered ?? selfHostedAdapter;
}
