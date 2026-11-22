/**
 * Demo people as principals (`config/demoMode.ts`).
 *
 * A demo person's IRIs are made as a token from `DEMO_ISSUER` would make them,
 * so grants, graph policies and seeded data name a demo person the same way
 * they name anybody else.
 */
import type { FastifyBaseLogger } from 'fastify';
import { DEMO_ISSUER, demoPeople, type DemoPerson } from '../config/demoMode.js';
import type { AuthStore } from './AuthStore.js';
import { principalIri } from './principals.js';
import { PRINCIPAL_ANONYMOUS, PRINCIPAL_AUTHENTICATED } from './types.js';

export interface DemoPrincipals {
  user: string;
  groups: string[];
  /** user, groups, the anonymous principal and the authenticated sentinel. */
  all: string[];
}

export function demoPrincipalsOf(person: DemoPerson): DemoPrincipals {
  const user = principalIri('user', DEMO_ISSUER, person.id);
  const groups = person.groups.map(group => principalIri('group', DEMO_ISSUER, group));
  return { user, groups, all: [user, ...groups, PRINCIPAL_ANONYMOUS, PRINCIPAL_AUTHENTICATED] };
}

/** The administrators among the demo people, as bootstrap admin IRIs. */
export function demoAdminPrincipals(): string[] {
  return demoPeople().filter(person => person.admin).map(person => demoPrincipalsOf(person).user);
}

/**
 * Records each demo person and group in the auth store at start, so the
 * account menu, the Access page and the activity lists show their names.
 *
 * This is the operator's configuration, written by the server at start. A
 * request never writes it: the plugin does not record a demo person it sees.
 */
export async function recordDemoPeople(store: AuthStore, logger?: FastifyBaseLogger): Promise<void> {
  for (const person of demoPeople()) {
    const principals = demoPrincipalsOf(person);
    await store.recordPrincipal(principals.user, person.id, 'user', { label: person.name, displayName: person.name });
    for (const [index, group] of principals.groups.entries()) {
      await store.recordPrincipal(group, person.groups[index], 'group');
    }
    await store.recordGroups(principals.user, principals.groups);
  }
  if (demoPeople().length > 0) {
    logger?.info({ demoPeople: demoPeople().map(person => person.id) }, 'Demo people recorded');
  }
}
