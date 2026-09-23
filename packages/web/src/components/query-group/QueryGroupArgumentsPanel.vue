<template>
  <div class="arguments-tab">
    <div class="arguments-content">
      <!--
        The same three-part body the query screen's Arguments tab has: identity
        and what-runs at the top, values in the middle, Discard / Save at the
        bottom. A group's signature is its start-node input tuples rather than
        detected VALUES clauses, and that is the only difference — everything
        below is the same components over the same composable.
      -->
      <ArgumentSetSwitcher
        :display-name="switcherName"
        :state-label="args.stateLabel.value"
        :is-scratch="args.isScratch.value"
        :has-draft="args.hasDraft.value"
        :has-selection="hasSelection"
        :edit-count="args.editCount.value"
        :draft-saved-at="args.draftSavedAt.value"
        :scratch-sets="scratchEntries"
        :saved-sets="savedEntries"
        :versions="args.versionsNewestFirst.value"
        :run-target="args.runTarget.value"
        :can-delete="!!args.selectedSetId.value"
        :can-copy="hasSelection"
        :disabled="args.isLoading.value"
        @select-set="handleSelectArgumentSet"
        @select-scratch="args.selectScratch"
        @create-scratch="args.createScratch()"
        @run-with="args.runWith"
        @rename="handleRename"
        @copy="handleCopyExecutionPayload"
        @delete="handleDeleteArgumentSet"
      />

      <template v-if="hasSelection">
        <TupleBindingEditor
          v-for="(clause, index) in signature.clauses"
          :key="`clause-${index}-${clause.variables.join('|')}`"
          :variables="clause.variables"
          :model-value="bindingForClause(clause.variables)"
          @update:model-value="(value) => handleClauseChange(clause.variables, value)"
        />

        <p class="signature-verdict" :class="`signature-verdict--${verdict.verdict}`">
          <template v-if="verdict.verdict === 'fits'">matches the group signature</template>
          <template v-else>{{ verdict.reason }}</template>
        </p>
      </template>

      <EmptyState
        v-else-if="signature.clauses.length === 0"
        size="sm"
        title="This group takes no arguments"
        description="Add input tuples to the start node to give it a signature."
      />

      <EmptyState
        v-else
        size="sm"
        title="No argument set open"
        description="Pick one, or start a scratch set."
      />

      <!--
        The numbers, where the group's members declare any. Absent rather than
        empty when they declare none, the same rule every other slot follows.
      -->
      <ArgumentScalarsPanel
        v-if="hasSelection && (limitParameters.length || offsetParameters.length)"
        :limit-parameters="limitParameters"
        :offset-parameters="offsetParameters"
        :model-value="args.scalarBindings.value"
        @update:model-value="handleScalarsChange"
      />

      <!--
        The group's other external input. A start node declares tuple inputs and
        data graph inputs as separate slots, so this stands beside the argument
        set above rather than competing with it: a run can carry both. The
        section is absent, not empty, when the group declares no data graph —
        the same rule the test screen follows for a slot that cannot apply.
      -->
      <div v-if="dataGraphPorts.length" class="data-graph-inputs">
        <p class="data-graph-title">Data graphs</p>
        <div v-for="(port, slot) in dataGraphPorts" :key="port.id" class="data-graph-row">
          <span class="data-graph-name">{{ port.label }}</span>
          <SearchSelect
            class="data-graph-select"
            test-id="group-data-graph"
            placeholder="No data graph"
            empty-label="No data graph"
            :aria-label="`Data graph for ${port.label}`"
            :model-value="graphForSlot(slot) || null"
            :options="dataGraphSelectOptions"
            @update:model-value="(versionId) => setGraphForSlot(slot, versionId || null)"
          />
        </div>
        <InlineNote v-if="dataGraphOptions.length === 0" size="xs">
          No saved data graph in this library yet.
        </InlineNote>
      </div>

      <!-- Whatever else the group screen puts on Arguments — today, the
           canvas validation issues, which belong to the run and not to a set. -->
      <slot />
    </div>

    <ArgumentSetFooter
      :dirty="args.hasDraft.value"
      :scratch="args.isScratch.value"
      :next-version="args.nextVersionNumber.value"
      :can-save="args.name.value.trim().length > 0"
      :busy="args.isLoading.value"
      @discard="args.discard"
      @save="handleSave"
    />

    <!--
      Delete asks here rather than through `window.confirm`: a browser that has
      been told to stop showing dialogs answers one `false`, so the menu item
      silently did nothing.
    -->
    <AlertDialog v-model:open="deleteConfirmOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this argument set?</AlertDialogTitle>
          <AlertDialogDescription>
            Every version of it goes with it. A test or a call that pins one of those
            versions loses what it was pinned to.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction
            data-testid="confirm-delete-argument-set"
            @click="confirmDeleteArgumentSet"
          >Delete set</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, toRef } from 'vue';
import { toast } from 'vue-sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';
import ArgumentSetSwitcher, { type SwitcherEntry } from '../query-work-area/ArgumentSetSwitcher.vue';
import ArgumentSetFooter from '../query-work-area/ArgumentSetFooter.vue';
import TupleBindingEditor from '../query-work-area/TupleBindingEditor.vue';
import ArgumentScalarsPanel from '../query-work-area/ArgumentScalarsPanel.vue';
import EmptyState from '../shared/EmptyState.vue';
import SearchSelect from '../shared/SearchSelect.vue';
import { useArgumentSets } from '@/composables/useArgumentSets';
import { useApiClient } from '@/composables/useApiClient';
import {
  buildQuerySignature,
  clauseKey,
  compatibility,
  tupleSignature,
} from '@/lib/argumentSignature';
import type { ArgumentScalarBinding, ArgumentTupleBinding } from '@/types/argument-sets';
import type { TupleDefinition } from '@/types/tuple-editor';
import type { DataGraphOption } from '@/types/data-graphs';
import InlineNote from '../shared/InlineNote.vue';

type ArgumentSetsComposable = ReturnType<typeof useArgumentSets>;

const props = withDefaults(defineProps<{
  groupId: string | null;
  startTuples: TupleDefinition[];
  /**
   * The work area passes its own composable so Execute and this panel agree on
   * what runs; a standalone mount makes one of its own. Same contract as the
   * query screen's Arguments tab.
   */
  argumentSetsComposable?: ArgumentSetsComposable | null;
  /**
   * The LIMIT / OFFSET names this group accepts: the union of what its member
   * queries declare, computed server-side and served on the version detail so
   * the fields offered here and the names the route accepts cannot disagree.
   */
  limitParameters?: string[];
  offsetParameters?: string[];
  /** The data graph inputs the group's start node declares, if any. */
  dataGraphPorts?: Array<{ id: string; label: string }>;
  /** Saved graphs offered for those slots. */
  dataGraphOptions?: DataGraphOption[];
}>(), {
  limitParameters: () => [],
  offsetParameters: () => [],
  dataGraphPorts: () => [],
  dataGraphOptions: () => [],
});

const groupIdRef = toRef(props, 'groupId');
const args = props.argumentSetsComposable ?? useArgumentSets(groupIdRef, 'queryGroup');
const apiClient = useApiClient();

const hasSelection = computed(() => args.selection.value.kind !== 'none');

/*
 * The picker writes into the open argument set rather than into run-local
 * state beside it. This is the point of the split: the group knows its ports
 * and their order, the set carries the graphs in that order, and a run or a
 * test is then one pinned object instead of a set plus a loose graph. See
 * `docs/concepts.md`.
 *
 * Slots are dense — the Nth port takes the Nth graph — so a port left empty
 * holds its place with a binding that names no graph. Those are dropped on
 * the way to a run, which is what "this port is left open" means.
 */
const graphForSlot = (slot: number): string =>
  args.graphBindings.value[slot]?.dataGraphVersionId ?? '';

function setGraphForSlot(slot: number, versionId: string | null) {
  const next = [...args.graphBindings.value];
  while (next.length <= slot) next.push({ dataGraphVersionId: null });
  next[slot] = { ...next[slot], dataGraphVersionId: versionId };
  // Trailing empties carry no meaning and would save as graphs that fill
  // nothing, so the list ends at the last port a graph was chosen for.
  while (next.length && !next[next.length - 1]?.dataGraphVersionId) next.pop();
  args.graphBindings.value = next;
  args.persistLocal();
}

/*
 * One row per saved graph, named the way the Data screen names them. Fuzzy
 * rather than native because a library's graphs are many and hand-named: the
 * detail suffix is what tells two versions of one graph apart, and it also
 * makes each row too long to scan a list of.
 */
const dataGraphSelectOptions = computed(() =>
  props.dataGraphOptions.map((option) => ({
    value: option.versionId,
    label: `${option.name} (v${option.version}) — ${option.detail}`,
  })),
);

const variableNamesFor = (tuple: TupleDefinition): string[] =>
  (tuple.variables ?? [])
    .map((variable) => (variable?.name ?? '').replace(/^\?/, ''))
    .filter((name) => name.length > 0);

/**
 * What the group asks for. A group declares its tabular inputs on the start
 * node, so that half is built from those rather than from query-text detection
 * — but it is the same `QuerySignature`, so the same compatibility rules and
 * the same editors apply.
 *
 * The numbers are not declared on the start node, because a table has to be
 * routed to a port and a named number routes itself: a value for `10` reaches
 * every member query whose text says `LIMIT 00010`. So they arrive as the
 * union the server computed. This used to read "groups name no LIMIT / OFFSET
 * parameters", which was true only because the route refused them.
 */
const signature = computed(() =>
  buildQuerySignature({
    valuesInputs: props.startTuples.map(variableNamesFor),
    limitParameters: props.limitParameters,
    offsetParameters: props.offsetParameters,
  }),
);

const verdict = computed(() => compatibility(signature.value, args.tupleBindings.value));

const switcherName = computed(() => {
  if (!hasSelection.value) return 'No argument set';
  return args.name.value || 'Untitled set';
});

const scratchEntries = computed<SwitcherEntry[]>(() =>
  args.scratchSets.value.map((entry) => ({
    id: entry.id,
    name: entry.name || 'Untitled set',
    meta: entry.edits > 0 ? `${entry.edits} edits` : 'never saved',
  })),
);

const savedEntries = computed<SwitcherEntry[]>(() =>
  args.argumentSets.value.map((set) => {
    const version = set.currentVersion?.version;
    const fit = compatibility(
      signature.value,
      set.currentVersion?.tupleBindings ?? set.tupleBindings ?? [],
    );
    const parts = [version ? `v${version}` : 'no version'];
    if (fit.verdict !== 'fits') parts.push(fit.reason || fit.verdict);
    return { id: set.id, name: set.name, meta: parts.join(' · ') };
  }),
);

/** Matched on the variable set rather than on position; see QueryResultsPanel. */
function bindingForClause(variables: string[]): ArgumentTupleBinding {
  const key = clauseKey(variables);
  const found = args.tupleBindings.value.find(
    (binding) => clauseKey(binding.variables ?? binding.tupleSignature.split('|')) === key,
  );
  return found ?? { tupleSignature: tupleSignature(variables), variables, rows: [] };
}

function handleClauseChange(variables: string[], value: ArgumentTupleBinding) {
  const key = clauseKey(variables);
  const next = args.tupleBindings.value.filter(
    (binding) => clauseKey(binding.variables ?? binding.tupleSignature.split('|')) !== key,
  );
  next.push(value);
  args.tupleBindings.value = next;
  args.persistLocal();
}

function handleScalarsChange(value: ArgumentScalarBinding[]) {
  args.scalarBindings.value = value;
  args.persistLocal();
}

async function handleSelectArgumentSet(setId: string) {
  await args.selectSet(setId);
}

/*
 * The app's own dialog rather than `window.confirm`. A browser stops showing
 * those once someone ticks "prevent this page from creating more dialogs", and
 * a suppressed confirm answers `false` — so Delete set silently did nothing,
 * which is the same fault the rename prompt had.
 */
const deleteConfirmOpen = ref(false)

function handleDeleteArgumentSet() {
  if (!args.selectedSetId.value) return;
  deleteConfirmOpen.value = true;
}

async function confirmDeleteArgumentSet() {
  const setId = args.selectedSetId.value;
  deleteConfirmOpen.value = false;
  if (!setId) return;
  const deleted = await args.deleteSet(setId);
  if (deleted) toast.success('Argument set deleted');
  else if (args.error.value) toast.error(args.error.value);
}

/*
 * The switcher edits the name in place and hands over the result.
 *
 * On a saved set this is a write, not a local edit — a name lives on the
 * entity, so it lands without a version — and a failed write has to say so
 * rather than leaving the new name on screen unexplained.
 */
async function handleRename(name: string) {
  const renamed = await args.rename(name);
  if (!renamed && args.error.value) toast.error(args.error.value);
}

async function handleSave() {
  const version = args.nextVersionNumber.value;
  const saved = await args.save();
  if (saved) toast.success(`Saved v${version}`);
  else if (args.error.value) toast.error(args.error.value);
}

async function handleCopyExecutionPayload() {
  try {
    const versionId = args.executionArgumentSetId.value;
    const payload = versionId
      ? await apiClient.exportArgumentSetPayload(versionId)
      : args.inlineExecutionPayload();

    if (!payload) {
      toast.error('Nothing to copy');
      return;
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    }
    toast.success('Execution payload copied');
  } catch (error) {
    console.error('[QueryGroupArgumentsPanel] Failed to copy execution payload', error);
    toast.error('Failed to copy execution payload');
  }
}

defineExpose({
  getExecutionArgumentSetId: () => args.executionArgumentSetId.value,
  getInlineArguments: () => args.inlineExecutionPayload(),
  /**
   * The run's graphs, in slot order, with the ports left open dropped.
   *
   * Sent inline beside a named set only where the run target is the draft; a
   * saved version is exported server-side and already carries them.
   */
  getInlineDataGraphs: () => args.graphBindings.value
    .map((binding) => binding.dataGraphVersionId)
    .filter((versionId): versionId is string => !!versionId)
    .map((dataGraphVersionId) => ({ dataGraphVersionId })),
});
</script>

<style scoped>
/* The tab shell — padding, scroll, footer placement — matches the query
   screen's Arguments tab; only the signature above it is group-shaped. */
.arguments-tab {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.arguments-content {
  flex: 1;
  padding: var(--space-5) var(--space-6);
  overflow-y: auto;
  background: var(--surface);
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.signature-verdict {
  margin: 0;
  font-size: var(--text-micro);
  color: var(--ink-muted);
}

.data-graph-inputs {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.data-graph-title {
  margin: 0;
  font-size: var(--text-micro);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ink-muted);
}

.data-graph-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  justify-content: space-between;
}

.data-graph-name {
  font-size: var(--text-content);
  color: var(--ink-secondary);
}

.data-graph-select {
  flex: 1;
  min-width: 0;
}

.signature-verdict--partial {
  color: var(--warning-ink);
}

.signature-verdict--mismatch {
  color: var(--danger-ink);
}
</style>
