<script setup lang="ts">
/**
 * The case editor — the middle column of the Plan tab (§7.2, mockup 2a).
 *
 * The API stores a case as a pointer to a library query version and nothing
 * else. The subject, its version, its query text and the measured p95 per
 * backend are read from the server. The design's per-case intent sentence and
 * per-backend support status have no API field, so this editor does not draw
 * them.
 */
import { computed } from 'vue';
import { Link, ShieldCheck, TriangleAlert } from '@lucide/vue';
import InlineNote from '../shared/InlineNote.vue';
import SearchSelect from '../shared/SearchSelect.vue';
import Select from '../ui/select/Select.vue';
import SelectContent from '../ui/select/SelectContent.vue';
import SelectItem from '../ui/select/SelectItem.vue';
import SelectTrigger from '../ui/select/SelectTrigger.vue';
import SelectValue from '../ui/select/SelectValue.vue';
import { formatCount, formatMs, type PlanCase, type SubjectKind } from '../../lib/benchmarkPlan';
import type { GraphCostRow, SupportRow } from '../../lib/benchmarkViews';

const props = defineProps<{
  planCase: PlanCase;
  /** Editable only while the version is a draft — a frozen version is history. */
  editable: boolean;
  subjectOptions: { id: string; name: string }[];
  groupOptions: { id: string; name: string }[];
  ruleSetOptions: { id: string; name: string }[];
  /** False with the rules suite off, which removes the kind rather than
   *  offering one whose library cannot be read. */
  ruleSetsEnabled: boolean;
  versionOptions: { id: string; version: number; immutable?: boolean }[];
  support: SupportRow[];
  /** The graph axis's costs, for a rule-set case. Empty for every other kind. */
  graphSupport: GraphCostRow[];
  queryString: string | null;
  queryLoading: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:subjectType', value: SubjectKind): void;
  (e: 'update:subjectId', value: string | null): void;
  (e: 'update:versionId', value: string | null): void;
  (e: 'remove'): void;
}>();

const options = computed(() => {
  if (props.planCase.subjectType === 'query') return props.subjectOptions;
  if (props.planCase.subjectType === 'queryGroup') return props.groupOptions;
  return props.ruleSetOptions;
});

/**
 * A rule set is the one subject kind with no store axis, so the support
 * matrix — one row per backend, "how this store answers it" — has nothing to
 * say about it. Drawing four rows of a comparison that will never be made
 * would be worse than saying why there is none.
 */
const isRuleSet = computed(() => props.planCase.subjectType === 'ruleSet');

const subjectSelectOptions = computed(() =>
  options.value.map((option) => ({ value: option.id, label: option.name })),
);

const subjectPlaceholder = computed(() => {
  if (props.planCase.subjectType === 'query') return 'Pick a library query';
  if (props.planCase.subjectType === 'queryGroup') return 'Pick a query group';
  return 'Pick a rule set';
});

const anyMeasured = computed(() => props.support.some((row) => row.p95Ms != null));
const anyGraphMeasured = computed(() => props.graphSupport.some((row) => row.p95Ms != null));

/*
 * The pass column is off until some graph has passes to put in it: a run
 * recorded before the iteration table existed has timings and no passes, and a
 * column of em-dashes claims a measurement that was never taken.
 */
const anyGraphPaced = computed(() =>
  props.graphSupport.some((row) => row.passes != null || row.passesVary));

const failedRows = computed(() => props.support.filter((row) => row.failed > 0));
</script>

<template>
  <div class="case-editor" data-testid="benchmark-case-editor">
    <section class="block">
      <span class="block-label">Subject</span>
      <div class="subject-row">
        <Select
          :model-value="planCase.subjectType"
          :disabled="!editable"
          @update:model-value="(value) => emit('update:subjectType', value as SubjectKind)"
        >
          <SelectTrigger class="control control-type">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="query">Query</SelectItem>
            <SelectItem value="queryGroup">Query group</SelectItem>
            <SelectItem v-if="ruleSetsEnabled" value="ruleSet">Rule set</SelectItem>
          </SelectContent>
        </Select>

        <!--
          The kind beside it is three fixed choices and stays a list; the
          subject is one of a library's hand-named entities, so it is typed at.
        -->
        <SearchSelect
          class="control-grow"
          test-id="benchmark-case-subject"
          aria-label="Subject"
          :placeholder="subjectPlaceholder"
          :disabled="!editable"
          :model-value="planCase.subjectId ?? null"
          :options="subjectSelectOptions"
          @update:model-value="(value) => emit('update:subjectId', value || null)"
        />

        <Select
          :model-value="planCase.versionId ?? undefined"
          :disabled="!editable || versionOptions.length === 0"
          @update:model-value="(value) => emit('update:versionId', (value as string) ?? null)"
        >
          <SelectTrigger class="control control-version">
            <SelectValue placeholder="Version" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="version in versionOptions" :key="version.id" :value="version.id">
              v{{ version.version }}{{ version.immutable ? ' (frozen)' : '' }}
            </SelectItem>
          </SelectContent>
        </Select>

        <button v-if="editable" class="ghost-button" data-testid="benchmark-remove-case" @click="emit('remove')">
          Remove
        </button>
      </div>
    </section>

    <section v-if="isRuleSet" class="block">
      <div class="block-head">
        <span class="block-label">Support</span>
        <span class="block-sub">no store axis</span>
      </div>
      <InlineNote>
        A rule set evaluates in-process, so it has no backends. Its axes are
        tuple sets and data graphs.
      </InlineNote>

      <!--
        The comparison a rule set does have. One row per graph on the axis, so a
        graph added since the last run reads run rather than being
        left out of the table it belongs in.
      -->
      <div v-if="graphSupport.length > 0" class="support-table" data-testid="benchmark-graph-costs">
        <div v-for="row in graphSupport" :key="row.dataGraphId" class="support-row">
          <span class="support-name">{{ row.name }}</span>
          <InlineNote as="span" class="support-note">
            <template v-if="row.triplesVary">output size varies between repeats</template>
            <template v-else-if="row.triples != null">{{ formatCount(row.triples) }} triples inferred</template>
            <template v-else>no output recorded</template>
          </InlineNote>
          <!--
            The pass count sits between the output size and the timing because
            it is what joins them: the same rule set needing four passes over
            one graph and eleven over another is the finding the graph axis
            exists to produce.
          -->
          <span v-if="anyGraphPaced" class="support-passes" data-testid="benchmark-graph-passes">
            <template v-if="row.passesVary">passes vary</template>
            <template v-else-if="row.passes != null">{{ row.passes }} pass{{ row.passes === 1 ? '' : 'es' }}</template>
            <template v-else>—</template>
          </span>
          <span class="support-samples">
            {{ row.samples > 0 ? `${row.samples} run${row.samples === 1 ? '' : 's'}` : 'never run' }}
          </span>
          <span class="support-p95" :class="{ 'support-failed': row.failed > 0 }">
            {{ row.p95Ms == null ? '—' : formatMs(row.p95Ms) }}
          </span>
        </div>
      </div>

      <InlineNote v-if="anyGraphMeasured">p95 from the most recent run.</InlineNote>
    </section>

    <section v-else class="block">
      <div class="block-head">
        <span class="block-label">Support</span>
        <span class="block-sub">how each store answers it</span>
      </div>

      <div v-if="support.length > 0" class="support-table">
        <div v-for="row in support" :key="row.backendId" class="support-row">
          <span class="support-name">
            <span class="support-dot" :style="{ background: row.dot }" />
            {{ row.name }}
          </span>
          <span class="support-samples">
            {{ row.samples > 0 ? `${row.samples} req` : 'never run' }}
          </span>
          <span class="support-p95" :class="{ 'support-failed': row.failed > 0 }">
            {{ row.p95Ms == null ? '—' : formatMs(row.p95Ms) }}
          </span>
        </div>
      </div>
      <InlineNote v-else>Add a backend on the Backends axis.</InlineNote>

      <InlineNote v-if="anyMeasured">p95 from the most recent run.</InlineNote>
    </section>

    <section class="block block-grow">
      <div class="block-head">
        <span class="block-label">Implementation</span>
        <span v-if="isRuleSet" class="chip chip-flat">SRL</span>
        <InlineNote v-if="planCase.versionId" as="span" class="link-note">
          <Link :size="12" />
          linked to
          <span class="link-target">
            {{ planCase.subjectName ?? (isRuleSet ? 'library rule set' : 'library query') }}
            <template v-if="planCase.versionNumber"> v{{ planCase.versionNumber }}</template>
          </span>
        </InlineNote>
      </div>
      <pre v-if="queryString" class="code-block">{{ queryString }}</pre>
      <InlineNote v-else-if="queryLoading">
        Loading the {{ isRuleSet ? 'rule set' : 'query' }}…
      </InlineNote>
      <InlineNote v-else>
        Pick a {{ isRuleSet ? 'rule set' : 'query' }} and a version to see what will be
        {{ isRuleSet ? 'evaluated' : 'sent' }}.
      </InlineNote>
    </section>

    <!--
      The design's amber strip is an equivalence warning: "9 of 12 rows against
      the reference". Nothing hashes result sets yet, so the only honest version
      of this strip is the failure count the runner does record.
    -->
    <div v-if="!isRuleSet && failedRows.length > 0" class="warning-strip">
      <TriangleAlert :size="14" class="warning-icon" />
      <span class="warning-text">
        Last run: {{ failedRows.map((r) => `${r.failed} failed on ${r.name}`).join(', ') }}.
        Failed requests are not in the timings.
      </span>
    </div>
    <div v-else-if="!isRuleSet && support.length > 1" class="info-strip">
      <ShieldCheck :size="14" class="info-icon" />
      <span class="info-text">
        Results are not compared across stores, so a faster store may have
        returned different rows.
      </span>
    </div>
  </div>
</template>

<style scoped>
.case-editor {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-6);
  min-height: 0;
  padding: var(--space-5);
  overflow: auto;
}

.block {
  display: flex;
  flex-direction: column;
  gap: 7px;
  flex-shrink: 0;
}

.block-grow {
  flex: 1;
  min-height: 160px;
}

.block-head {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.block-label {
  color: var(--ink);
  font-size: var(--text-label);
  font-weight: var(--weight-semibold);
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.block-sub {
  color: var(--ink-muted);
  font-size: var(--text-label);
  line-height: var(--leading-normal);
}

.subject-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.control {
  height: var(--control-h);
  font-size: var(--text-body);
}

.control-type {
  width: 120px;
}

.control-grow {
  flex: 1;
  min-width: 0;
}

.control-version {
  width: 132px;
}

.ghost-button {
  height: var(--control-h);
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink-secondary);
  font-family: inherit;
  font-size: var(--text-body);
  cursor: pointer;
}

.ghost-button:hover {
  border-color: var(--border-strong);
  color: var(--ink);
}



.chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  height: 20px;
  padding: 0 var(--space-4);
  border-radius: var(--radius-full);
  font-size: var(--text-label);
  font-weight: var(--weight-semibold);
  white-space: nowrap;
}


.chip-flat {
  background: var(--surface-raised);
  color: var(--ink-secondary);
  font-weight: var(--weight-normal);
}

/* The row it sits in, not the type: the note is pushed to the far end. */
.link-note {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  margin-left: auto;
}

.link-target {
  color: var(--action);
}

.support-table {
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
}

.support-row {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: var(--space-4) var(--space-5);
  background: var(--surface);
  border-bottom: 1px solid var(--surface-sunken);
}

.support-row:last-child {
  border-bottom: none;
}

.support-name {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-shrink: 0;
  width: 132px;
  color: var(--ink);
  font-size: var(--text-body);
  font-weight: var(--weight-medium);
  white-space: nowrap;
}

.support-dot {
  flex-shrink: 0;
  width: 7px;
  height: 7px;
  border-radius: var(--radius-sm);
}



/* The cell's share of the row and its truncation, not the note's type. */
.support-note {
  flex: 1;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.support-passes {
  flex-shrink: 0;
  color: var(--ink-secondary);
  font-size: var(--text-label);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.support-samples {
  flex-shrink: 0;
  /* Right-aligns the count and p95 on a query row, which has no note to fill the gap. */
  margin-left: auto;
  color: var(--ink-muted);
  font-size: var(--text-label);
  white-space: nowrap;
}

.support-p95 {
  flex-shrink: 0;
  width: 62px;
  color: var(--ink-secondary);
  font-size: var(--text-body);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.support-failed {
  color: var(--warning-ink);
}

.code-block {
  flex: 1;
  box-sizing: border-box;
  min-height: 0;
  margin: 0;
  padding: var(--space-5);
  overflow: auto;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: var(--surface-subtle);
  color: var(--ink);
  font-family: var(--font-mono);
  font-size: var(--text-body);
  line-height: 1.7;
  white-space: pre;
}

.warning-strip,
.info-strip {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  flex-shrink: 0;
  padding: var(--space-4);
  border-radius: var(--radius-panel);
}

.warning-strip {
  background: var(--warning-surface);
  border: 1px solid var(--warning-border);
}

.info-strip {
  background: var(--surface-subtle);
  border: 1px solid var(--border-subtle);
}

.warning-icon {
  flex-shrink: 0;
  color: var(--warning-ink);
}

.info-icon {
  flex-shrink: 0;
  color: var(--ink-muted);
}

.warning-text {
  color: var(--warning-ink);
  font-size: var(--text-label);
  line-height: var(--leading-normal);
}

.info-text {
  color: var(--ink-muted);
  font-size: var(--text-label);
  line-height: var(--leading-normal);
}
</style>
