<template>
  <section class="access-tab" data-testid="library-access">
    <div class="tools">
      <span class="spacer" />
      <select
        v-model="adding"
        class="add-select"
        data-testid="library-access-add"
        :disabled="grants.saving.value || candidates.length === 0"
        @change="add"
      >
        <option value="">+ Add person or group</option>
        <option v-for="p in candidates" :key="p.iri" :value="p.iri">{{ principalName(p) }} · {{ kindLabel(p.kind) }}</option>
      </select>
    </div>

    <p v-if="grants.error.value" class="error" data-testid="library-access-error">{{ grants.error.value }}</p>

    <div class="table-wrap">
      <table class="grants">
        <thead>
          <tr>
            <th>Who</th>
            <th title="View: read · Run: read, execute · Edit: read, execute, write · Manage: all five">Library</th>
            <th v-for="env in environments" :key="env.id" title="Run: run what it holds · Promote: run, and move what it holds">{{ env.name }}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="principal in grants.rows.value" :key="principal" :data-testid="`access-row-${grants.nameOf(principal)}`">
            <td>
              <span class="who">
                <span class="who-name">{{ grants.nameOf(principal) }}</span>
                <span class="who-kind">{{ kindOf(principal) }}</span>
              </span>
            </td>
            <td>
              <select
                class="role"
                :value="libraryRole(principal)"
                :disabled="grants.saving.value"
                :title="describeLibraryModes(grants.modesOn(principal, libraryId)) || 'No access'"
                :data-testid="`access-role-${grants.nameOf(principal)}`"
                @change="setRole(principal, ($event.target as HTMLSelectElement).value)"
              >
                <option value="none">None</option>
                <option v-for="role in LIBRARY_ROLES" :key="role.value" :value="role.value">{{ role.label }}</option>
                <option v-if="libraryRole(principal) === 'custom'" value="custom" disabled>Custom</option>
              </select>
            </td>
            <td v-for="env in environments" :key="env.id">
              <SegmentedToggle
                :model-value="environmentAccessOf(grants.modesOn(principal, env.id))"
                :options="ENV_OPTIONS"
                :group-label="`${env.name} access`"
                :disabled="grants.saving.value"
                @update:model-value="(value) => setEnvironment(principal, env.id, value as EnvironmentAccess)"
              />
            </td>
            <td>
              <button
                type="button"
                class="icon-button"
                :title="`Remove ${grants.nameOf(principal)} from this library`"
                :disabled="grants.saving.value"
                @click="grants.removePrincipal(principal)"
              >
                <X :size="13" />
              </button>
            </td>
          </tr>
          <tr v-if="grants.loaded.value && grants.rows.value.length === 0">
            <td :colspan="environments.length + 3" class="empty-row">Nobody has access yet.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { X } from '@lucide/vue';
import type { Environment } from '@sparql-query-lib/contracts';
import SegmentedToggle from '@/components/shared/SegmentedToggle.vue';
import {
  EVERYONE,
  LIBRARY_ROLES,
  describeLibraryModes,
  kindLabel,
  modesOfRole,
  principalName,
  roleOf,
  type LibraryRole,
} from '@/lib/accessModel';
import {
  environmentAccessOf,
  modesOfEnvironmentAccess,
  type EnvironmentAccess,
  type LibraryGrants,
} from '@/composables/useLibraryGrants';

const props = defineProps<{
  libraryId: string;
  environments: readonly Environment[];
  grants: LibraryGrants;
}>();

const ENV_OPTIONS = [
  { value: 'none', label: '—', title: 'No access' },
  { value: 'run', label: 'Run' },
  { value: 'promote', label: 'Promote' },
] as const;

const adding = ref('');

const candidates = computed(() => {
  const present = new Set(props.grants.rows.value);
  return [EVERYONE, ...props.grants.principals.value].filter((p) => !present.has(p.iri));
});

/** The row's library role; no modes at all is None, not a custom set. */
function libraryRole(principal: string): string {
  const modes = props.grants.modesOn(principal, props.libraryId);
  return modes.length === 0 ? 'none' : roleOf(modes);
}

function kindOf(iri: string): string {
  const known = [EVERYONE, ...props.grants.principals.value].find((p) => p.iri === iri);
  return known ? kindLabel(known.kind) : '';
}

function setRole(principal: string, role: string) {
  const modes = role === 'none' ? [] : modesOfRole(role as LibraryRole);
  void props.grants.replace(principal, 'library', props.libraryId, modes);
}

function setEnvironment(principal: string, environment: string, access: EnvironmentAccess) {
  void props.grants.replace(principal, 'environment', environment, modesOfEnvironmentAccess(access));
}

/** A new row starts with View on the library, the least that makes the row mean something. */
function add() {
  const principal = adding.value;
  adding.value = '';
  if (!principal) return;
  void props.grants.replace(principal, 'library', props.libraryId, modesOfRole('view'));
}
</script>

<style scoped>
.access-tab {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.tools {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.spacer {
  flex: 1;
}

.add-select,
.role {
  height: var(--control-h-sm);
  padding: 0 var(--space-3);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink);
  font: inherit;
  font-size: var(--text-body);
}

.error {
  margin: 0;
  color: var(--danger-ink);
  font-size: var(--text-body);
}

.table-wrap {
  overflow-x: auto;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-panel);
}

.grants {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-body);
}

.grants th,
.grants td {
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
  text-align: left;
  white-space: nowrap;
}

.grants th {
  color: var(--ink-muted);
  font-size: var(--text-micro);
  font-weight: var(--weight-semibold);
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.grants tbody tr:last-child td {
  border-bottom: none;
}

.who {
  display: inline-flex;
  align-items: baseline;
  gap: var(--space-3);
}

.who-name {
  color: var(--ink);
  font-weight: var(--weight-medium);
}

.who-kind {
  color: var(--ink-muted);
  font-size: var(--text-micro);
}

.icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--control-h-sm);
  height: var(--control-h-sm);
  border: none;
  border-radius: var(--radius);
  background: transparent;
  color: var(--ink-muted);
  cursor: pointer;
}

.icon-button:hover {
  background: var(--surface-subtle);
  color: var(--ink-secondary);
}

.empty-row {
  color: var(--ink-muted);
  text-align: center;
}
</style>
