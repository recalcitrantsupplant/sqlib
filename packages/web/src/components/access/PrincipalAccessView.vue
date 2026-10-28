<template>
  <div class="record" data-testid="principal-access-view">
    <header class="record-header">
      <span class="record-name">{{ principalName(principal) }}</span>
      <StatusBadge tone="neutral">{{ kindLabel(principal.kind) }}</StatusBadge>
      <span v-if="principal.label" class="record-sub" data-testid="principal-subject">ID {{ principal.rawClaim }}</span>
      <span v-if="principal.kind === 'group'" class="record-sub">{{ memberCount }} {{ memberCount === 1 ? 'member' : 'members' }} seen</span>
      <template v-if="isPerson">
        <span class="record-sub">{{ groupsLine }}</span>
        <button
          v-for="group in personGroups"
          :key="group.iri"
          type="button"
          class="badge-link"
          @click="emit('select', group.iri)"
        >
          <StatusBadge tone="neutral">{{ principalName(group) }}</StatusBadge>
        </button>
      </template>
      <div class="header-actions">
        <StatusBadge v-if="access.saving.value" tone="neutral">Saving…</StatusBadge>
        <StatusBadge v-else-if="hasPending" tone="warning">Unsaved</StatusBadge>
        <StatusBadge v-else-if="access.savedAt.value" tone="success">Saved</StatusBadge>
        <select
          v-if="!isPerson && copySources.length"
          class="header-select"
          :value="''"
          :disabled="access.saving.value"
          aria-label="Copy access from"
          data-testid="copy-access-from"
          @change="copyFrom($event.target as HTMLSelectElement)"
        >
          <option value="" disabled>Copy access from…</option>
          <option v-for="source in copySources" :key="source.iri" :value="source.iri">{{ principalName(source) }}</option>
        </select>
        <button
          v-if="isPerson"
          type="button"
          class="btn-compact btn-primary"
          data-testid="test-graph-access"
          @click="emit('test-as', principal.iri)"
        >
          Test graph access
        </button>
      </div>
    </header>

    <div class="record-body">
      <div class="record-column">
        <p v-if="access.saveError.value" class="error">{{ access.saveError.value }}</p>

        <EmptyState
          v-if="isAdmin"
          boxed
          size="sm"
          title="Administrator"
          :description="`Grants and graph policies do not apply. This ${kindLabel(principal.kind)} can do everything.`"
          data-testid="principal-admin"
        />

        <template v-if="isPerson">
          <EmptyState
            v-if="!hasDirectGrants && !showDirect"
            boxed
            size="sm"
            :title="`No grants made to ${shortName} directly`"
            description="Everything below comes from groups. Grant to a group where you can."
            data-testid="no-direct-grants"
          >
            <template #actions>
              <button type="button" class="btn-compact" @click="showDirect = true">+ Direct grant</button>
            </template>
          </EmptyState>
          <section v-else class="block">
            <SectionLabel as="h3">Direct grants</SectionLabel>
            <PrincipalGrantsEditor :principal="principal" @open-backend="(id) => emit('open-backend', id)" />
          </section>

          <section class="block" data-testid="effective-access">
            <div class="sec-head">
              <SectionLabel as="h3">Effective access</SectionLabel>
              <InlineNote as="span" size="xs">The union of every grant that reaches this person</InlineNote>
            </div>
            <div class="panel">
              <table class="tbl">
                <thead>
                  <tr>
                    <th class="col-name">Resource</th>
                    <th>Access</th>
                    <th>Comes from</th>
                    <th>Graphs</th>
                  </tr>
                </thead>
                <tbody>
                  <tr class="grp"><td colspan="4"><SectionLabel as="span" size="sm">Libraries</SectionLabel></td></tr>
                  <tr v-for="row in effectiveLibraries" :key="row.resource">
                    <td class="name">{{ row.name }}</td>
                    <td>{{ describeLibraryModes(row.modes) }}</td>
                    <td><span class="from"><StatusBadge v-for="from in row.from" :key="from" tone="neutral">{{ fromLabel(from) }}</StatusBadge></span></td>
                    <td class="dash">–</td>
                  </tr>
                  <tr v-if="effectiveLibraries.length === 0"><td colspan="4" class="dash">No library access</td></tr>
                  <tr class="grp"><td colspan="4"><SectionLabel as="span" size="sm">Backends</SectionLabel></td></tr>
                  <tr v-for="row in effectiveBackends" :key="row.resource">
                    <td class="name">{{ row.backend.name }}</td>
                    <td>{{ describeBackendModes(row.modes) }}</td>
                    <td><span class="from"><StatusBadge v-for="from in row.from" :key="from" tone="neutral">{{ fromLabel(from) }}</StatusBadge></span></td>
                    <td><AccessGraphsBadge :backend="row.backend" :principal="principal" @open="emit('open-backend', row.backend.id)" /></td>
                  </tr>
                  <tr v-if="effectiveBackends.length === 0"><td colspan="4" class="dash">No backend access</td></tr>
                </tbody>
              </table>
            </div>
            <InlineNote>Groups come from the last sign-in. A change in your identity provider shows here after the next sign-in.</InlineNote>
          </section>
        </template>

        <PrincipalGrantsEditor v-else :principal="principal" @open-backend="(id) => emit('open-backend', id)" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * One principal's access. A group, an application or everyone signed in
 * shows the grants made to it, ready to change. A person shows what they end
 * up with: the union of their own grants and their groups', with where each
 * part comes from.
 */
import { computed, ref, watch } from 'vue';
import type { Backend } from '@sparql-query-lib/contracts';
import type { PrincipalRecord } from '@/composables/useApiClient';
import { useAccessData } from '@/composables/useAccessData';
import {
  EVERYONE,
  EVERYONE_IRI,
  comparePrincipals,
  describeBackendModes,
  describeLibraryModes,
  effectiveAccess,
  isAdminGrant,
  kindLabel,
  principalName,
} from '@/lib/accessModel';
import { formatRelativeTime } from '@/lib/time';
import StatusBadge from '@/components/shared/StatusBadge.vue';
import SectionLabel from '@/components/shared/SectionLabel.vue';
import InlineNote from '@/components/shared/InlineNote.vue';
import EmptyState from '@/components/shared/EmptyState.vue';
import PrincipalGrantsEditor from './PrincipalGrantsEditor.vue';
import AccessGraphsBadge from './AccessGraphsBadge.vue';

const props = defineProps<{ principal: PrincipalRecord }>();
const emit = defineEmits<{
  (e: 'select', iri: string): void;
  (e: 'open-backend', backendId: string): void;
  (e: 'test-as', iri: string): void;
}>();

const access = useAccessData();
const showDirect = ref(false);
watch(() => props.principal.iri, () => { showDirect.value = false; });

const isPerson = computed(() => props.principal.kind === 'user');
const shortName = computed(() => principalName(props.principal).split('@')[0]);

const hasPending = computed(() =>
  [...access.libraries.value.map((l) => l.id), ...access.backends.value.map((b) => b.id)]
    .some((resource) => access.isPending(props.principal.iri, resource)));
const isAdmin = computed(() => access.grantsOf(props.principal.iri).some(isAdminGrant));
const hasDirectGrants = computed(() =>
  access.grantsOf(props.principal.iri).some((grant) => grant.resourceKind !== 'everything'));

const memberCount = computed(() =>
  access.principals.value.filter((p) => p.groups?.includes(props.principal.iri)).length);

const byIri = computed(() => new Map([EVERYONE, ...access.principals.value].map((p) => [p.iri, p])));

const personGroups = computed(() =>
  (props.principal.groups ?? []).map((iri) => byIri.value.get(iri) ?? { iri, rawClaim: iri, kind: 'group' }));

const groupsLine = computed(() => {
  const when = props.principal.seenAt ? `, ${formatRelativeTime(props.principal.seenAt)}` : '';
  if (!props.principal.groups) return 'not signed in yet';
  return props.principal.groups.length ? `groups at last sign-in${when}:` : `no groups at last sign-in${when}`;
});

const copySources = computed(() =>
  [EVERYONE, ...access.principals.value]
    .filter((p) => p.iri !== props.principal.iri && access.grantsOf(p.iri).some((g) => g.resourceKind !== 'everything'))
    .sort(comparePrincipals));

async function copyFrom(select: HTMLSelectElement) {
  const source = select.value;
  select.value = '';
  if (source) await access.copyGrants(source, props.principal.iri);
}

const effective = computed(() =>
  effectiveAccess([props.principal.iri, ...(props.principal.groups ?? []), EVERYONE_IRI], access.grants.value));

const effectiveLibraries = computed(() =>
  effective.value.filter((entry) => entry.resourceKind === 'library').map((entry) => ({
    ...entry,
    name: access.libraries.value.find((library) => library.id === entry.resource)?.name ?? entry.resource,
  })));

const effectiveBackends = computed(() =>
  effective.value.flatMap((entry) => {
    const backend = access.backends.value.find((b) => b.id === entry.resource);
    return entry.resourceKind === 'backend' && backend ? [{ ...entry, backend: backend as Backend }] : [];
  }));

function fromLabel(iri: string): string {
  if (iri === props.principal.iri) return 'direct';
  if (iri === EVERYONE_IRI) return 'Everyone';
  const known = byIri.value.get(iri);
  return known ? principalName(known) : iri;
}
</script>

<style scoped>
.record {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  color: var(--ink);
  font-size: var(--text-body);
  line-height: 1.5;
}

.record-header {
  display: flex;
  flex-shrink: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-4);
  min-height: 48px;
  padding: var(--space-3) var(--space-6);
  border-bottom: 1px solid var(--border-subtle);
}

.record-name {
  color: var(--ink);
  font-size: var(--text-title);
  font-weight: var(--weight-semibold);
}

.record-sub {
  color: var(--ink-muted);
  font-size: var(--text-label);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-left: auto;
}

.header-select {
  height: var(--control-h);
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-panel);
  background: var(--surface);
  color: var(--ink-secondary);
  font-size: var(--text-body);
}

.badge-link {
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
}

.record-body {
  padding: var(--space-7) var(--space-6) var(--space-8);
}

.record-column {
  display: flex;
  flex-direction: column;
  gap: var(--space-7);
  max-width: 820px;
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

.tbl th {
  height: 30px;
  background: var(--surface-subtle);
  color: var(--ink-muted);
  font-size: var(--text-label);
  font-weight: var(--weight-semibold);
}

.tbl .grp td {
  height: 26px;
  background: var(--surface-subtle);
}

.col-name {
  width: 28%;
}

.name {
  color: var(--ink);
  font-weight: var(--weight-medium);
}

.from {
  display: inline-flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.dash {
  color: var(--ink-muted);
}

.error {
  margin: 0;
  color: var(--danger-ink);
  font-size: var(--text-body);
}
</style>
