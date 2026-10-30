<template>
  <div class="record" data-testid="backend-access-view">
    <header class="record-header">
      <span class="record-name">{{ backend.name }}</span>
      <StatusBadge v-if="backend.authBackend" tone="warning">auth</StatusBadge>
      <span v-if="backend.endpoint" class="record-sub">{{ backend.endpoint }}</span>
      <div class="header-actions">
        <StatusBadge v-if="access.saving.value || saving" tone="neutral">Saving…</StatusBadge>
        <NuxtLink class="btn-compact" :to="`/backends/${encodeURIComponent(backend.id)}`">Backend settings</NuxtLink>
      </div>
    </header>

    <div class="record-body">
      <div :class="backend.authBackend ? 'record-column' : 'record-split'">
        <div class="record-column">
          <p v-if="saveError || access.saveError.value" class="error">{{ saveError ?? access.saveError.value }}</p>

          <section class="block" data-testid="backend-role">
            <div class="form-grid">
              <span class="form-label">Role</span>
              <div class="mode-choice" role="radiogroup" aria-label="Backend role">
                <label :class="['mode-option', { active: !backend.authBackend, disabled: usedBy.length > 0 }]">
                  <input
                    type="radio"
                    name="backend-role"
                    :checked="!backend.authBackend"
                    :disabled="saving || usedBy.length > 0"
                    data-testid="role-data"
                    @change="update({ authBackend: false })"
                  />
                  <span class="mode-text">
                    <span class="mode-name">Data backend</span>
                    <InlineNote as="span">Queries run here. Grants decide who may use it, and a graph policy can narrow its graphs.</InlineNote>
                  </span>
                </label>
                <label :class="['mode-option', { active: backend.authBackend, disabled: hasPolicy }]">
                  <input
                    type="radio"
                    name="backend-role"
                    :checked="backend.authBackend === true"
                    :disabled="saving || hasPolicy"
                    data-testid="role-auth"
                    @change="update({ authBackend: true })"
                  />
                  <span class="mode-text">
                    <span class="mode-name">Auth backend</span>
                    <InlineNote as="span">Constrain user or group access to the default and named graphs queries use.</InlineNote>
                  </span>
                </label>
              </div>

              <template v-if="backend.authBackend">
                <span class="form-label">Used by</span>
                <div v-if="usedBy.length" class="note-card">
                  <span class="chips">
                    <button v-for="user in usedBy" :key="user.id" type="button" class="badge-link" @click="emit('select', user.id)">
                      <StatusBadge tone="action">{{ user.name }}</StatusBadge>
                    </button>
                  </span>
                  <span>Move those policies to another auth backend before you make this a data backend.</span>
                </div>
                <InlineNote v-else>No graph policy runs here yet.</InlineNote>
              </template>
            </div>
            <InlineNote v-if="hasPolicy && !backend.authBackend" size="xs">Turn the graph policy off before you make this an auth backend.</InlineNote>
          </section>

          <template v-if="!backend.authBackend">
            <section class="block" data-testid="graph-policy">
              <div class="sec-head">
                <SectionLabel as="h3">Graph policy</SectionLabel>
                <StatusBadge :tone="hasPolicy ? 'success' : 'neutral'" dot>{{ hasPolicy ? 'on' : 'off' }}</StatusBadge>
                <span class="sec-actions">
                  <button v-if="hasPolicy" type="button" class="btn-compact" @click="openEditor">Change query</button>
                  <button v-if="hasPolicy" type="button" class="btn-compact danger-text" :disabled="saving" @click="turnOff">Turn off</button>
                </span>
              </div>

              <div v-if="editing" class="editor" data-testid="policy-editor">
                <InlineNote>
                  A saved SELECT on an auth backend that projects <code>?graph</code>, <code>?defaultGraph</code> or
                  <code>?namedGraph</code>. It reads the caller through <code>?authUser</code> and <code>?authGroup</code>.
                  Saving pins the query's current version.
                </InlineNote>
                <div class="editor-row">
                  <label class="field">
                    <span class="form-label">Policy query</span>
                    <select v-model="draftQuery" class="field-sm" data-testid="policy-query-select">
                      <option :value="null" disabled>Pick a query</option>
                      <option v-for="query in queries" :key="query.id" :value="query.id">{{ query.name }}</option>
                    </select>
                  </label>
                  <label class="field">
                    <span class="form-label">Runs on</span>
                    <select v-model="draftBackend" class="field-sm">
                      <option :value="null" disabled>Pick an auth backend</option>
                      <option v-for="auth in authBackends" :key="auth.id" :value="auth.id">{{ auth.name }}</option>
                    </select>
                  </label>
                </div>
                <InlineNote v-if="authBackends.length === 0" tone="danger">
                  No backend is an auth backend yet. Make one an auth backend first.
                </InlineNote>
                <div class="editor-row">
                  <button type="button" class="btn-compact btn-primary" :disabled="saving || !draftQuery || !draftBackend" @click="savePolicy">
                    Save policy
                  </button>
                  <button type="button" class="btn-compact" @click="editing = false">Cancel</button>
                </div>
              </div>

              <template v-if="hasPolicy && summary">
                <div class="form-grid">
                  <span class="form-label">Policy query</span>
                  <span>
                    <NuxtLink v-if="summary.query" :to="`/queries/${encodeURIComponent(summary.query.id)}`">{{ summary.query.name }}</NuxtLink>
                    <code v-else>{{ summary.policy?.queryVersion }}</code>
                    <StatusBadge v-if="summary.pinned?.version" tone="neutral" class="gap-left">pinned v{{ summary.pinned.version }}</StatusBadge>
                  </span>
                  <span class="form-label">Runs on</span>
                  <span>{{ policyBackendName }} <StatusBadge tone="warning" class="gap-left">auth</StatusBadge></span>
                  <span class="form-label">Reads the caller</span>
                  <span class="mono">
                    <template v-if="callerVars.length"><span class="var">{{ callerVars.join(', ') }}</span> → </template>
                    <span class="var">{{ outputVars.join(', ') || '?graph' }}</span>
                  </span>
                </div>

                <div v-if="summary.latest" class="drift" role="status" data-testid="policy-drift">
                  <AlertTriangle :size="14" class="drift-icon" />
                  <span class="drift-text">
                    v{{ summary.latest.version }} of the query was saved {{ formatRelativeTime(summary.latest.dateCreated) || 'since' }}.
                    This backend still runs v{{ summary.pinned?.version }}.
                  </span>
                  <button type="button" class="btn-compact" @click="testLatest">Test v{{ summary.latest.version }}</button>
                  <button type="button" class="btn-compact btn-primary" :disabled="saving" @click="pinLatest">Pin v{{ summary.latest.version }}</button>
                </div>

                <CodePeek
                  :label="summary.query?.name ?? 'Policy query'"
                  :content="summary.pinned?.queryString ?? ''"
                  content-type="application/sparql-query"
                  :meta="peekMeta"
                  :collapsed-lines="8"
                />
              </template>
              <p v-else-if="hasPolicy" class="dash">Loading the policy…</p>

              <EmptyState
                v-else-if="!editing"
                boxed
                size="sm"
                title="No graph policy"
                description="Anyone with a grant reads every graph."
              >
                <template #actions>
                  <button type="button" class="btn-compact" @click="openEditor">Add a graph policy…</button>
                </template>
              </EmptyState>
            </section>

            <section class="block" data-testid="backend-grants-by-principal">
              <div class="sec-head">
                <SectionLabel as="h3" :count="grantRows.length + adminRows.length">Who can use it</SectionLabel>
                <select
                  class="add-select"
                  :value="''"
                  :disabled="access.saving.value || principalsToAdd.length === 0"
                  aria-label="Grant access"
                  data-testid="grant-access"
                  @change="grantTo(($event.target as HTMLSelectElement))"
                >
                  <option value="" disabled>+ Grant access</option>
                  <option v-for="principal in principalsToAdd" :key="principal.iri" :value="principal.iri">{{ principalName(principal) }}</option>
                </select>
              </div>
              <div class="panel">
                <table class="tbl">
                  <thead>
                    <tr><th class="col-name">Who</th><th>Query</th><th>Update</th><th>Graphs</th></tr>
                  </thead>
                  <tbody>
                    <tr v-for="principal in grantRows" :key="principal.iri" :class="{ changed: access.isPending(principal.iri, backend.id) }">
                      <td class="name">
                        <button type="button" class="name-link" @click="emit('select-principal', principal.iri)">{{ principalName(principal) }}</button>
                      </td>
                      <td v-for="operation in OPERATIONS" :key="operation">
                        <AccessLevelToggle
                          :model-value="levelOf(access.modesOn(principal.iri, backend.id), operation)"
                          :group-label="`${operation === 'query' ? 'Query' : 'Update'} for ${principalName(principal)}`"
                          :disabled="access.saving.value"
                          @update:model-value="(level) => setLevel(principal.iri, operation, level)"
                        />
                      </td>
                      <td><AccessGraphsBadge :backend="backend" :principal="principal" :name-policy="false" @open="testAs(principal.iri)" /></td>
                    </tr>
                    <tr v-for="principal in adminRows" :key="principal.iri">
                      <td class="name">{{ principalName(principal) }}</td>
                      <td colspan="2" class="dash">Administrator: grants and the policy do not apply</td>
                      <td><StatusBadge tone="warning">all</StatusBadge></td>
                    </tr>
                    <tr v-if="grantRows.length + adminRows.length === 0"><td colspan="4" class="dash">Nobody has a grant here yet.</td></tr>
                  </tbody>
                </table>
              </div>
            </section>
          </template>
        </div>

        <aside v-if="!backend.authBackend" class="record-sidecar">
          <TestAsPanel ref="testAsPanel" :backend="backend" :summary="summary" @grant="grantFromTest" @add-policy="openEditor" />
        </aside>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * One backend's access: its role, its graph policy, who may use it, and
 * `Test as` beside them.
 *
 * An auth backend shows only its role and the backends whose policies run on
 * it: only administrators use it, so it has no grants or policy of its own.
 */
import { computed, onMounted, ref, watch } from 'vue';
import { AlertTriangle } from '@lucide/vue';
import type { Backend, Query } from '@sparql-query-lib/contracts';
import { useApiClient, type GraphPolicySummary, type PrincipalRecord } from '@/composables/useApiClient';
import { useAccessData } from '@/composables/useAccessData';
import { EVERYONE, OPERATIONS, comparePrincipals, isAdminGrant, levelOf, principalName, withLevel, type Level, type Operation } from '@/lib/accessModel';
import { formatRelativeTime } from '@/lib/time';
import StatusBadge from '@/components/shared/StatusBadge.vue';
import SectionLabel from '@/components/shared/SectionLabel.vue';
import InlineNote from '@/components/shared/InlineNote.vue';
import CodePeek from '@/components/shared/CodePeek.vue';
import EmptyState from '@/components/shared/EmptyState.vue';
import AccessLevelToggle from './AccessLevelToggle.vue';
import AccessGraphsBadge from './AccessGraphsBadge.vue';
import TestAsPanel from './TestAsPanel.vue';

const props = defineProps<{ backend: Backend }>();
const emit = defineEmits<{
  (e: 'select', backendId: string): void;
  (e: 'select-principal', iri: string): void;
}>();

const api = useApiClient();
const access = useAccessData();

const summary = ref<GraphPolicySummary | null>(null);
const queries = ref<Query[]>([]);
const saving = ref(false);
const saveError = ref<string | null>(null);
const editing = ref(false);
const draftQuery = ref<string | null>(null);
const draftBackend = ref<string | null>(null);
const testAsPanel = ref<InstanceType<typeof TestAsPanel> | null>(null);

const hasPolicy = computed(() => Boolean(props.backend.graphPolicyQueryVersion));
const authBackends = computed(() => access.backends.value.filter((b) => b.authBackend === true));
const usedBy = computed(() => access.backends.value.filter((b) => b.graphPolicyBackend === props.backend.id));
const policyBackendName = computed(() =>
  access.backends.value.find((b) => b.id === summary.value?.policy?.backend)?.name ?? summary.value?.policy?.backend ?? '');

const callerVars = computed(() =>
  ['?authUser', '?authGroup'].filter((v) => summary.value?.pinned?.queryString?.includes(v)));
const outputVars = computed(() => {
  const text = summary.value?.pinned?.queryString ?? '';
  const head = text.slice(0, Math.max(0, text.search(/\bWHERE\b|\{/i)));
  return ['?graph', '?defaultGraph', '?namedGraph'].filter((v) => new RegExp(`\\${v}\\b`).test(head));
});
const peekMeta = computed(() => {
  const lines = (summary.value?.pinned?.queryString ?? '').trim().split('\n').length;
  return `v${summary.value?.pinned?.version ?? '?'} · ${lines} lines`;
});

const everyPrincipal = computed(() => [EVERYONE, ...access.principals.value]);
const admins = computed(() => new Set(access.grants.value.filter(isAdminGrant).map((g) => g.principal)));

const grantRows = computed(() =>
  everyPrincipal.value
    .filter((p) => !admins.value.has(p.iri) && access.modesOn(p.iri, props.backend.id).size > 0)
    .sort(comparePrincipals));
const adminRows = computed(() => everyPrincipal.value.filter((p) => admins.value.has(p.iri)));
const principalsToAdd = computed(() =>
  everyPrincipal.value
    .filter((p) => !admins.value.has(p.iri) && access.modesOn(p.iri, props.backend.id).size === 0)
    .sort(comparePrincipals));

async function loadSummary() {
  summary.value = null;
  if (!hasPolicy.value) return;
  try {
    summary.value = await api.getGraphPolicy(props.backend.id);
  } catch (error) {
    saveError.value = error instanceof Error ? error.message : String(error);
  }
}

watch(() => [props.backend.id, props.backend.graphPolicyQueryVersion], () => {
  editing.value = false;
  saveError.value = null;
  void loadSummary();
});

onMounted(() => {
  void loadSummary();
  void access.graphTotal(props.backend.id);
});

async function update(changes: Record<string, unknown>) {
  saving.value = true;
  saveError.value = null;
  try {
    await api.updateBackend(props.backend.id, { name: props.backend.name, ...changes });
    await access.reloadBackends();
  } catch (error) {
    saveError.value = error instanceof Error ? error.message : String(error);
  } finally {
    saving.value = false;
  }
}

async function openEditor() {
  editing.value = true;
  draftQuery.value = summary.value?.query?.id ?? null;
  draftBackend.value = props.backend.graphPolicyBackend ?? authBackends.value[0]?.id ?? null;
  if (queries.value.length === 0) queries.value = await api.listQueries().catch(() => []);
}

async function savePolicy() {
  const version = queries.value.find((q) => q.id === draftQuery.value)?.currentVersion;
  if (!version) {
    saveError.value = 'That query has no saved version yet. Save it in the query editor first.';
    return;
  }
  await update({ graphPolicyQueryVersion: version, graphPolicyBackend: draftBackend.value });
  if (!saveError.value) editing.value = false;
}

function turnOff() {
  void update({ graphPolicyQueryVersion: null, graphPolicyBackend: null });
}

function pinLatest() {
  if (summary.value?.latest) void update({ graphPolicyQueryVersion: summary.value.latest.id });
}

function testLatest() {
  testAsPanel.value?.testPerson(undefined, 'latest');
}

function testAs(principal: string) {
  const record = everyPrincipal.value.find((p) => p.iri === principal);
  if (record?.kind === 'user' || record?.kind === 'client') testAsPanel.value?.testPerson(principal);
}

/** Open `Test as` for a person, from the person's own view. */
function testPerson(person: string) {
  testAsPanel.value?.testPerson(person);
}

defineExpose({ testPerson });

function setLevel(principal: string, operation: Operation, level: Level) {
  void access.replaceModes(principal, 'backend', props.backend.id, withLevel(access.modesOn(principal, props.backend.id), operation, level));
}

function grantTo(select: HTMLSelectElement) {
  const principal = select.value;
  select.value = '';
  if (principal) setLevel(principal, 'query', 'saved');
}

function grantFromTest(principal: string | null) {
  const target: PrincipalRecord | undefined = everyPrincipal.value.find((p) => p.iri === principal);
  if (target) setLevel(target.iri, 'query', 'saved');
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
  overflow: hidden;
  color: var(--ink-muted);
  font-size: var(--text-label);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-left: auto;
}

.record-body {
  padding: var(--space-7) var(--space-6) var(--space-8);
}

.record-split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: var(--space-7);
  align-items: start;
}

.record-column {
  display: flex;
  flex-direction: column;
  gap: var(--space-7);
  min-width: 0;
  max-width: 820px;
}

.record-sidecar {
  position: sticky;
  top: 0;
}

.block {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.sec-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.sec-actions {
  display: flex;
  gap: var(--space-3);
  margin-left: auto;
}

.danger-text {
  color: var(--danger-ink);
}

.form-grid {
  display: grid;
  grid-template-columns: 130px 1fr;
  gap: var(--space-4) var(--space-5);
  align-items: baseline;
}

.form-label {
  color: var(--ink-muted);
  font-size: var(--text-label);
  font-weight: var(--weight-semibold);
}

.mode-choice {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.mode-option {
  display: flex;
  align-items: flex-start;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-5);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-panel);
  background: var(--surface);
  cursor: pointer;
}

.mode-option.active {
  border-color: var(--action);
  background: var(--action-surface);
}

.mode-option.disabled:not(.active) {
  cursor: not-allowed;
  opacity: 0.6;
}

.mode-option input {
  margin-top: var(--space-1);
}

.mode-text {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.mode-name {
  color: var(--ink);
  font-weight: var(--weight-semibold);
}

.mode-option.active .mode-name {
  color: var(--action-ink);
}

.note-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-5);
  border: 1px solid var(--warning-border);
  border-radius: var(--radius-panel);
  background: var(--warning-surface);
  color: var(--warning-ink);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.badge-link {
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
}

.gap-left {
  margin-left: var(--space-2);
}

.mono {
  font-family: var(--font-mono);
  font-size: var(--text-label);
}

.var {
  color: var(--action-ink);
}

.drift {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-5);
  border: 1px solid var(--warning-border);
  border-radius: var(--radius-panel);
  background: var(--warning-surface);
  color: var(--warning-ink);
}

.drift-icon {
  flex-shrink: 0;
}

.drift-text {
  flex: 1;
  min-width: 220px;
}

.editor {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-5);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-panel);
  background: var(--surface-subtle);
}

.editor-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.field-sm {
  min-width: var(--grid-6);
  height: var(--control-h);
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink);
  font-size: var(--text-body);
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

.tbl tr.changed td {
  background: var(--warning-surface);
}

.tbl tr.changed td:first-child {
  box-shadow: inset 2px 0 0 var(--warning-ink);
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

.name {
  color: var(--ink);
  font-weight: var(--weight-medium);
}

.name-link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--ink);
  font: inherit;
  cursor: pointer;
}

.name-link:hover {
  color: var(--action);
}

.dash {
  margin: 0;
  color: var(--ink-muted);
}

.error {
  margin: 0;
  color: var(--danger-ink);
  font-size: var(--text-body);
}

@media (max-width: 1100px) {
  .record-split {
    grid-template-columns: 1fr;
  }

  .record-sidecar {
    position: static;
  }
}
</style>
