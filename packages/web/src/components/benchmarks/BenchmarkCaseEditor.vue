<script setup lang="ts">
/**
 * The case editor — the middle column of the Plan tab (§7.2, mockup 2a).
 *
 * The API stores a case as a pointer to a library query version and nothing
 * else, so the editor shows the subject, its version, its query text and the
 * measured p95 per backend. The design's intent, per-backend support status and
 * per-backend implementation have nowhere to be saved, so they are not drawn.
 */
import { computed, ref, watch } from 'vue';
import {
  ArrowUpRight, FileCode2, Lock, PenLine, Scale, Shuffle, TriangleAlert, Workflow,
} from '@lucide/vue';
import InfoHint from '../shared/InfoHint.vue';
import MediaTypeCodeViewer from '../MediaTypeCodeViewer.vue';
import InlineNote from '../shared/InlineNote.vue';
import SearchSelect from '../shared/SearchSelect.vue';
import Select from '../ui/select/Select.vue';
import SelectContent from '../ui/select/SelectContent.vue';
import SelectItem from '../ui/select/SelectItem.vue';
import SelectTrigger from '../ui/select/SelectTrigger.vue';
import SelectValue from '../ui/select/SelectValue.vue';
import { formatCount, formatMs, type PlanCase, type SubjectKind } from '../../lib/benchmarkPlan';
import type { GraphCostRow, SupportRow } from '../../lib/benchmarkViews';
import type { GroupNodeCostRow, GroupNodeKind } from '../../lib/benchmarkGroupNodes';

/** A NuxtLink target: a path, or a path with a query. */
export type EntityLink = string | { path: string; query: Record<string, string> };

/** A group node row with its backend's display name and series colour. */
export type GroupNodeView = GroupNodeCostRow & {
  backendName: string | null;
  dot: string | null;
  /** Where the node's query opens. Null for rule set and dynamic nodes. */
  link: EntityLink | null;
};

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
  /** Where the case's query, group or rule set opens. Null until one is picked. */
  targetLink: EntityLink | null;
  /** The execution nodes of a group case, in run order. Empty for other kinds. */
  groupNodes: GroupNodeView[];
  groupNodesLoading: boolean;
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


/*
 * The pass column is off until some graph has passes to put in it: a run
 * recorded before the iteration table existed has timings and no passes, and a
 * column of em-dashes claims a measurement that was never taken.
 */
const anyGraphPaced = computed(() =>
  props.graphSupport.some((row) => row.passes != null || row.passesVary));

const failedRows = computed(() => props.support.filter((row) => row.failed > 0));

const isGroup = computed(() => props.planCase.subjectType === 'queryGroup');

const KIND_ICON = {
  query: FileCode2,
  queryGroup: Workflow,
  ruleSet: Scale,
} as const;

const NODE_ICON: Record<GroupNodeKind, unknown> = {
  query: FileCode2,
  dynamic: Shuffle,
  ruleset: Scale,
  patch: PenLine,
};

const OPEN_LABEL = {
  query: 'Open query',
  queryGroup: 'Open group',
  ruleSet: 'Open rule set',
} as const;

/*
 * The group node whose text the code block shows. The first node with text is
 * picked when the case or its version changes.
 */
const selectedNodeId = ref<string | null>(null);
watch(
  () => [props.planCase.versionId, props.groupNodes.map((node) => node.nodeId).join(' ')],
  () => {
    if (props.groupNodes.some((node) => node.nodeId === selectedNodeId.value)) return;
    selectedNodeId.value = props.groupNodes.find((node) => node.queryString)?.nodeId ?? null;
  },
  { immediate: true },
);
const selectedNode = computed(() =>
  props.groupNodes.find((node) => node.nodeId === selectedNodeId.value) ?? null);

const failedNodes = computed(() => props.groupNodes.filter((node) => node.failed > 0));
</script>

<template>
  <div class="case-editor" data-testid="benchmark-case-editor">
    <section class="block">
      <span class="block-label">Target</span>
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
          aria-label="Target"
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
        <span class="block-label">
          Data graphs
          <InfoHint label="data graphs">
            p95 from the latest run. The inferred triple count should be the same for every repeat.
          </InfoHint>
        </span>
      </div>

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

    </section>

    <section v-else-if="isGroup" class="block">
      <div class="block-head">
        <span class="block-label">
          Nodes
          <span v-if="groupNodes.length > 0" class="block-count">{{ groupNodes.length }}</span>
        </span>
      </div>

      <div v-if="groupNodes.length > 0" class="node-table" data-testid="benchmark-group-nodes">
        <div class="node-row node-row-head">
          <span />
          <span />
          <span>Node</span>
          <span class="node-backend-head">
            Backend
            <span class="lock-icon" title="Set by the group"><Lock :size="11" /></span>
          </span>
          <span>Runs</span>
          <span class="node-p95">p95</span>
        </div>
        <button
          v-for="node in groupNodes"
          :key="node.nodeId"
          type="button"
          class="node-row"
          :class="{ selected: node.nodeId === selectedNodeId }"
          :disabled="!node.queryString"
          data-testid="benchmark-group-node"
          @click="selectedNodeId = node.nodeId"
        >
          <span class="node-order">{{ node.order }}</span>
          <component :is="NODE_ICON[node.kind]" :size="13" class="node-kind" />
          <span class="node-name">
            {{ node.name }}
            <span v-if="node.sourceName || node.sourceVersion" class="node-source">
              {{ node.sourceName ?? '' }}<template v-if="node.sourceVersion">{{ node.sourceName ? ' ' : '' }}v{{ node.sourceVersion }}</template>
            </span>
          </span>
          <span class="node-backend">
            <template v-if="node.target.kind === 'backend'">
              <span class="support-dot" :style="{ background: node.dot ?? 'var(--border-strong)' }" />
              <span class="node-backend-name">{{ node.backendName }}</span>
            </template>
            <span v-else-if="node.target.kind === 'ephemeral'" class="pill">In-memory</span>
            <span v-else-if="node.target.kind === 'inProcess'" class="node-muted">In-process</span>
            <span v-else class="node-missing">No backend</span>
          </span>
          <span class="support-samples">
            {{ node.samples > 0 ? `${node.samples} req` : 'never run' }}
          </span>
          <span class="support-p95 node-p95" :class="{ 'support-failed': node.failed > 0 }">
            {{ node.p95Ms == null ? '—' : formatMs(node.p95Ms) }}
          </span>
        </button>
      </div>
      <InlineNote v-else-if="groupNodesLoading">Loading the group…</InlineNote>
      <InlineNote v-else-if="planCase.versionId">No nodes in this version.</InlineNote>
    </section>

    <section v-else class="block">
      <div class="block-head">
        <span class="block-label">
          Backends
          <InfoHint label="backends">p95 from the latest run.</InfoHint>
        </span>
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
      <InlineNote v-else>No backends named.</InlineNote>

    </section>

    <section v-if="isGroup" class="block block-grow">
      <template v-if="selectedNode">
        <div class="block-head">
          <span class="entity-head" data-testid="benchmark-case-entity">
            <component :is="NODE_ICON[selectedNode.kind]" :size="14" class="entity-icon" />
            {{ selectedNode.name }}
          </span>
          <NuxtLink v-if="selectedNode.link" class="btn-compact open-link" :to="selectedNode.link" data-testid="benchmark-open-node">
            <ArrowUpRight :size="12" />Open query
          </NuxtLink>
        </div>
        <MediaTypeCodeViewer
          v-if="selectedNode.queryString"
          class="code-block"
          data-testid="benchmark-case-query"
          :content="selectedNode.queryString"
          :content-type="selectedNode.kind === 'patch' ? 'application/sparql-update' : 'application/sparql-query'"
          min-height="0"
        />
      </template>
      <InlineNote v-else-if="!planCase.versionId">Pick a query group and a version.</InlineNote>
    </section>

    <section v-else class="block block-grow">
      <div class="block-head">
        <span v-if="planCase.versionId" class="entity-head" data-testid="benchmark-case-entity">
          <component :is="KIND_ICON[planCase.subjectType]" :size="14" class="entity-icon" />
          {{ planCase.subjectName ?? (isRuleSet ? 'Rule set' : 'Query') }}
          <span v-if="planCase.versionNumber" class="entity-version">v{{ planCase.versionNumber }}</span>
        </span>
        <NuxtLink v-if="targetLink" class="btn-compact open-link" :to="targetLink" data-testid="benchmark-open-target">
          <ArrowUpRight :size="12" />{{ OPEN_LABEL[planCase.subjectType] }}
        </NuxtLink>
      </div>
      <MediaTypeCodeViewer
        v-if="queryString"
        class="code-block"
        data-testid="benchmark-case-query"
        :content="queryString"
        :content-type="isRuleSet ? 'application/srl' : 'application/sparql-query'"
        min-height="0"
      />
      <InlineNote v-else-if="queryLoading">
        Loading the {{ isRuleSet ? 'rule set' : 'query' }}…
      </InlineNote>
      <InlineNote v-else>
        Pick a {{ isRuleSet ? 'rule set' : 'query' }} and a version.
      </InlineNote>
    </section>

    <div v-if="isGroup && failedNodes.length > 0" class="warning-strip">
      <TriangleAlert :size="14" class="warning-icon" />
      <span class="warning-text">
        Latest run: {{ failedNodes.map((n) => `${n.failed} failed on ${n.name}`).join(', ') }}.
      </span>
    </div>
    <div v-else-if="!isRuleSet && !isGroup && failedRows.length > 0" class="warning-strip">
      <TriangleAlert :size="14" class="warning-icon" />
      <span class="warning-text">
        Latest run: {{ failedRows.map((r) => `${r.failed} failed on ${r.name}`).join(', ') }}.
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






/* The same link out as the query group Editor tab's "Open query". */
.open-link {
  gap: var(--space-2);
  flex-shrink: 0;
  margin-left: auto;
  text-decoration: none;
  color: var(--ink-secondary);
}

.entity-head {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  color: var(--ink);
  font-size: var(--text-body);
  font-weight: var(--weight-semibold);
}

.entity-icon {
  flex-shrink: 0;
  color: var(--ink-muted);
}

.entity-version {
  color: var(--ink-muted);
  font-weight: var(--weight-regular, 400);
}

.block-count {
  margin-left: var(--space-2);
  color: var(--ink-muted);
  font-weight: var(--weight-medium);
  letter-spacing: 0;
}

.node-table {
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
}

.node-row {
  display: grid;
  grid-template-columns: 18px 14px minmax(0, 1fr) minmax(0, 190px) 64px 62px;
  align-items: center;
  gap: 11px;
  width: 100%;
  padding: var(--space-4) var(--space-5);
  border: none;
  border-bottom: 1px solid var(--surface-sunken);
  background: var(--surface);
  color: var(--ink);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.node-row:last-child {
  border-bottom: none;
}

.node-row:hover:not(:disabled):not(.node-row-head) {
  background: var(--surface-subtle);
}

.node-row:disabled {
  cursor: default;
}

.node-row.selected {
  background: var(--action-surface);
}

.node-row.selected .node-name {
  color: var(--action-ink);
}

.node-row-head {
  padding-top: var(--space-2);
  padding-bottom: var(--space-2);
  background: var(--surface-subtle);
  color: var(--ink-muted);
  font-size: var(--text-micro);
  font-weight: var(--weight-semibold);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  cursor: default;
}

.node-backend-head {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

.lock-icon {
  display: inline-flex;
  color: var(--ink-muted);
  text-transform: none;
}

.node-order {
  color: var(--ink-muted);
  font-size: var(--text-label);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.node-kind {
  color: var(--ink-muted);
}

.node-name {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  font-size: var(--text-body);
  font-weight: var(--weight-medium);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.node-source {
  overflow: hidden;
  color: var(--ink-muted);
  font-size: var(--text-label);
  font-weight: var(--weight-regular, 400);
  text-overflow: ellipsis;
}

.node-backend {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  font-size: var(--text-body);
  white-space: nowrap;
}

.node-backend-name {
  overflow: hidden;
  text-overflow: ellipsis;
}

.node-muted {
  color: var(--ink-muted);
}

.node-missing {
  color: var(--warning-ink);
}

.node-p95 {
  width: auto;
  text-align: right;
}

.pill {
  display: inline-flex;
  align-items: center;
  padding: 0 var(--space-3);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-full, 999px);
  background: var(--surface-subtle);
  color: var(--ink-secondary);
  font-size: var(--text-micro);
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

/*
 * The query is drawn by the same read-only CodeMirror viewer the results use,
 * so it is highlighted the way the query editor highlights it. The block takes
 * the rest of the column and scrolls inside itself.
 */
.code-block {
  flex: 1;
  min-height: 0;
}

.warning-strip {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  flex-shrink: 0;
  padding: var(--space-4);
  border-radius: var(--radius-panel);
  background: var(--warning-surface);
  border: 1px solid var(--warning-border);
}

.warning-icon {
  flex-shrink: 0;
  color: var(--warning-ink);
}


.warning-text {
  color: var(--warning-ink);
  font-size: var(--text-label);
  line-height: var(--leading-normal);
}

</style>
