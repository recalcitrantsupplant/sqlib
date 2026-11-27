/**
 * `fetch` with the caller's bearer token and client id, for the few calls that
 * do not go through `useApiClient` (ETL, assistant tools).
 *
 * Without the token such a call is anonymous, and an API in `required` auth
 * mode answers it with 401 "Authentication required." even though the user is
 * signed in.
 */
import { useAuth } from './useAuth';
import { clientId } from '../lib/clientId';
import { DEMO_PERSON_HEADER, currentDemoPersonId } from '../lib/demoPerson';
import { invalidateGetCache } from '../lib/getCache';

export async function authorizedFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const token = await useAuth().accessToken();
  const headers = new Headers(init.headers);
  if (!headers.has('x-sqlib-client-id')) headers.set('x-sqlib-client-id', clientId());
  if (token && !headers.has('authorization')) headers.set('authorization', `Bearer ${token}`);
  const demoPerson = currentDemoPersonId();
  if (demoPerson && !headers.has(DEMO_PERSON_HEADER)) headers.set(DEMO_PERSON_HEADER, demoPerson);
  const method = (init.method ?? 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD') return fetch(input, { ...init, headers });
  // A write makes the lists that `useApiClient` shares stale.
  invalidateGetCache();
  try {
    return await fetch(input, { ...init, headers });
  } finally {
    invalidateGetCache();
  }
}
