<template>
  <div class="grants-editor">
    <section class="block" data-testid="library-grants">
      <div class="sec-head">
        <SectionLabel as="h3" :count="libraryRows.length">Libraries</SectionLabel>
        <select
          class="add-select"
          :value="''"
          :disabled="access.saving.value || librariesToAdd.length === 0"
          aria-label="Add library"
          data-testid="add-library"
          @change="addLibrary(($event.target as HTMLSelectElement))"
        >
          <option value="" disabled>+ Add library</option>
          <option v-for="library in librariesToAdd" :key="library.id" :value="library.id">{{ library.name }}</option>
        </select>
      </div>
      <div v-if="libraryRows.length" class="panel">
        <table class="tbl">
          <thead>
            <tr>
              <th class="col-name">Library</th>
              <th class="col-role">Role</th>
              <th>Modes</th>
              <th class="col-remove"><span class="sr-only">Remove</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in libraryRows" :key="row.library.id">
              <td class="name">{{ row.library.name }}</td>
              <td>
                <select
                  class="role-select"
                  :aria-label="`Role on ${row.library.name}`"
                  :value="row.role"
                  :disabled="access.saving.value"
                  @change="setRole(row.library.id, ($event.target as HTMLSelectElement).value as LibraryRole)"
                >
                  <option v-for="role in LIBRARY_ROLES" :key="role.value" :value="role.value">{{ role.label }}</option>
                  <option value="custom">Custom</option>
                </select>
              </td>
              <td>
                <span v-if="row.role === 'custom'" class="mode-grid">
                  <label v-for="mode in LIBRARY_MODES" :key="mode" :class="['mode', { on: row.modes.has(mode) }]">
                    <input
                      type="checkbox"
                      :checked="row.modes.has(mode)"
                      :disabled="access.saving.value"
                      :aria-label="`${mode} on ${row.library.name}`"
                      @change="toggleMode(row.library.id, mode, ($event.target as HTMLInputElement).checked)"
                    />
                    {{ mode }}
                  </label>
                </span>
                <span v-else class="mode-list">{{ LIBRARY_MODES.filter((m) => row.modes.has(m)).join(', ') }}</span>
              </td>
              <td>
                <button
                  type="button"
                  class="icon-control icon-control--sm"
                  :aria-label="`Remove access to ${row.library.name}`"
                  :disabled="access.saving.value"
                  @click="access.replaceModes(principal.iri, 'library', row.library.id, [])"
                >
                  <X :size="12" />
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <InlineNote v-else>No library grants.</InlineNote>
      <InlineNote>View = read · Run = read, execute · Edit = read, execute, write · Manage = all five.</InlineNote>
      <div v-for="missing in defaultBackendsWithoutGrant" :key="missing.library.id" class="nudge" data-testid="default-backend-nudge">
        <InlineNote as="span">
          {{ missing.library.name }} runs on {{ missing.backendName }} by default, and this {{ kindLabel(principal.kind) }}
          has no grant there. A library grant gives no backend access.
        </InlineNote>
        <button
          type="button"
          class="btn-compact"
          :disabled="access.saving.value"
          @click="setLevel(missing.backendId, 'query', 'saved')"
        >
          Allow saved queries on {{ missing.backendName }}
        </button>
      </div>
    </section>

    <section class="block" data-testid="backend-grants">
      <div class="sec-head">
        <SectionLabel as="h3" :count="backendRows.length">Backends</SectionLabel>
        <select
          class="add-select"
          :value="''"
          :disabled="access.saving.value || backendsToAdd.length === 0"
          aria-label="Add backend"
          data-testid="add-backend"
          @change="addBackend(($event.target as HTMLSelectElement))"
        >
          <option value="" disabled>+ Add backend</option>
          <option v-for="backend in backendsToAdd" :key="backend.id" :value="backend.id">{{ backend.name }}</option>
        </select>
      </div>
      <div v-if="backendRows.length" class="panel">
        <table class="tbl">
          <thead>
            <tr>
              <th class="col-name">Backend</th>
              <th>Query</th>
              <th>Update</th>
              <th>Graphs they can read</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="backend in backendRows" :key="backend.id">
              <td class="name">{{ backend.name }}</td>
              <td v-for="operation in OPERATIONS" :key="operation">
                <AccessLevelToggle
                  :model-value="levelOf(access.modesOn(principal.iri, backend.id), operation)"
                  :group-label="`${operation === 'query' ? 'Query' : 'Update'} on ${backend.name}`"
                  :disabled="access.saving.value"
                  @update:model-value="(level) => setLevel(backend.id, operation, level)"
                />
              </td>
              <td><AccessGraphsBadge :backend="backend" :principal="principal" @open="emit('open-backend', backend.id)" /></td>
            </tr>
          </tbody>
        </table>
      </div>
      <InlineNote v-else>No backend grants.</InlineNote>
      <InlineNote>
        Saved runs saved queries only. Ad hoc also runs text the person writes.
        <template v-if="authBackendNames">{{ authBackendNames }} hidden here: only administrators use auth backends.</template>
      </InlineNote>
    </section>
  </div>
</template>

<script setup lang="ts">
/**
 * The grants made to one principal directly: a role per library, and a level
 * per operation per backend.
 *
 * Library and backend grants are separate. Running a library's queries needs
 * a grant on the backend they run on, so a library whose default backend this
 * principal cannot query offers that grant in one click.
 */
import { computed, reactive } from 'vue';
import { X } from '@lucide/vue';
import type { PrincipalRecord } from '@/composables/useApiClient';
import { useAccessData } from '@/composables/useAccessData';
import {
  LIBRARY_MODES,
  LIBRARY_ROLES,
  OPERATIONS,
  kindLabel,
  levelOf,
  modesOfRole,
  roleOf,
  withLevel,
  type Level,
  type LibraryRole,
  type Operation,
} from '@/lib/accessModel';
import SectionLabel from '@/components/shared/SectionLabel.vue';
import InlineNote from '@/components/shared/InlineNote.vue';
import AccessLevelToggle from './AccessLevelToggle.vue';
import AccessGraphsBadge from './AccessGraphsBadge.vue';

const props = defineProps<{ principal: PrincipalRecord }>();
const emit = defineEmits<{ (e: 'open-backend', backendId: string): void }>();

const access = useAccessData();

/** Libraries shown as Custom although their modes match a role: the admin picked Custom to edit them. */
const customOpen = reactive(new Set<string>());

const libraryRows = computed(() =>
  access.libraries.value.flatMap((library) => {
    const modes = access.modesOn(props.principal.iri, library.id);
    if (modes.size === 0) return [];
    const role = customOpen.has(library.id) ? 'custom' : roleOf(modes);
    return [{ library, modes, role }];
  }));

const librariesToAdd = computed(() =>
  access.libraries.value.filter((library) => access.modesOn(props.principal.iri, library.id).size === 0));

const dataBackends = computed(() => access.backends.value.filter((backend) => !backend.authBackend));

const backendRows = computed(() =>
  dataBackends.value.filter((backend) => access.modesOn(props.principal.iri, backend.id).size > 0));

const backendsToAdd = computed(() =>
  dataBackends.value.filter((backend) => access.modesOn(props.principal.iri, backend.id).size === 0));

const authBackendNames = computed(() => {
  const names = access.backends.value.filter((backend) => backend.authBackend).map((backend) => backend.name);
  if (names.length === 0) return '';
  return names.length === 1 ? `${names[0]} is` : `${names.join(', ')} are`;
});

const defaultBackendsWithoutGrant = computed(() =>
  access.libraries.value.flatMap((library) => {
    const backendId = library.defaultBackend;
    if (!backendId || !access.modesOn(props.principal.iri, library.id).has('execute')) return [];
    if (levelOf(access.modesOn(props.principal.iri, backendId), 'query') !== 'none') return [];
    const backendName = access.backends.value.find((backend) => backend.id === backendId)?.name ?? backendId;
    return [{ library, backendId, backendName }];
  }));

function setRole(libraryId: string, role: LibraryRole) {
  if (role === 'custom') {
    customOpen.add(libraryId);
    return;
  }
  customOpen.delete(libraryId);
  void access.replaceModes(props.principal.iri, 'library', libraryId, modesOfRole(role));
}

function toggleMode(libraryId: string, mode: string, on: boolean) {
  const modes = access.modesOn(props.principal.iri, libraryId);
  if (on) modes.add(mode);
  else modes.delete(mode);
  void access.replaceModes(props.principal.iri, 'library', libraryId, [...modes]);
}

function setLevel(backendId: string, operation: Operation, level: Level) {
  void access.replaceModes(props.principal.iri, 'backend', backendId, withLevel(access.modesOn(props.principal.iri, backendId), operation, level));
}

function addLibrary(select: HTMLSelectElement) {
  const id = select.value;
  select.value = '';
  if (id) void access.replaceModes(props.principal.iri, 'library', id, modesOfRole('view'));
}

function addBackend(select: HTMLSelectElement) {
  const id = select.value;
  select.value = '';
  if (id) setLevel(id, 'query', 'saved');
}
</script>

<style scoped>
.grants-editor {
  display: flex;
  flex-direction: column;
  gap: var(--space-7);
}

.block {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.sec-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-2);
}

.add-select {
  max-width: var(--grid-6);
  height: var(--control-h);
  padding: 0 var(--space-4);
  margin-left: auto;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-panel);
  background: var(--surface);
  color: var(--ink-secondary);
  font-size: var(--text-body);
}

.panel {
  overflow-x: auto;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-panel);
}

.tbl {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-body);
}

.tbl th,
.tbl td {
  height: 36px;
  padding: 0 var(--space-5);
  border-bottom: 1px solid var(--border-subtle);
  color: var(--ink-secondary);
  text-align: left;
}

.tbl tr:last-child td {
  border-bottom: 0;
}

.tbl th {
  height: 30px;
  background: var(--surface-subtle);
  color: var(--ink-muted);
  font-size: var(--text-label);
  font-weight: var(--weight-semibold);
}

.col-name {
  width: 26%;
}

.col-role {
  width: calc(var(--grid-3) + var(--space-5) * 2);
}

.col-remove {
  width: 34px;
}

.name {
  color: var(--ink);
  font-weight: var(--weight-medium);
}

.role-select {
  width: var(--grid-3);
  height: var(--control-h-sm);
  padding: 0 var(--space-2);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink);
  font-size: var(--text-body);
}

.mode-grid {
  display: grid;
  grid-template-columns: repeat(5, var(--grid-2));
  gap: var(--space-2);
  padding: var(--space-2) 0;
}

.mode {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--ink-muted);
  font-size: var(--text-label);
}

.mode.on {
  color: var(--ink);
}

.mode input {
  margin: 0;
}

.mode-list {
  color: var(--ink-secondary);
}

.nudge {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
}
</style>
