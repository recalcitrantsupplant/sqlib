<template>
  <div class="policy-panel">
    <div class="row">
      <label class="field">
        <span class="label">Backend</span>
        <select v-model="backendId" data-testid="policy-backend-select">
          <option :value="null" disabled>Pick a backend</option>
          <option v-for="backend in backends" :key="backend.id" :value="backend.id">
            {{ backend.name }}{{ backend.authBackend ? ' (auth)' : backend.graphPolicyQueryVersion ? ' (policy)' : '' }}
          </option>
        </select>
      </label>
    </div>

    <template v-if="backend">
      <section class="block">
        <label class="check">
          <input type="checkbox" :checked="backend.authBackend === true" :disabled="saving" @change="setAuthBackend(($event.target as HTMLInputElement).checked)" />
          This is an auth backend
        </label>
        <p class="hint">
          An auth backend holds who may read what. Only administrators can query it, and graph policies run on it.
        </p>
      </section>

      <section v-if="!backend.authBackend" class="block">
        <h2 class="block-title">Graph policy</h2>
        <p class="hint">
          A saved SELECT on an auth backend that projects <code>?graph</code>, <code>?defaultGraph</code> or
          <code>?namedGraph</code>. It reads the caller through <code>VALUES ?authUser {'{'} UNDEF {'}'}</code> and
          <code>VALUES ?authGroup {'{'} UNDEF {'}'}</code>. Without a policy, every graph is readable.
        </p>
        <div class="row">
          <label class="field">
            <span class="label">Policy query</span>
            <select v-model="policyQueryId">
              <option :value="null">No policy</option>
              <option v-for="query in queries" :key="query.id" :value="query.id">{{ query.name }}</option>
            </select>
          </label>
          <label class="field">
            <span class="label">Runs on</span>
            <select v-model="policyBackendId" :disabled="!policyQueryId">
              <option :value="null" disabled>Pick an auth backend</option>
              <option v-for="auth in authBackends" :key="auth.id" :value="auth.id">{{ auth.name }}</option>
            </select>
          </label>
        </div>
        <p class="hint">
          Saving pins the query's current version, so later edits change nothing until you save here again.
          <template v-if="pinnedQuery">
            Pinned: <strong>{{ pinnedQuery.name }}</strong>.
            <NuxtLink :to="`/queries/${encodeURIComponent(pinnedQuery.id)}`">Edit the policy query</NuxtLink>
          </template>
          <template v-else-if="backend.graphPolicyQueryVersion">
            Pinned: <code>{{ backend.graphPolicyQueryVersion }}</code>.
          </template>
        </p>
        <div class="actions">
          <button type="button" class="primary" :disabled="saving || !policyDirty" @click="savePolicy">Save policy</button>
        </div>
        <p v-if="saveError" class="error">{{ saveError }}</p>
      </section>

      <section v-if="!backend.authBackend" class="block">
        <h2 class="block-title">Test as</h2>
        <div class="row">
          <label class="field">
            <span class="label">Person</span>
            <select v-model="testUser" @change="fillGroupsFromUser">
              <option :value="null">Nobody in particular</option>
              <option v-for="person in people" :key="person.iri" :value="person.iri">{{ person.rawClaim }}</option>
            </select>
          </label>
        </div>
        <fieldset class="groups">
          <legend class="label">Groups</legend>
          <label v-for="group in groupPrincipals" :key="group.iri" class="check">
            <input v-model="testGroups" type="checkbox" :value="group.iri" />
            {{ group.rawClaim }}
          </label>
          <p v-if="groupPrincipals.length === 0" class="hint">No groups have signed in yet.</p>
        </fieldset>
        <p v-if="groupsNote" class="hint">{{ groupsNote }}</p>
        <div class="actions">
          <button type="button" class="primary" :disabled="testing" data-testid="test-as-run" @click="runTest">Run</button>
        </div>

        <div v-if="testResult" class="result" data-testid="test-as-result">
          <p v-if="testResult.admin">Administrator: grants and graph policies do not apply.</p>
          <p v-else-if="testResult.modes.length === 0">
            No grant on this backend, so the policy does not apply: this person cannot use the backend at all.
          </p>
          <p v-else>Grants on this backend: {{ testResult.modes.join(', ') }}.</p>

          <p v-if="!testResult.policy">This backend has no graph policy: every graph is readable.</p>
          <p v-else-if="testResult.error" class="error">The policy failed, so every request would be refused: {{ testResult.error }}</p>
          <template v-else>
            <h3 class="label">Default graphs ({{ testResult.defaultGraphs?.length ?? 0 }})</h3>
            <ul class="graphs"><li v-for="graph in testResult.defaultGraphs" :key="graph"><code>{{ graph }}</code></li></ul>
            <h3 class="label">Named graphs ({{ testResult.namedGraphs?.length ?? 0 }})</h3>
            <ul class="graphs"><li v-for="graph in testResult.namedGraphs" :key="graph"><code>{{ graph }}</code></li></ul>
          </template>
        </div>
        <p v-if="testError" class="error">{{ testError }}</p>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * The Graph policies screen: pick a backend, choose the policy query that
 * decides which of its graphs each caller may read, and test it as a person
 * or a set of groups. The policy query itself is edited in the ordinary query
 * editor; this screen pins a version of it.
 */
import { computed, onMounted, ref, watch } from 'vue';
import type { Backend, Query } from '@sparql-query-lib/contracts';
import { useApiClient, type GraphPolicyTest, type PrincipalRecord } from '@/composables/useApiClient';

const api = useApiClient();

const backends = ref<Backend[]>([]);
const queries = ref<Query[]>([]);
const principals = ref<PrincipalRecord[]>([]);
const backendId = ref<string | null>(null);
const policyQueryId = ref<string | null>(null);
const policyBackendId = ref<string | null>(null);
const saving = ref(false);
const saveError = ref<string | null>(null);

const testUser = ref<string | null>(null);
const testGroups = ref<string[]>([]);
const groupsNote = ref<string | null>(null);
const testing = ref(false);
const testResult = ref<GraphPolicyTest | null>(null);
const testError = ref<string | null>(null);

const backend = computed(() => backends.value.find((b) => b.id === backendId.value) ?? null);
const authBackends = computed(() => backends.value.filter((b) => b.authBackend === true));
const people = computed(() => principals.value.filter((p) => p.kind === 'user' || p.kind === 'client'));
const groupPrincipals = computed(() => principals.value.filter((p) => p.kind === 'group'));
const pinnedQuery = computed(() =>
  queries.value.find((q) => q.currentVersion && q.currentVersion === backend.value?.graphPolicyQueryVersion) ?? null);

const selectedVersion = computed(() => queries.value.find((q) => q.id === policyQueryId.value)?.currentVersion ?? null);
const policyDirty = computed(() =>
  (selectedVersion.value ?? null) !== (backend.value?.graphPolicyQueryVersion ?? null)
  || (policyQueryId.value ? policyBackendId.value : null) !== (backend.value?.graphPolicyBackend ?? null));

watch(backend, (current) => {
  policyQueryId.value = pinnedQuery.value?.id ?? null;
  policyBackendId.value = current?.graphPolicyBackend ?? authBackends.value[0]?.id ?? null;
  testResult.value = null;
  saveError.value = null;
});

async function reloadBackends() {
  backends.value = await api.listBackends();
}

async function update(changes: Record<string, unknown>) {
  if (!backend.value) return;
  saving.value = true;
  saveError.value = null;
  try {
    await api.updateBackend(backend.value.id, { name: backend.value.name, ...changes });
    await reloadBackends();
  } catch (error) {
    saveError.value = error instanceof Error ? error.message : String(error);
  } finally {
    saving.value = false;
  }
}

function setAuthBackend(on: boolean) {
  void update({ authBackend: on });
}

function savePolicy() {
  if (!policyQueryId.value) {
    void update({ graphPolicyQueryVersion: null, graphPolicyBackend: null });
    return;
  }
  if (!selectedVersion.value) {
    saveError.value = 'That query has no saved version yet. Save it in the query editor first.';
    return;
  }
  void update({ graphPolicyQueryVersion: selectedVersion.value, graphPolicyBackend: policyBackendId.value });
}

function fillGroupsFromUser() {
  const person = people.value.find((p) => p.iri === testUser.value);
  if (!person) {
    groupsNote.value = null;
    return;
  }
  if (person.groups) {
    testGroups.value = [...person.groups];
    groupsNote.value = 'Groups from this person\'s last sign-in. Change them to test other memberships.';
  } else {
    testGroups.value = [];
    groupsNote.value = 'sqlib has not recorded this person\'s groups yet. Tick them by hand.';
  }
}

async function runTest() {
  if (!backend.value) return;
  testing.value = true;
  testError.value = null;
  try {
    // An unsaved choice is tested as chosen, so a policy can be tried before it is saved.
    const unsaved = policyDirty.value && policyQueryId.value && selectedVersion.value && policyBackendId.value
      ? { queryVersion: selectedVersion.value, policyBackend: policyBackendId.value }
      : {};
    testResult.value = await api.testGraphPolicy(backend.value.id, {
      ...(testUser.value ? { user: testUser.value } : {}),
      groups: testGroups.value,
      ...unsaved,
    });
  } catch (error) {
    testError.value = error instanceof Error ? error.message : String(error);
  } finally {
    testing.value = false;
  }
}

onMounted(async () => {
  const [backendList, queryList, principalList] = await Promise.allSettled([
    api.listBackends(),
    api.listQueries(),
    api.listPrincipals(),
  ]);
  if (backendList.status === 'fulfilled') backends.value = backendList.value;
  if (queryList.status === 'fulfilled') queries.value = queryList.value;
  if (principalList.status === 'fulfilled') principals.value = principalList.value;
});
</script>

<style scoped>
.policy-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  max-width: 52rem;
}

.row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 14rem;
}

.label {
  margin: 0;
  color: var(--ink-secondary);
  font-size: var(--text-label);
  font-weight: var(--weight-semibold);
}

select {
  height: var(--control-h);
  padding: 0 var(--space-2);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink);
  font-size: var(--text-body);
}

.block {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-5);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-panel);
}

.block-title {
  margin: 0;
  color: var(--ink);
  font-size: var(--text-body-lg);
  font-weight: var(--weight-semibold);
}

.hint {
  margin: 0;
  color: var(--ink-muted);
  font-size: var(--text-label);
  line-height: var(--leading-normal);
}

.check {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--ink);
  font-size: var(--text-body);
}

.groups {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-5);
  padding: 0;
  margin: 0;
  border: 0;
}

.actions {
  display: flex;
  gap: var(--space-3);
}

.primary {
  height: var(--control-h);
  padding: 0 var(--space-4);
  border: 1px solid var(--action-border);
  border-radius: var(--radius);
  background: var(--action);
  color: var(--surface);
  font-size: var(--text-body);
  font-weight: var(--weight-medium);
  cursor: pointer;
}

.primary:disabled {
  cursor: default;
  opacity: 0.5;
}

.result {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-4);
  border-radius: var(--radius);
  background: var(--surface-subtle);
  color: var(--ink);
  font-size: var(--text-body);
}

.result p {
  margin: 0;
}

.graphs {
  padding: 0;
  margin: 0;
  list-style: none;
  font-family: var(--font-mono);
  font-size: var(--text-label);
}

.error {
  margin: 0;
  color: var(--danger-ink);
  font-size: var(--text-body);
}
</style>
