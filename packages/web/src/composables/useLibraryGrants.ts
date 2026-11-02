/**
 * Who may do what in one library: the library's grants and its environments'
 * grants, for the Library page's Access tab and the chain's "Promote" line.
 *
 * `control` on the library is enough to read and change both; the server
 * checks it (`assertMayAdministerGrant`). A caller without it gets nothing
 * here, and the page hides what needs it.
 *
 * A change replaces a principal's grants on one resource with one grant of
 * the new modes, the same rule as the admin Access screen, so the two
 * screens never disagree about what a set of grants means.
 */
import { computed, ref } from 'vue';
import type { Environment } from '@sparql-query-lib/contracts';
import { useApiClient, type Grant, type PrincipalRecord } from '@/composables/useApiClient';
import { EVERYONE, principalName } from '@/lib/accessModel';

export type EnvironmentAccess = 'none' | 'run' | 'promote';

export function environmentAccessOf(modes: Iterable<string>): EnvironmentAccess {
  const held = new Set(modes);
  if (held.has('promote')) return 'promote';
  if (held.has('execute')) return 'run';
  return 'none';
}

export function modesOfEnvironmentAccess(access: EnvironmentAccess): string[] {
  return { none: [], run: ['execute'], promote: ['execute', 'promote'] }[access];
}

export function useLibraryGrants(libraryId: () => string | null, environments: () => readonly Environment[]) {
  const api = useApiClient();

  const grants = ref<Grant[]>([]);
  const principals = ref<PrincipalRecord[]>([]);
  const loaded = ref(false);
  const error = ref<string | null>(null);
  const saving = ref(false);

  async function load() {
    const library = libraryId();
    if (!library) return;
    error.value = null;
    try {
      const [libraryGrants, ...environmentGrants] = await Promise.all([
        api.listGrants({ library }),
        ...environments().map((env) => api.listGrants({ environment: env.id })),
      ]);
      grants.value = [...libraryGrants, ...environmentGrants.flat()];
      principals.value = await api.listPrincipals().catch(() => []);
      loaded.value = true;
    } catch (failure) {
      grants.value = [];
      loaded.value = false;
      error.value = (failure as { statusCode?: number }).statusCode === 403
        ? null
        : ((failure as { message?: string }).message ?? 'Could not load access');
    }
  }

  function nameOf(iri: string): string {
    const known = [EVERYONE, ...principals.value].find((p) => p.iri === iri);
    return known ? principalName(known) : iri.replace(/^.*[/#:]/, '');
  }

  function modesOn(principal: string, resource: string): string[] {
    const modes = new Set<string>();
    for (const grant of grants.value) {
      if (grant.principal === principal && grant.resource === resource) grant.modes.forEach((m) => modes.add(m));
    }
    return [...modes];
  }

  /** Every principal with a grant here, in name order. */
  const rows = computed(() => {
    const seen = new Set(grants.value.map((grant) => grant.principal));
    return [...seen].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  });

  /** For the chain cards: the names that may promote to, and run in, each environment. */
  const holders = computed(() => {
    const result: Record<string, { promote: string[]; execute: string[] }> = {};
    for (const env of environments()) {
      const promote: string[] = [];
      const execute: string[] = [];
      for (const principal of rows.value) {
        const access = environmentAccessOf(modesOn(principal, env.id));
        if (access === 'promote') promote.push(nameOf(principal));
        else if (access === 'run') execute.push(nameOf(principal));
      }
      result[env.id] = { promote, execute };
    }
    return result;
  });

  async function replace(principal: string, resourceKind: 'library' | 'environment', resource: string, modes: string[]) {
    saving.value = true;
    error.value = null;
    try {
      for (const grant of grants.value.filter((g) => g.principal === principal && g.resource === resource)) {
        await api.deleteGrant(grant.id);
      }
      if (modes.length > 0) await api.createGrant({ principal, resourceKind, resource, modes });
    } catch (failure) {
      error.value = (failure as { data?: { error?: string }; message?: string }).data?.error
        ?? (failure as { message?: string }).message ?? 'The change was not saved';
    } finally {
      await load();
      saving.value = false;
    }
  }

  /** Remove every grant a principal holds in this library and its environments. */
  async function removePrincipal(principal: string) {
    saving.value = true;
    try {
      for (const grant of grants.value.filter((g) => g.principal === principal)) await api.deleteGrant(grant.id);
    } finally {
      await load();
      saving.value = false;
    }
  }

  return { grants, principals, rows, holders, loaded, error, saving, load, nameOf, modesOn, replace, removePrincipal };
}

export type LibraryGrants = ReturnType<typeof useLibraryGrants>;
