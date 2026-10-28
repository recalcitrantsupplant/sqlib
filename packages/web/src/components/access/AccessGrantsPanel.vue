<template>
  <div class="grants-panel">
    <aside class="principals">
      <input v-model="search" class="search" type="search" placeholder="Filter people and groups" aria-label="Filter people and groups" />
      <p v-if="principalsError" class="error">{{ principalsError }}</p>
      <ul class="principal-list" role="listbox" aria-label="People and groups">
        <li
          v-for="principal in visiblePrincipals"
          :key="principal.iri"
          role="option"
          :aria-selected="principal.iri === selected"
          :class="['principal', { active: principal.iri === selected }]"
          :data-testid="`principal-${principal.kind}`"
          @click="selected = principal.iri"
        >
          <span class="principal-name">{{ principal.rawClaim }}</span>
          <InlineNote as="span">{{ kindLabel(principal.kind) }}</InlineNote>
        </li>
      </ul>
      <InlineNote>
        People and groups appear here after they first sign in. Grant to groups where you can, and manage
        membership in your identity provider.
      </InlineNote>
    </aside>

    <section v-if="selectedPrincipal" class="modes">
      <header class="modes-header">
        <h2 class="modes-title">{{ selectedPrincipal.rawClaim }}</h2>
        <InlineNote as="span">{{ kindLabel(selectedPrincipal.kind) }}</InlineNote>
        <span v-if="isEverythingAdmin" class="badge">Administrator</span>
      </header>
      <p v-if="saveError" class="error">{{ saveError }}</p>

      <h3 class="group-title">Libraries</h3>
      <table class="grid">
        <thead>
          <tr>
            <th>Library</th>
            <th v-for="mode in LIBRARY_MODES" :key="mode">{{ mode }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="library in libraries" :key="library.id">
            <td>{{ library.name }}</td>
            <td v-for="mode in LIBRARY_MODES" :key="mode" class="cell">
              <input
                type="checkbox"
                :aria-label="`${mode} on ${library.name}`"
                :checked="modesOn(library.id).has(mode)"
                :disabled="saving"
                @change="toggleLibraryMode(library.id, mode, ($event.target as HTMLInputElement).checked)"
              />
            </td>
          </tr>
        </tbody>
      </table>

      <h3 class="group-title">Backends</h3>
      <InlineNote>
        <strong>Saved</strong> runs saved queries or updates only. <strong>Ad hoc</strong> also runs text the
        person writes, and includes saved.
      </InlineNote>
      <table class="grid">
        <thead>
          <tr>
            <th>Backend</th>
            <th>Query</th>
            <th>Update</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="backend in backends" :key="backend.id">
            <td>
              {{ backend.name }}
              <span v-if="backend.authBackend" class="badge">auth</span>
              <span v-else-if="backend.graphPolicyQueryVersion" class="badge">graph policy</span>
            </td>
            <td v-for="operation in OPERATIONS" :key="operation">
              <select
                :aria-label="`${operation} on ${backend.name}`"
                :value="levelOf(backend.id, operation)"
                :disabled="saving"
                @change="setLevel(backend.id, operation, ($event.target as HTMLSelectElement).value as Level)"
              >
                <option value="none">None</option>
                <option value="saved">Saved</option>
                <option value="adhoc">Ad hoc</option>
              </select>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
    <section v-else class="modes empty">
      <InlineNote>Pick a person or a group to see and change what they may do.</InlineNote>
    </section>
  </div>
</template>

<script setup lang="ts">
/**
 * The Access screen: what a person or a group may do, per library and per
 * backend.
 *
 * Grants are additive records on the server, one per principal, resource and
 * set of modes. The screen shows the union for the selected principal, and a
 * change replaces that principal's grants on the one resource with a single
 * grant holding the new modes.
 */
import { computed, onMounted, ref } from 'vue';
import type { Backend, Library } from '@sparql-query-lib/contracts';
import { useApiClient, type Grant, type PrincipalRecord } from '@/composables/useApiClient';
import InlineNote from '@/components/shared/InlineNote.vue';

const LIBRARY_MODES = ['read', 'write', 'execute', 'delete', 'control'] as const;
const OPERATIONS = ['query', 'update'] as const;
type Operation = (typeof OPERATIONS)[number];
type Level = 'none' | 'saved' | 'adhoc';

/** Every signed-in caller holds this principal, so a grant to it is a grant to everyone. */
const EVERYONE: PrincipalRecord = { iri: 'urn:sqlib:principal:authenticated', rawClaim: 'Everyone signed in', kind: 'everyone' };

const api = useApiClient();

const principals = ref<PrincipalRecord[]>([]);
const grants = ref<Grant[]>([]);
const libraries = ref<Library[]>([]);
const backends = ref<Backend[]>([]);
const selected = ref<string | null>(null);
const search = ref('');
const saving = ref(false);
const saveError = ref<string | null>(null);
const principalsError = ref<string | null>(null);

const KIND_ORDER: Record<string, number> = { everyone: 0, group: 1, user: 2, client: 3 };

function kindLabel(kind: string): string {
  return { everyone: 'everyone', group: 'group', user: 'person', client: 'application' }[kind] ?? kind;
}

// Groups first: most grants should go to groups.
const visiblePrincipals = computed(() => {
  const needle = search.value.trim().toLowerCase();
  return [EVERYONE, ...principals.value]
    .filter((principal) => !needle || principal.rawClaim.toLowerCase().includes(needle))
    .sort((a, b) => (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9) || a.rawClaim.localeCompare(b.rawClaim));
});

const selectedPrincipal = computed(() =>
  [EVERYONE, ...principals.value].find((principal) => principal.iri === selected.value) ?? null);

const grantsOfSelected = computed(() => grants.value.filter((grant) => grant.principal === selected.value));

const isEverythingAdmin = computed(() =>
  grantsOfSelected.value.some((grant) => grant.resourceKind === 'everything' && grant.modes.includes('control')));

function grantsOn(resource: string): Grant[] {
  return grantsOfSelected.value.filter((grant) => grant.resource === resource);
}

function modesOn(resource: string): Set<string> {
  return new Set(grantsOn(resource).flatMap((grant) => grant.modes));
}

function levelOf(backendId: string, operation: Operation): Level {
  const modes = modesOn(backendId);
  if (modes.has(`${operation}:adhoc`)) return 'adhoc';
  if (modes.has(`${operation}:saved`)) return 'saved';
  return 'none';
}

/** Replace the selected principal's grants on one resource with one grant of `modes`. */
async function replaceModes(resourceKind: 'library' | 'backend', resource: string, modes: string[]) {
  const principal = selected.value;
  if (!principal) return;
  saving.value = true;
  saveError.value = null;
  try {
    for (const grant of grantsOn(resource)) await api.deleteGrant(grant.id);
    if (modes.length > 0) await api.createGrant({ principal, resourceKind, resource, modes });
    grants.value = await api.listGrants();
  } catch (error) {
    saveError.value = error instanceof Error ? error.message : String(error);
    grants.value = await api.listGrants().catch(() => grants.value);
  } finally {
    saving.value = false;
  }
}

function toggleLibraryMode(libraryId: string, mode: string, on: boolean) {
  const modes = modesOn(libraryId);
  if (on) modes.add(mode);
  else modes.delete(mode);
  void replaceModes('library', libraryId, [...modes]);
}

function setLevel(backendId: string, operation: Operation, level: Level) {
  const modes = [...modesOn(backendId)].filter((mode) => !mode.startsWith(`${operation}:`));
  if (level !== 'none') modes.push(`${operation}:${level}`);
  void replaceModes('backend', backendId, modes);
}

onMounted(async () => {
  const [principalList, grantList, libraryList, backendList] = await Promise.allSettled([
    api.listPrincipals(),
    api.listGrants(),
    api.listLibraries(),
    api.listBackends(),
  ]);
  if (principalList.status === 'fulfilled') principals.value = principalList.value;
  else principalsError.value = 'Could not load people and groups. Only administrators can manage access.';
  if (grantList.status === 'fulfilled') grants.value = grantList.value;
  if (libraryList.status === 'fulfilled') libraries.value = libraryList.value;
  if (backendList.status === 'fulfilled') backends.value = backendList.value;
});
</script>

<style scoped>
.grants-panel {
  display: grid;
  grid-template-columns: minmax(14rem, 18rem) 1fr;
  gap: var(--space-6);
  min-height: 0;
}

.principals {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.search {
  height: var(--control-h);
  padding: 0 var(--space-3);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink);
  font-size: var(--text-body);
}

.principal-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: 0;
  margin: 0;
  list-style: none;
}

.principal {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius);
  color: var(--ink);
  font-size: var(--text-body);
  cursor: pointer;
}

.principal:hover {
  background: var(--surface-subtle);
}

.principal.active {
  background: var(--action-surface);
  color: var(--action-ink);
}

.principal-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.modes {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
}

.modes.empty {
  justify-content: center;
}

.modes-header {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
}

.modes-title {
  margin: 0;
  color: var(--ink);
  font-size: var(--text-body-lg);
  font-weight: var(--weight-semibold);
}

.group-title {
  margin: 0;
  color: var(--ink-secondary);
  font-size: var(--text-label);
  font-weight: var(--weight-semibold);
}

.grid {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-body);
}

.grid th,
.grid td {
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border-subtle);
  color: var(--ink);
  text-align: left;
}

.grid th {
  color: var(--ink-muted);
  font-size: var(--text-label);
  font-weight: var(--weight-medium);
}

.cell {
  text-align: center;
}

.grid select {
  height: var(--control-h-sm);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink);
  font-size: var(--text-body);
}

.badge {
  padding: 0 var(--space-2);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-full);
  color: var(--ink-secondary);
  font-size: var(--text-label);
}

.error {
  margin: 0;
  color: var(--danger-ink);
  font-size: var(--text-body);
}

@media (max-width: 720px) {
  .grants-panel {
    grid-template-columns: 1fr;
  }
}
</style>
