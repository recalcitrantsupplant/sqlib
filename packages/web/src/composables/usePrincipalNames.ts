/**
 * The session's one cache of display names (`lib/principalNames.ts`).
 *
 * Created on first use, from inside a component's setup, so the API client
 * it calls through carries the signed-in token.
 */
import { createPrincipalNameCache, type PrincipalNameCache } from '../lib/principalNames';
import { useApiClient } from './useApiClient';

let cache: PrincipalNameCache | null = null;

export function usePrincipalNames(): PrincipalNameCache {
  if (!cache) {
    const api = useApiClient();
    cache = createPrincipalNameCache((iris) => api.lookupPrincipalNames(iris));
  }
  return cache;
}

/** Forget every name. For tests. */
export function resetPrincipalNames(): void {
  cache = null;
}
