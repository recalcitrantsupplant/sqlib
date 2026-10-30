/**
 * Grant resolution (design §4.4).
 *
 * Resolution is additive: the effective grant set is the union over all of a
 * caller's principals. There is no ordering, no precedence and no deny rule —
 * composition can only widen access, which is what keeps grants auditable and
 * keeps phase 2's policies monotone.
 */
import { getAuthStore } from './AuthStore.js';
import type { AuthStore } from './AuthStore.js';
import { modesSatisfying, type BackendMode, type EffectiveGrants, type LibraryMode } from './types.js';

export function resolveEffectiveGrants(
  principals: readonly string[],
  store: AuthStore = getAuthStore()
): EffectiveGrants {
  const backends = new Map<string, Set<BackendMode>>();
  const libraries = new Map<string, Set<LibraryMode>>();

  for (const grant of store.grantsForPrincipals(principals)) {
    if (grant.resourceKind === 'library') {
      const existing = libraries.get(grant.resource) ?? new Set<LibraryMode>();
      for (const mode of grant.modes) existing.add(mode as LibraryMode);
      libraries.set(grant.resource, existing);
    } else if (grant.resourceKind === 'backend') {
      const existing = backends.get(grant.resource) ?? new Set<BackendMode>();
      for (const mode of grant.modes) existing.add(mode as BackendMode);
      backends.set(grant.resource, existing);
    }
  }

  return {
    admin: store.isAdmin(principals),
    backends,
    libraries,
  };
}

export function hasLibraryMode(
  grants: EffectiveGrants,
  libraryIri: string | null | undefined,
  mode: LibraryMode
): boolean {
  if (grants.admin) return true;
  if (!libraryIri) return false;
  return grants.libraries.get(libraryIri)?.has(mode) ?? false;
}

export function hasBackendMode(
  grants: EffectiveGrants,
  backendIri: string | null | undefined,
  mode: BackendMode
): boolean {
  if (grants.admin) return true;
  if (!backendIri) return false;
  const held = grants.backends.get(backendIri);
  if (!held) return false;
  // `adhoc` includes `saved`, so a grant of either level answers a `saved` check.
  return modesSatisfying(mode).some(candidate => held.has(candidate));
}

/** True when the caller holds any mode at all on a backend. */
export function hasAnyBackendMode(grants: EffectiveGrants, backendIri: string | null | undefined): boolean {
  if (grants.admin) return true;
  if (!backendIri) return false;
  return (grants.backends.get(backendIri)?.size ?? 0) > 0;
}
