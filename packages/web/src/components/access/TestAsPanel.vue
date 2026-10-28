<template>
  <section class="panel" data-testid="test-as-panel">
    <PanelHeader title="Test as" subtitle="What one caller sees here. Nothing is saved." />

    <div class="form">
      <label class="field">
        <span class="form-label">Person</span>
        <select v-model="user" class="field-sm" aria-label="Person" data-testid="test-as-person" @change="fillGroups">
          <option :value="null">Nobody in particular</option>
          <option v-for="person in people" :key="person.iri" :value="person.iri">{{ person.rawClaim }}</option>
        </select>
      </label>
      <div class="field">
        <span class="form-label">Groups <span v-if="groupsFromSignIn" class="form-hint">· from last sign-in</span></span>
        <span class="chips">
          <StatusBadge v-for="group in groups" :key="group" tone="neutral">
            {{ nameOf(group) }}
            <button type="button" class="chip-x" :aria-label="`Remove ${nameOf(group)}`" @click="removeGroup(group)">
              <X :size="10" />
            </button>
          </StatusBadge>
          <select
            v-if="groupsToAdd.length"
            class="chip-add"
            :value="''"
            aria-label="Add group"
            @change="addGroup($event.target as HTMLSelectElement)"
          >
            <option value="" disabled>+ group</option>
            <option v-for="group in groupsToAdd" :key="group.iri" :value="group.iri">{{ group.rawClaim }}</option>
          </select>
        </span>
      </div>
      <div class="run-row">
        <SegmentedToggle
          v-if="summary?.latest"
          v-model="versionChoice"
          :options="versionOptions"
          group-label="Policy version"
        />
        <button type="button" class="btn-compact btn-primary run" :disabled="running" data-testid="test-as-run" @click="run()">
          {{ running ? 'Running…' : 'Run' }}
        </button>
      </div>
    </div>

    <p v-if="runError" class="error pad">{{ runError }}</p>

    <div v-if="outcome" class="result" data-testid="test-as-result">
      <template v-if="outcome.admin">
        <p class="outcome-title">Sees every graph</p>
        <InlineNote>Grants and the graph policy do not apply to administrators.</InlineNote>
        <button v-if="user && groups.length" type="button" class="btn-compact" @click="run({ groupsOnly: true })">
          Test with {{ shortName }}'s groups only
        </button>
      </template>

      <template v-else-if="outcome.modes.length === 0">
        <span class="badges">
          <StatusBadge tone="neutral">query none</StatusBadge>
          <StatusBadge tone="neutral">update none</StatusBadge>
        </span>
        <p class="outcome-title">Cannot use this backend</p>
        <InlineNote>No grant reaches this {{ user ? 'person' : 'set of groups' }}, so the policy never runs.</InlineNote>
        <button type="button" class="btn-compact" @click="emit('grant', user ?? groups[0] ?? null)">Grant access…</button>
      </template>

      <template v-else>
        <span class="badges">
          <StatusBadge :tone="queryLevel === 'none' ? 'neutral' : 'action'">query {{ levelLabel(queryLevel) }}</StatusBadge>
          <StatusBadge :tone="updateLevel === 'none' ? 'neutral' : 'action'">update {{ levelLabel(updateLevel) }}</StatusBadge>
          <InlineNote v-if="viaLine" as="span" size="xs">via {{ viaLine }}</InlineNote>
        </span>

        <template v-if="!outcome.policy">
          <p class="outcome-title">Every graph is readable</p>
          <InlineNote>This backend has no graph policy. Anyone with a grant reads every graph.</InlineNote>
          <button type="button" class="btn-compact" @click="emit('add-policy')">Add a graph policy…</button>
        </template>

        <template v-else-if="outcome.error">
          <span class="badges"><StatusBadge tone="danger">policy failed</StatusBadge></span>
          <p class="outcome-title">Every request would be refused</p>
          <p class="error">{{ outcome.error }}</p>
          <span class="badges">
            <NuxtLink v-if="summary?.query" class="btn-compact" :to="`/queries/${encodeURIComponent(summary.query.id)}`">Open policy query</NuxtLink>
            <button v-if="testedLatest" type="button" class="btn-compact" @click="versionChoice = 'pinned'; run()">
              Test v{{ summary?.pinned?.version }}
            </button>
          </span>
        </template>

        <template v-else>
          <div class="count-row">
            <span class="count">{{ graphs.length }} of {{ total ?? '?' }} graphs</span>
            <template v-if="diff">
              <StatusBadge v-if="diff.added.length" tone="success">+{{ diff.added.length }}</StatusBadge>
              <StatusBadge v-if="diff.removed.length" tone="danger">−{{ diff.removed.length }}</StatusBadge>
              <InlineNote as="span" size="xs">vs v{{ summary?.pinned?.version }}</InlineNote>
            </template>
          </div>
        </template>
      </template>
    </div>

    <template v-if="outcome && rows.length">
      <div class="graph-rows">
        <div v-for="row in shownRows" :key="row.iri" :class="['g-row', row.change]" :title="row.iri">
          <span class="g-iri"><span class="pre">{{ splitIri(row.iri).head }}</span>{{ splitIri(row.iri).tail }}</span>
          <StatusBadge v-if="row.change === 'new'" tone="success" size="xs">new</StatusBadge>
          <StatusBadge v-else-if="row.change === 'gone'" tone="danger" size="xs">gone</StatusBadge>
          <StatusBadge v-else-if="row.asDefault" tone="neutral" size="xs">D</StatusBadge>
          <StatusBadge v-if="row.asNamed && row.change !== 'gone'" tone="neutral" size="xs">N</StatusBadge>
        </div>
      </div>
      <div class="graph-foot">
        <button v-if="hiddenCount > 0" type="button" class="link" @click="showAll = true">Show the {{ hiddenCount }} hidden graphs</button>
        <span v-else />
        <InlineNote as="span" size="xs">D default · N named</InlineNote>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
/**
 * `Test as` for one backend: grants first, then the graph policy, evaluated
 * for one person or a set of groups. Nothing is saved.
 *
 * When the policy query has a newer version than the one pinned, the latest
 * can be tested before it is pinned, and the answer shows which graphs it
 * adds and which it takes away.
 */
import { computed, ref, watch } from 'vue';
import { X } from '@lucide/vue';
import type { Backend } from '@sparql-query-lib/contracts';
import { useApiClient, type GraphPolicySummary, type GraphPolicyTest } from '@/composables/useApiClient';
import { graphsOf, useAccessData } from '@/composables/useAccessData';
import { EVERYONE, EVERYONE_IRI, levelLabel, levelOf, splitIri } from '@/lib/accessModel';
import PanelHeader from '@/components/shared/PanelHeader.vue';
import SegmentedToggle from '@/components/shared/SegmentedToggle.vue';
import StatusBadge from '@/components/shared/StatusBadge.vue';
import InlineNote from '@/components/shared/InlineNote.vue';

const SHOWN_ROWS = 5;

const props = defineProps<{ backend: Backend; summary: GraphPolicySummary | null }>();
const emit = defineEmits<{
  (e: 'grant', principal: string | null): void;
  (e: 'add-policy'): void;
}>();

const api = useApiClient();
const access = useAccessData();

const user = ref<string | null>(null);
const groups = ref<string[]>([]);
const groupsFromSignIn = ref(false);
const versionChoice = ref<'pinned' | 'latest'>('pinned');
const running = ref(false);
const runError = ref<string | null>(null);
const outcome = ref<GraphPolicyTest | null>(null);
const baseline = ref<GraphPolicyTest | null>(null);
const testedLatest = ref(false);
const showAll = ref(false);

const people = computed(() => access.principals.value.filter((p) => p.kind === 'user' || p.kind === 'client'));
const groupsToAdd = computed(() =>
  access.principals.value.filter((p) => p.kind === 'group' && !groups.value.includes(p.iri)));
const shortName = computed(() => nameOf(user.value ?? '').split('@')[0]);
const total = computed(() => access.graphTotals.get(props.backend.id) ?? null);

const versionOptions = computed(() => [
  { value: 'pinned', label: `Pinned v${props.summary?.pinned?.version ?? '?'}` },
  { value: 'latest', label: `Latest v${props.summary?.latest?.version ?? '?'}` },
]);

watch(() => props.backend.id, () => {
  outcome.value = null;
  baseline.value = null;
  versionChoice.value = 'pinned';
});

function nameOf(iri: string): string {
  if (iri === EVERYONE_IRI) return EVERYONE.rawClaim;
  return access.principals.value.find((p) => p.iri === iri)?.rawClaim ?? iri;
}

function fillGroups() {
  const person = people.value.find((p) => p.iri === user.value);
  groups.value = person?.groups ? [...person.groups] : [];
  groupsFromSignIn.value = Boolean(person?.groups);
}

function removeGroup(group: string) {
  groups.value = groups.value.filter((g) => g !== group);
  groupsFromSignIn.value = false;
}

function addGroup(select: HTMLSelectElement) {
  if (select.value) groups.value = [...groups.value, select.value];
  select.value = '';
  groupsFromSignIn.value = false;
}

async function run(options: { groupsOnly?: boolean } = {}) {
  running.value = true;
  runError.value = null;
  showAll.value = false;
  const subject = { ...(user.value && !options.groupsOnly ? { user: user.value } : {}), groups: groups.value };
  const latest = versionChoice.value === 'latest' && props.summary?.latest && props.summary.policy
    ? { queryVersion: props.summary.latest.id, policyBackend: props.summary.policy.backend }
    : null;
  try {
    void access.graphTotal(props.backend.id);
    const [result, pinned] = await Promise.all([
      api.testGraphPolicy(props.backend.id, { ...subject, ...(latest ?? {}) }),
      latest ? api.testGraphPolicy(props.backend.id, subject) : Promise.resolve(null),
    ]);
    outcome.value = result;
    baseline.value = pinned;
    testedLatest.value = Boolean(latest);
  } catch (error) {
    runError.value = error instanceof Error ? error.message : String(error);
  } finally {
    running.value = false;
  }
}

/** Test `person` as they last signed in, or whoever is set when none is given, from another part of the screen. */
function testPerson(person?: string | null, version: 'pinned' | 'latest' = 'pinned') {
  if (person !== undefined && person !== user.value) {
    user.value = person;
    fillGroups();
  }
  versionChoice.value = version;
  void run();
}

defineExpose({ testPerson });

const queryLevel = computed(() => levelOf(outcome.value?.modes ?? [], 'query'));
const updateLevel = computed(() => levelOf(outcome.value?.modes ?? [], 'update'));
const viaLine = computed(() => (outcome.value?.via ?? []).map(nameOf).join(', '));

const graphs = computed(() => graphsOf(outcome.value));

const diff = computed(() => {
  if (!baseline.value || baseline.value.error || outcome.value?.error) return null;
  const before = new Set(graphsOf(baseline.value));
  const after = new Set(graphs.value);
  return {
    added: [...after].filter((g) => !before.has(g)),
    removed: [...before].filter((g) => !after.has(g)),
  };
});

const rows = computed(() => {
  const result = outcome.value;
  if (!result || result.admin || result.error || !result.policy) return [];
  const defaults = new Set(result.defaultGraphs ?? []);
  const named = new Set(result.namedGraphs ?? []);
  const added = new Set(diff.value?.added ?? []);
  const kept = graphs.value.map((iri) => ({
    iri,
    asDefault: defaults.has(iri),
    asNamed: named.has(iri),
    change: added.has(iri) ? 'new' : '',
  }));
  const gone = (diff.value?.removed ?? []).map((iri) => ({ iri, asDefault: false, asNamed: false, change: 'gone' }));
  // What changed first: that is what the comparison is for.
  return [...kept.filter((r) => r.change), ...gone, ...kept.filter((r) => !r.change)];
});

const shownRows = computed(() => (showAll.value ? rows.value : rows.value.slice(0, SHOWN_ROWS)));
const hiddenCount = computed(() => rows.value.length - shownRows.value.length);
</script>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-panel);
  background: var(--surface);
}

.form {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  padding: var(--space-5);
  border-bottom: 1px solid var(--border-subtle);
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.form-label {
  color: var(--ink-muted);
  font-size: var(--text-label);
  font-weight: var(--weight-semibold);
}

.form-hint {
  font-weight: normal;
}

.field-sm {
  height: var(--control-h);
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink);
  font-size: var(--text-body);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.chip-x {
  display: inline-flex;
  padding: 0;
  margin-left: var(--space-1);
  border: 0;
  background: none;
  color: var(--ink-muted);
  cursor: pointer;
}

.chip-add {
  height: 20px;
  padding: 0 var(--space-2);
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-full);
  background: var(--surface);
  color: var(--ink-muted);
  font-size: var(--text-label);
}

.run-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.run {
  margin-left: auto;
}

.result {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-5);
}

.badges {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.outcome-title {
  margin: 0;
  color: var(--ink);
  font-size: var(--text-body-lg);
  font-weight: var(--weight-semibold);
}

.count-row {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
}

.count {
  color: var(--ink);
  font-size: var(--text-heading);
  font-weight: var(--weight-semibold);
}

.graph-rows {
  border-top: 1px solid var(--border-subtle);
}

.g-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-5);
  border-bottom: 1px solid var(--border-subtle);
  font-family: var(--font-mono);
  font-size: var(--text-label);
}

.g-row.new {
  background: var(--success-surface);
}

.g-row.gone {
  background: var(--danger-surface);
}

.g-iri {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--ink);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.g-row.gone .g-iri {
  color: var(--danger-ink);
  text-decoration: line-through;
}

.pre {
  color: var(--ink-muted);
}

.graph-foot {
  display: flex;
  justify-content: space-between;
  padding: var(--space-4) var(--space-5);
}

.link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--action);
  font-size: var(--text-label);
  cursor: pointer;
}

.error {
  margin: 0;
  color: var(--danger-ink);
  font-size: var(--text-body);
}

.pad {
  padding: var(--space-5) var(--space-5) 0;
}
</style>
