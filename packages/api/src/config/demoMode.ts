/**
 * Demo mode: a public read-only site that shows sqlib to a visitor.
 *
 * `SQLIB_DEMO=true` turns it on. It is a set of behaviours for a hosted demo,
 * and it builds on two settings that already make a deployment safe to expose:
 *
 * - `SQLIB_READ_ONLY=true`, so nothing a visitor sends changes sqlib's state.
 * - `SQLIB_AUTH_MODE=anonymous`, so a visitor holds only the grants on the
 *   anonymous principal.
 *
 * The server refuses to start in demo mode without both. Demo mode lets a
 * visitor act as a person from a fixed list, with no sign-in, and that is safe
 * only when nobody can write and the list is the operator's own.
 *
 * **Demo people.** `SQLIB_DEMO_PEOPLE` names a JSON file:
 *
 * ```json
 * { "people": [
 *   { "id": "alice", "name": "Alice", "groups": ["analysts"] },
 *   { "id": "dana", "name": "Dana", "groups": ["admins"], "admin": true }
 * ] }
 * ```
 *
 * A request with the header `X-Sqlib-Demo-Person: alice` acts as Alice: her
 * user principal, her group principals, the anonymous principal and the
 * authenticated sentinel. So acting as a person never takes away what a guest
 * holds. A request without the header is a guest. A request that names a
 * person not in the file gets 401: the visitor cannot add a person, a group or
 * an administrator.
 *
 * Principal IRIs are made as for a token from the issuer `DEMO_ISSUER`, so a
 * grant or a graph policy names a demo person the same way it names anybody.
 */
import { readFileSync } from 'node:fs';

/** The issuer that demo principal IRIs are hashed with (`principalIri`). */
export const DEMO_ISSUER = 'urn:sqlib:demo';

/** The request header that names the demo person a request acts as. */
export const DEMO_PERSON_HEADER = 'x-sqlib-demo-person';

export interface DemoPerson {
  /** Lower-case letters, digits and hyphens. What the header carries. */
  id: string;
  /** The name the account menu and the activity lists show. */
  name: string;
  /** Group names, as a token's groups claim would carry them. */
  groups: string[];
  /** A bootstrap administrator, as `SQLIB_AUTH_ADMIN_PRINCIPALS` makes one. */
  admin: boolean;
}

export interface DemoConfig {
  enabled: boolean;
  people: DemoPerson[];
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

function parseFlag(raw: string | undefined): boolean {
  return (raw ?? '').trim().toLowerCase() === 'true';
}

/** Parses and checks a people file's text. Exported for the tests. */
export function parseDemoPeople(text: string, source = 'SQLIB_DEMO_PEOPLE'): DemoPerson[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${source} is not JSON: ${(error as Error).message}`, { cause: error });
  }
  const list = (parsed as { people?: unknown } | null)?.people;
  if (!Array.isArray(list)) throw new Error(`${source} has no "people" array`);

  const seen = new Set<string>();
  return list.map((entry: unknown, index: number) => {
    const where = `${source}: person ${index + 1}`;
    if (!entry || typeof entry !== 'object') throw new Error(`${where} is not an object`);
    const { id, name, groups, admin } = entry as Record<string, unknown>;
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
      throw new Error(`${where}: "id" must be lower-case letters, digits and hyphens`);
    }
    if (seen.has(id)) throw new Error(`${where}: the id "${id}" is used twice`);
    seen.add(id);
    if (typeof name !== 'string' || !name.trim()) throw new Error(`${where}: "name" is empty`);
    if (groups !== undefined && (!Array.isArray(groups) || groups.some(g => typeof g !== 'string' || !g.trim()))) {
      throw new Error(`${where}: "groups" must be a list of names`);
    }
    if (admin !== undefined && typeof admin !== 'boolean') throw new Error(`${where}: "admin" must be true or false`);
    return {
      id,
      name: name.trim(),
      groups: ((groups as string[] | undefined) ?? []).map(g => g.trim()),
      admin: admin === true,
    };
  });
}

/**
 * Reads demo mode from an environment, and refuses an unsafe one.
 *
 * Throws when `SQLIB_DEMO=true` comes without `SQLIB_READ_ONLY=true` or
 * without `SQLIB_AUTH_MODE=anonymous`, or when the people file cannot be read.
 * The server calls it before it serves anything, so a mistake stops the start.
 */
export function resolveDemoConfig(env: NodeJS.ProcessEnv = process.env): DemoConfig {
  if (!parseFlag(env.SQLIB_DEMO)) return { enabled: false, people: [] };

  if (!parseFlag(env.SQLIB_READ_ONLY)) {
    throw new Error('SQLIB_DEMO=true needs SQLIB_READ_ONLY=true: demo people sign in with no password.');
  }
  const authMode = (env.SQLIB_AUTH_MODE ?? '').trim().toLowerCase();
  if (authMode !== 'anonymous') {
    throw new Error(`SQLIB_DEMO=true needs SQLIB_AUTH_MODE=anonymous, not "${authMode || 'unset'}".`);
  }

  const path = (env.SQLIB_DEMO_PEOPLE ?? '').trim();
  if (!path) return { enabled: true, people: [] };
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    throw new Error(`SQLIB_DEMO_PEOPLE: cannot read ${path}: ${(error as Error).message}`, { cause: error });
  }
  return { enabled: true, people: parseDemoPeople(text, `SQLIB_DEMO_PEOPLE (${path})`) };
}

let current: DemoConfig = { enabled: false, people: [] };

/** Re-reads demo mode. The server calls it once at start; tests call it to switch. */
export function resetDemoMode(env: NodeJS.ProcessEnv = process.env): DemoConfig {
  current = resolveDemoConfig(env);
  return current;
}

export function isDemoMode(): boolean {
  return current.enabled;
}

export function demoPeople(): readonly DemoPerson[] {
  return current.people;
}

export function demoPerson(id: string): DemoPerson | undefined {
  return current.people.find(person => person.id === id);
}
