/**
 * The Access screen's model: roles over library modes, levels over backend
 * modes, and the access a person ends up with from every grant that reaches
 * them.
 *
 * Grants on the server are plain sets of modes. Roles and levels exist only
 * here, as names for the sets people pick most, so a set no role names is
 * shown as `custom` with its modes, never rounded to the nearest role.
 */
import type { Grant, PrincipalRecord } from '@/composables/useApiClient';

export const LIBRARY_MODES = ['read', 'execute', 'write', 'delete', 'control'] as const;
export type LibraryMode = (typeof LIBRARY_MODES)[number];

export const LIBRARY_ROLES = [
  { value: 'view', label: 'View', modes: ['read'] },
  { value: 'run', label: 'Run', modes: ['read', 'execute'] },
  { value: 'edit', label: 'Edit', modes: ['read', 'execute', 'write'] },
  { value: 'manage', label: 'Manage', modes: [...LIBRARY_MODES] },
] as const;
export type LibraryRole = (typeof LIBRARY_ROLES)[number]['value'] | 'custom';

export const OPERATIONS = ['query', 'update'] as const;
export type Operation = (typeof OPERATIONS)[number];
export type Level = 'none' | 'saved' | 'adhoc';

export const LEVEL_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'saved', label: 'Saved' },
  { value: 'adhoc', label: 'Ad hoc' },
] as const;

/** Every signed-in caller holds this principal, so a grant to it is a grant to everyone. */
export const EVERYONE_IRI = 'urn:sqlib:principal:authenticated';
export const EVERYONE: PrincipalRecord = { iri: EVERYONE_IRI, rawClaim: 'Everyone signed in', kind: 'everyone' };

export function kindLabel(kind: string): string {
  return { everyone: 'everyone', group: 'group', user: 'person', client: 'application' }[kind] ?? kind;
}

/** The role a set of library modes is, or `custom` when no role is exactly that set. */
export function roleOf(modes: Iterable<string>): LibraryRole {
  const held = new Set(modes);
  const role = LIBRARY_ROLES.find((candidate) =>
    candidate.modes.length === held.size && candidate.modes.every((mode) => held.has(mode)));
  return role?.value ?? 'custom';
}

export function modesOfRole(role: LibraryRole): string[] {
  return [...(LIBRARY_ROLES.find((candidate) => candidate.value === role)?.modes ?? [])];
}

/** How a set of library modes reads in a table: the role name, or the modes. */
export function describeLibraryModes(modes: Iterable<string>): string {
  const list = LIBRARY_MODES.filter((mode) => new Set(modes).has(mode));
  const role = roleOf(list);
  return role === 'custom' ? list.join(', ') : LIBRARY_ROLES.find((r) => r.value === role)!.label;
}

export function levelOf(modes: Iterable<string>, operation: Operation): Level {
  const held = new Set(modes);
  if (held.has(`${operation}:adhoc`)) return 'adhoc';
  if (held.has(`${operation}:saved`)) return 'saved';
  return 'none';
}

/** `modes` with one operation's level replaced. */
export function withLevel(modes: Iterable<string>, operation: Operation, level: Level): string[] {
  const rest = [...modes].filter((mode) => !mode.startsWith(`${operation}:`));
  return level === 'none' ? rest : [...rest, `${operation}:${level}`];
}

export function levelLabel(level: Level): string {
  return { none: 'none', saved: 'saved', adhoc: 'ad hoc' }[level];
}

/** "Query ad hoc · Update none". */
export function describeBackendModes(modes: Iterable<string>): string {
  const list = [...modes];
  return OPERATIONS.map((op) => `${op === 'query' ? 'Query' : 'Update'} ${levelLabel(levelOf(list, op))}`).join(' · ');
}

/** True when the grant makes its principal an administrator. */
export function isAdminGrant(grant: Grant): boolean {
  return grant.resourceKind === 'everything' && grant.modes.includes('control');
}

/** One resource a person reaches, with the principals whose grants reach it. */
export interface EffectiveEntry {
  resource: string;
  resourceKind: 'library' | 'backend';
  modes: Set<string>;
  from: string[];
}

/**
 * The union of every grant held by any of `principals`, per resource.
 *
 * `from` lists each principal that contributed, in the order given, so the
 * person's own grants come first when the caller puts them first.
 */
export function effectiveAccess(principals: readonly string[], grants: readonly Grant[]): EffectiveEntry[] {
  const entries = new Map<string, EffectiveEntry>();
  for (const principal of principals) {
    for (const grant of grants) {
      if (grant.principal !== principal || grant.resourceKind === 'everything') continue;
      const entry = entries.get(grant.resource)
        ?? { resource: grant.resource, resourceKind: grant.resourceKind, modes: new Set<string>(), from: [] };
      for (const mode of grant.modes) entry.modes.add(mode);
      if (!entry.from.includes(principal)) entry.from.push(principal);
      entries.set(grant.resource, entry);
    }
  }
  return [...entries.values()];
}

/** How a principal is shown: a person's email, username or name when the token gave one, else the raw claim. */
export function principalName(principal: PrincipalRecord): string {
  return principal.label ?? principal.rawClaim;
}

const KIND_ORDER: Record<string, number> = { everyone: 0, group: 1, user: 2, client: 3 };

export function comparePrincipals(a: PrincipalRecord, b: PrincipalRecord): number {
  return (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9) || principalName(a).localeCompare(principalName(b));
}

/** "…/graph/" and "finance": an IRI split so its distinctive tail can be set apart. */
export function splitIri(iri: string): { head: string; tail: string } {
  const cut = Math.max(iri.lastIndexOf('/'), iri.lastIndexOf('#'));
  if (cut <= 0 || cut === iri.length - 1) return { head: '', tail: iri };
  const head = iri.slice(0, cut + 1);
  const shortHead = head.length > 12 ? `…${head.slice(head.lastIndexOf('/', head.length - 2))}` : head;
  return { head: shortHead, tail: iri.slice(cut + 1) };
}
