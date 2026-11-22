/**
 * The demo person this browser acts as, on a server in demo mode.
 *
 * A server with `SQLIB_DEMO=true` lists people in `/health` (`demo.people`).
 * A visitor picks one in the account menu, and every request then carries
 * `X-Sqlib-Demo-Person`. The server checks the name against its own list, so
 * this choice decides nothing on its own.
 *
 * Kept in `localStorage` so a reload and a new tab keep the person. Storage
 * can be absent or refuse access (private windows, previews), so each access
 * is guarded, and the fallback is a guest.
 */

export const DEMO_PERSON_HEADER = 'x-sqlib-demo-person';
const STORAGE_KEY = 'sqlib.demoPerson';

export interface DemoPersonEntry {
  id: string;
  name: string;
  groups: string[];
  admin: boolean;
}

let inMemory: string | null = null;

/** The id of the person this browser acts as, or null for a guest. */
export function currentDemoPersonId(): string | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored && stored.trim() ? stored.trim() : null;
  } catch {
    return inMemory;
  }
}

/** Sets the person, or a guest with null. Takes effect on the next request. */
export function setDemoPersonId(id: string | null): void {
  inMemory = id;
  try {
    if (id) window.localStorage.setItem(STORAGE_KEY, id);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage refused: the in-memory value holds for this page.
  }
}

/** The header to add to an API request, or none for a guest. */
export function demoPersonHeaders(): Record<string, string> {
  const id = currentDemoPersonId();
  return id ? { [DEMO_PERSON_HEADER]: id } : {};
}

/** The `demo.people` list from a `/health` payload; empty outside demo mode. */
export function demoPeopleFrom(payload: unknown): DemoPersonEntry[] {
  const people = (payload as { demo?: { people?: unknown } } | null)?.demo?.people;
  if (!Array.isArray(people)) return [];
  return people
    .filter((entry): entry is Record<string, unknown> =>
      Boolean(entry) && typeof (entry as Record<string, unknown>).id === 'string'
      && typeof (entry as Record<string, unknown>).name === 'string')
    .map((entry) => ({
      id: entry.id as string,
      name: entry.name as string,
      groups: Array.isArray(entry.groups) ? (entry.groups as unknown[]).filter((g): g is string => typeof g === 'string') : [],
      admin: entry.admin === true,
    }));
}
