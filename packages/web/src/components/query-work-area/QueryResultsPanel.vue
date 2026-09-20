<template>
  <InspectorPanel
    v-model:active-tab="activeTab"
    v-model:collapsed="collapsed"
    :tabs="inspectorTabs"
  >
    <!--
      The strip is tabs and nothing else. Pop-out belongs to the thing being
      popped out, so each tab carries its own: the results action bar in
      Results, the set switcher in Arguments.
    -->
    <!-- Details Tab -->
    <template #details>
      <EntityDetailsPanel
        v-if="details"
        ref="detailsPanelRef"
        v-bind="details"
        @update:name="(value) => emit('update:detailsName', value)"
        @update:description="(value) => emit('update:detailsDescription', value)"
        @update:backend="(value) => emit('update:detailsBackend', value)"
        @select-version="(value) => emit('select-version', value)"
        @set-current-version="(value) => emit('set-current-version', value)"
        @select-draft="emit('select-draft')"
        @compare-version="(value) => emit('compare-version', value)"
        @annotate-version="(payload) => emit('annotate-version', payload)"
        @copy-id="emit('copy-id')"
        @delete="emit('delete-query')"
      />
    </template>

    <!-- Arguments Tab -->
    <template #arguments>
    <div class="tab-pane" :class="{ 'with-overlay': argumentsOverlayActive }">
      <div class="arguments-content">
        <!--
          Identity and what-runs at the top, values in the middle, the two
          buttons at the bottom. The body is nothing but the query's signature
          and the values filling it (design §4).
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
          :can-expand="!queryLoading"
          @expand="requestFocus()"
          @select-set="handleSelectArgumentSet"
          @select-scratch="args.selectScratch"
          @create-scratch="args.createScratch()"
          @run-with="args.runWith"
          @rename="handleRename"
          @copy="handleCopyExecutionPayload"
          @delete="handleDeleteArgumentSet"
        />

        <template v-if="hasSelection">
          <ArgumentScalarsPanel
            :limit-parameters="signature.limitParameters"
            :offset-parameters="signature.offsetParameters"
            :model-value="args.scalarBindings.value"
            @update:model-value="handleScalarsChange"
          />

          <TupleBindingEditor
            v-for="(clause, index) in signature.clauses"
            :key="`clause-${index}-${clause.variables.join('|')}`"
            :variables="clause.variables"
            :line="clause.line"
            :model-value="bindingForClause(clause.variables)"
            @update:model-value="(value) => handleClauseChange(clause.variables, value)"
          />

          <!--
            Verdicts are computed, for now: only from variable names and arity,
            which is all the model knows today (design §5).
          -->
          <p class="signature-verdict" :class="`signature-verdict--${verdict.verdict}`">
            <template v-if="verdict.verdict === 'fits'">matches the query signature</template>
            <template v-else>{{ verdict.reason }}</template>
          </p>
        </template>

        <div
          v-else-if="!hasDetectedArguments && !argumentsOverlayActive"
          class="no-arguments"
        >
          <EmptyState size="sm" title="This query takes no arguments" />
          <!--
            The empty state says what is missing; this says how to supply it.
            Parameters are declared in the query text, so there is nothing to
            click in this panel to create one — without the note the panel is a
            dead end.
          -->
          <p class="arguments-hint" data-testid="arguments-parameter-hint">
            <Info :size="13" class="arguments-hint-icon" />
            <span>
              To add arguments, add a <code>VALUES</code> clause with an all-<code>UNDEF</code>
              block.
              <a :href="PARAMETERS_DOC_URL" target="_blank" rel="noreferrer">Documentation</a>
            </span>
          </p>
        </div>
        <EmptyState
          v-else-if="!argumentsOverlayActive"
          size="sm"
          title="No argument set open"
          description="Pick one, or start a scratch set."
        />
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

      <Transition name="panel-scrim">
        <div v-if="argumentsOverlayActive" class="panel-overlay">
          {{ argumentsOverlayMessage }}
        </div>
      </Transition>
    </div>
    </template>

    <!-- Results Tab -->
    <template #results>
      <div class="tab-pane" :class="{ 'with-overlay': resultsOverlayActive }">
        <div class="results-content">
          <QueryResultsViewer
            :results="result?.structured ?? null"
            :raw-content="result?.rawContent ?? null"
            :content-type="result?.contentType ?? null"
            :timing="result?.timing"
            :executed-at="result?.executedAt ?? null"
            :loading="queryLoading"
            :can-expand="true"
            :prefix-source="resultsPrefixSource ?? null"
            @expand="emit('request-focus', 'results')"
          />
        </div>
        <Transition name="panel-scrim">
          <div v-if="resultsOverlayActive" class="panel-overlay">
            {{ resultsOverlayMessage }}
          </div>
        </Transition>
      </div>
    </template>

    <!-- Code Tab -->
    <template #code>
      <CodeSnippetPanel
        :variants="codeVariants"
        :default-variant-id="codeDefaultVariantId"
        :draft-note="codeDraftNote"
        :unavailable="codeUnavailable"
        :call-arguments="codeArguments"
        arguments-hint="Edit values in the Arguments tab — the snippet follows."
      />
    </template>

    <!-- Tests Tab: the Tests section, filtered to this query -->
    <template #tests>
      <div class="tab-pane scrollable">
        <SubjectTestsPanel
          v-if="testSubjectId"
          :subject-id="testSubjectId"
          subject-noun="query"
          @open="(testId) => emit('open-test', testId)"
        />
      </div>
    </template>

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
  </InspectorPanel>
</template>

<script setup lang="ts">
import { ref, watch, computed, nextTick } from 'vue';
import { Info } from '@lucide/vue';
import { toast } from 'vue-sonner';
import QueryResultsViewer from '../QueryResultsViewer.vue';
import InspectorPanel, { type InspectorTab } from '../shared/InspectorPanel.vue';
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

import CodeSnippetPanel, {
  type CodeSnippetArgument,
  type CodeSnippetVariant,
} from '../shared/CodeSnippetPanel.vue';
import EntityDetailsPanel from '../shared/EntityDetailsPanel.vue';
import EmptyState from '../shared/EmptyState.vue';
import SubjectTestsPanel from '../tests/SubjectTestsPanel.vue';
import { useTestsSurface } from '@/composables/useTestsSurface';
import ArgumentSetSwitcher, { type SwitcherEntry } from './ArgumentSetSwitcher.vue';
import ArgumentSetFooter from './ArgumentSetFooter.vue';
import ArgumentScalarsPanel from './ArgumentScalarsPanel.vue';
import TupleBindingEditor from './TupleBindingEditor.vue';
import {
  buildQuerySignature,
  clauseKey,
  compatibility,
  tupleSignature,
} from '@/lib/argumentSignature';
import { conceptsDocUrl } from '@/lib/docs';
import type { QueryExecutionResultPayload, QueryInspectorTab } from '@/types/execution';
import type { DetailsBackendOption, DetailsVersionOption } from '../shared/EntityDetailsPanel.vue';

/**
 * Details sits in front of the two execution tabs; see EntityDetailsPanel.
 * The ids themselves live in `types/execution` — the work area and
 * `useQueryExecution` name the same set.
 */
type ResultsTab = QueryInspectorTab;

type QueryDetailsProps = {
  name: string;
  description: string;
  isScratch: boolean;
  entityId: string | null;
  backendValue: string;
  backendOptions: DetailsBackendOption[];
  versionOptions: DetailsVersionOption[];
  selectedVersion: string | null;
  currentVersion: string | null;
  editCount: number;
  draftSavedAt: string | null;
  draftSelected: boolean;
  detectedInputs: DetectInputsResponse | null;
  detectedOutputs: string[];
  /** False while scratch: there is no entity yet to point at a version. */
  canSetCurrentVersion?: boolean;
  /** False while scratch, or with nothing to compare against: no diff to open. */
  canCompareVersions?: boolean;
  createdAt?: string | null;
  canDelete?: boolean;
  deleting?: boolean;
};
import type { DetectInputsResponse } from '@sparql-query-lib/contracts';
import type { ArgumentScalarBinding, ArgumentTupleBinding } from '@/types/argument-sets';
import { useArgumentSets } from '@/composables/useArgumentSets';
import { useApiClient } from '@/composables/useApiClient';
// @ts-ignore - Nuxt auto-import
import { useRuntimeConfig } from '#imports';
type ArgumentSetsComposable = ReturnType<typeof useArgumentSets>;

const props = defineProps<{
  result: QueryExecutionResultPayload | null;
  /**
   * Where prefixes found in a response are recorded against — the store that
   * answered, since the declarations in a CONSTRUCT body are its own.
   */
  resultsPrefixSource?: string | null;
  resultsOverlayActive: boolean;
  resultsOverlayMessage: string;
  argumentsOverlayActive: boolean;
  argumentsOverlayMessage: string;
  isNewQuery: boolean;
  queryLoading: boolean;
  activeTab?: ResultsTab;
  collapsed?: boolean;
  detectedInputs: DetectInputsResponse | null;
  detectedOutputs: string[];
  queryId?: string | null;
  /**
   * The query text, only so the arguments tab can put a source line on each
   * VALUES clause. Detection answers with variables and no positions, and the
   * chip is a label, so the panel recovers them from the text it already has.
   */
  queryText?: string | null;
  argumentSetsComposable?: ArgumentSetsComposable | null;
  /**
   * When supplied, the panel grows a Details tab in front of the other two.
   * It is a prop bag rather than a dozen props because Details is one view of
   * the work area's state, and splitting it up here would only mean
   * reassembling it in the child.
   */
  details?: QueryDetailsProps | null;
}>();

const emit = defineEmits<{
  (e: 'request-focus', tab: 'arguments' | 'results'): void;
  (e: 'update:activeTab', value: ResultsTab): void;
  (e: 'update:collapsed', value: boolean): void;
  (e: 'update:detailsName', value: string): void;
  (e: 'update:detailsDescription', value: string): void;
  (e: 'update:detailsBackend', value: string): void;
  (e: 'select-version', value: string): void;
  (e: 'set-current-version', value: string): void;
  (e: 'select-draft'): void;
  (e: 'compare-version', value: string): void;
  (e: 'annotate-version', payload: { value: string; comment: string | null }): void;
  (e: 'copy-id'): void;
  (e: 'delete-query'): void;
  /** A row in the Tests tab was clicked; the page decides where that goes. */
  (e: 'open-test', testId: string): void;
}>();

/* Parameters are a concept, not a field: the panel links the page that defines them. */
const PARAMETERS_DOC_URL = conceptsDocUrl('parameters');

const activeTab = ref<string>(props.activeTab ?? 'details');

/**
 * The subject a test would name, or null while there is nothing to name.
 *
 * Read off the details bag rather than off `queryId`, because that bag is
 * where "saved" is already decided: it carries the entity id only once the
 * query is not scratch. A test points at a saved subject, so a scratch query
 * has no tests and can acquire none — hence no tab at all, which is the rule
 * the rules screen follows. `useTestsSurface` adds the second absence: a build
 * with the feature off has no tests to list either.
 */
const { testSubject } = useTestsSurface();
const testSubjectId = testSubject(() => props.details?.entityId ?? null);

/*
 * Details is only a tab when the work area supplies one; the panel is also
 * used where there is nothing to describe. Everything else about the strip —
 * order, collapse, styling — is InspectorPanel's, shared with groups and ETL.
 */
const inspectorTabs = computed<InspectorTab[]>(() => [
  { id: 'details', label: 'Details', hidden: !props.details },
  { id: 'arguments', label: 'Arguments' },
  { id: 'results', label: 'Results' },
  { id: 'code', label: 'Code' },
  { id: 'tests', label: 'Tests', hidden: !testSubjectId.value },
]);

// Focus mode blows one of the execution panels up to full screen; Details and
// Code have nothing to expand, so the call is a no-op there rather than a
// broken emit.
function requestFocus() {
  if (activeTab.value === 'details' || activeTab.value === 'code') return;
  emit('request-focus', activeTab.value as 'arguments' | 'results');
}
// Build tab removed; showing design content only

/*
 * The arguments tab.
 *
 * One composable holds the set — saved, draft or scratch — and this block
 * is only the seam between it and the three components: what the switcher
 * lists, which clause each editor is bound to, and when an edit becomes a
 * local write.
 */
const queryIdRef = computed(() => props.queryId ?? null)
// The work area passes its own composable so the Run button and this panel
// agree on what runs; a standalone mount makes one of its own.
const args = props.argumentSetsComposable ?? useArgumentSets(queryIdRef, 'query')
const apiClient = useApiClient()

const hasSelection = computed(() => args.selection.value.kind !== 'none')

/** What the query asks for: its VALUES clauses and scalar parameters. */
const signature = computed(() =>
  buildQuerySignature(props.detectedInputs, props.queryText ?? null),
)

const verdict = computed(() => compatibility(signature.value, args.tupleBindings.value))

const switcherName = computed(() => {
  if (!hasSelection.value) return 'No argument set'
  return args.name.value || 'Untitled set'
})

const scratchEntries = computed<SwitcherEntry[]>(() =>
  args.scratchSets.value.map((entry) => ({
    id: entry.id,
    name: entry.name || 'Untitled set',
    meta: entry.edits > 0 ? `${entry.edits} edits` : 'never saved',
  })),
)

/**
 * Saved sets carry their current version and a verdict, because the reason to
 * open one is whether it fits — and a set that cannot bind this query's
 * clauses should say so before it is opened, not after.
 */
/**
 * Saved sets, this query's first and the library's after.
 *
 * The listing now spans the library, so a row has to say which it is: a set
 * made here reads as this query's, and one from elsewhere says so — the verdict
 * beside it is what makes it worth offering at all, and was previously always
 * "fits" because there was nothing else in the list to judge.
 */
const savedEntries = computed<SwitcherEntry[]>(() => {
  const openTarget = props.queryId ?? null
  const rows = args.argumentSets.value.map((set) => {
    const version = set.currentVersion?.version
    const fit = compatibility(
      signature.value,
      set.currentVersion?.tupleBindings ?? set.tupleBindings ?? [],
    )
    const ownedHere = !set.targetId || (!!openTarget && set.targetId === openTarget)
    const parts = [version ? `v${version}` : 'no version']
    if (!ownedHere) parts.push('elsewhere in the library')
    if (fit.verdict !== 'fits') parts.push(fit.reason || fit.verdict)
    return { id: set.id, name: set.name, meta: parts.join(' · '), ownedHere }
  })
  // This query's first, then the rest; each half keeps the order the server
  // sorted it into.
  return [...rows.filter((row) => row.ownedHere), ...rows.filter((row) => !row.ownedHere)]
    .map(({ ownedHere: _ownedHere, ...entry }) => entry)
})

/**
 * The stored binding for a clause, or an empty one.
 *
 * Matched on the variable set rather than on position: detection may reorder
 * clauses as the query is edited, and binding by index would silently move a
 * row of values from one clause to another.
 */
function bindingForClause(variables: string[]): ArgumentTupleBinding {
  const key = clauseKey(variables)
  const found = args.tupleBindings.value.find(
    (binding) => clauseKey(binding.variables ?? binding.tupleSignature.split('|')) === key,
  )
  return found ?? { tupleSignature: tupleSignature(variables), variables, rows: [] }
}

function handleClauseChange(variables: string[], value: ArgumentTupleBinding) {
  const key = clauseKey(variables)
  const next = args.tupleBindings.value.filter(
    (binding) => clauseKey(binding.variables ?? binding.tupleSignature.split('|')) !== key,
  )
  next.push(value)
  args.tupleBindings.value = next
  args.persistLocal()
}

function handleScalarsChange(value: ArgumentScalarBinding[]) {
  args.scalarBindings.value = value
  args.persistLocal()
}

async function handleSelectArgumentSet(setId: string) {
  await args.selectSet(setId)
}

/*
 * The app's own dialog rather than `window.confirm`. A browser stops showing
 * those once someone ticks "prevent this page from creating more dialogs", and
 * a suppressed confirm answers `false` — so Delete set silently did nothing,
 * which is the same fault the rename prompt had.
 */
const deleteConfirmOpen = ref(false)

function handleDeleteArgumentSet() {
  if (!args.selectedSetId.value) return
  deleteConfirmOpen.value = true
}

async function confirmDeleteArgumentSet() {
  const setId = args.selectedSetId.value
  deleteConfirmOpen.value = false
  if (!setId) return
  const deleted = await args.deleteSet(setId)
  if (deleted) toast.success('Argument set deleted')
  else if (args.error.value) toast.error(args.error.value)
}

/* The switcher edits the name in place and hands over the result. */
function handleRename(name: string) {
  args.rename(name)
}

async function handleSave() {
  const version = args.nextVersionNumber.value
  const saved = await args.save()
  if (saved) toast.success(`Saved v${version}`)
  else if (args.error.value) toast.error(args.error.value)
}

/**
 * Copy the execution payload.
 *
 * A saved version is exported by the server, which is the authority on
 * what it actually contains. A draft has no server copy yet, so the panel
 * builds the same shape from what is on screen.
 */
async function handleCopyExecutionPayload() {
  try {
    const versionId = args.executionArgumentSetId.value
    const payload = versionId
      ? await apiClient.exportArgumentSetPayload(versionId)
      : args.inlineExecutionPayload()

    if (!payload) {
      toast.error('Nothing to copy')
      return
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2))
    }
    toast.success('Execution payload copied')
  } catch (error) {
    console.error('[QueryResultsPanel] Failed to copy execution payload', error)
    toast.error('Failed to copy execution payload')
  }
}

/*
 * The Code tab.
 *
 * `POST /execute` with this query's id — the same call the Run button makes,
 * built from the same argument state, so what the snippet sends is what the
 * app sends. A saved argument set goes by id (`argumentSetIds`), because
 * naming a frozen version is reproducible; a draft or scratch set has no id
 * yet, so its values are inlined the way the run path inlines them.
 */
const config = useRuntimeConfig()

const executeUrl = computed(
  () => `${String(config.public.apiBaseUrl).replace(/\/$/, '')}/execute`,
)

/** targetId and backend — the half of the body that does not depend on the toggle. */
const codeTargetBody = computed<Record<string, unknown>>(() => {
  const body: Record<string, unknown> = { targetId: props.queryId || '<query-id>' }
  const backendId = props.details?.backendValue
  if (backendId && backendId !== 'none') body.backendId = backendId
  return body
})

/*
 * Two ways to pass the same values.
 *
 * `POST /execute` takes either `argumentSetIds` — a frozen set version the
 * library already holds — or the values inline, and rejects a body carrying
 * both. Neither is the "real" way: a stored set is reproducible and shared, and
 * inline values need nothing saved at all, which is what a caller driving its
 * own values wants. So the tab offers both rather than picking for them.
 */
const codeVariants = computed<CodeSnippetVariant[]>(() => {
  const list: CodeSnippetVariant[] = []

  const argumentSetId = args.executionArgumentSetId.value
  if (argumentSetId) {
    list.push({
      id: 'stored',
      label: 'Stored set',
      note: 'Runs the argument set version by id. The values live in the library, frozen — the same call returns the same rows tomorrow.',
      request: {
        method: 'POST',
        url: executeUrl.value,
        body: { ...codeTargetBody.value, argumentSetIds: [argumentSetId] },
      },
    })
  }

  // Always available: whatever is on screen, whether or not it was ever saved.
  const inline = args.visibleValuesPayload()
  const inlineBody: Record<string, unknown> = { ...codeTargetBody.value }
  if (inline?.arguments?.length) inlineBody.arguments = inline.arguments
  if (inline?.limits?.length) inlineBody.limits = inline.limits
  if (inline?.offsets?.length) inlineBody.offsets = inline.offsets

  list.push({
    id: 'inline',
    label: 'Inline values',
    note: hasDetectedArguments.value
      ? 'Sends the values with the call. Nothing is saved in the library, so the caller can pass whatever it likes.'
      : 'This query takes no arguments, so the call carries none.',
    request: { method: 'POST', url: executeUrl.value, body: inlineBody },
  })

  return list
})

/** Opens on whichever way the Run button is currently running it. */
const codeDefaultVariantId = computed(() =>
  args.executionArgumentSetId.value ? 'stored' : 'inline',
)

/*
 * A query with unsaved edits runs as text through `POST /sparql`; the
 * snippet names the query instead, and calling it runs the saved version.
 * Saying so beats handing over a call whose results silently differ from the
 * ones in the Results tab.
 */
const codeUnavailable = computed(() => {
  if (props.details?.isScratch || !props.queryId) {
    return 'This query has not been saved yet — save it to get a callable id.'
  }
  return null
})

const codeDraftNote = computed(() => {
  if (codeUnavailable.value) return null
  if (props.details?.draftSelected || props.details?.editCount) {
    return 'Draft — the snippet is correct, but it calls the saved version, not your unsaved edits.'
  }
  return null
})

/** What the caller has to fill in: the query's own inputs, not the payload keys. */
const codeArguments = computed<CodeSnippetArgument[]>(() => [
  ...signature.value.clauses.map((clause) => ({
    name: clause.variables.join(', '),
    detail: `VALUES · ${clause.variables.length} ${clause.variables.length === 1 ? 'variable' : 'variables'}`,
  })),
  ...signature.value.limitParameters.map((name) => ({ name, detail: 'integer · LIMIT' })),
  ...signature.value.offsetParameters.map((name) => ({ name, detail: 'integer · OFFSET' })),
])

// Collapsed state for the panel - synced with prop
const collapsed = ref(props.collapsed ?? false)

watch(() => props.collapsed, (newValue) => {
  if (newValue !== undefined && newValue !== collapsed.value) {
    collapsed.value = newValue
  }
})

watch(collapsed, (value) => {
  emit('update:collapsed', value)
})


const detailsPanelRef = ref<InstanceType<typeof EntityDetailsPanel> | null>(null)

defineExpose({
  getExecutionArgumentSetId: () => args.executionArgumentSetId.value,
  getInlineArguments: () => args.inlineExecutionPayload(),
  /** Put the caret in the one field that names the query. */
  focusDetailsName: () => {
    activeTab.value = 'details'
    void nextTick(() => detailsPanelRef.value?.focusName())
  },
})

// Watch for external activeTab changes
watch(() => props.activeTab, (newValue) => {
  if (newValue) {
    activeTab.value = newValue;
  }
});

// Emit activeTab changes
watch(activeTab, (newValue) => {
  emit('update:activeTab', newValue as ResultsTab);
});

// Check if we have any detected arguments
const hasDetectedArguments = computed(() => {
  if (!props.detectedInputs) return false;
  return (
    (props.detectedInputs.limitParameters?.length ?? 0) > 0 ||
    (props.detectedInputs.offsetParameters?.length ?? 0) > 0 ||
    (props.detectedInputs.valuesInputs?.length ?? 0) > 0
  );
});

const hasDetectedOutputs = computed(() => {
  return (props.detectedOutputs?.length ?? 0) > 0;
});
</script>

<style scoped>
/* The panel chrome — tab strip, collapse toggle, header slot — is
   InspectorPanel's; only the contents of the three tabs live here. */
.tab-pane {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

/* Tests is the exception: a list of rows, as long as the suite is. */
.tab-pane.scrollable {
  padding: var(--space-5);
  overflow: auto;
}

/*
 * The empty state and the note under it read as one block, so they sit in one
 * column rather than taking the pane's own 12px rhythm between them.
 */
.no-arguments {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

/*
 * The quiet info triple — surface, border, ink — the same shape as the banner
 * on the rule-set SPARQL pane. See docs/reference/ui-design-tokens.md.
 */
.arguments-hint {
  display: flex;
  gap: var(--space-2);
  margin: 0;
  padding: var(--space-4);
  background: var(--info-surface);
  border: 1px solid var(--info-border);
  border-radius: var(--radius-panel);
  color: var(--info-ink);
  font-size: var(--text-label);
  line-height: var(--leading-normal);
}

.arguments-hint-icon {
  flex-shrink: 0;
  margin-top: var(--space-1);
}

.arguments-hint code {
  font-family: var(--font-mono);
  font-size: var(--text-code);
}

.arguments-hint a {
  color: var(--info-ink);
  text-decoration: underline;
}

.arguments-content {
  flex: 1;
  padding: var(--space-5) var(--space-6);
  overflow-y: auto;
  background: var(--surface);
  display: flex; /* Add flex to enable gap */
  flex-direction: column; /* Stack children vertically */
  gap: 12px; /* Add 12px gap */
}

/* The one line that says whether these values answer this query. */
.signature-verdict {
  margin: 0;
  font-size: var(--text-micro);
  color: var(--ink-muted);
}

.signature-verdict--partial {
  color: var(--warning-ink);
}

.signature-verdict--mismatch {
  color: var(--danger-ink);
}

.results-content {
  flex: 1;
  position: relative;
  padding: 0 var(--space-6) var(--space-6) var(--space-6);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.with-overlay {
  pointer-events: none;
}

.with-overlay > :not(.panel-overlay) {
  opacity: 0.4;
}

/*
 * Switching queries dims these panes and covers them, the same moment it
 * swaps the editor above. Both ends of that are eased, so the whole work area
 * changes subject as one movement rather than as three things snapping at
 * once.
 */
.tab-pane > :not(.panel-overlay) {
  transition: opacity 150ms ease;
}

.panel-scrim-enter-active,
.panel-scrim-leave-active {
  transition: opacity 150ms ease;
}

.panel-scrim-enter-from,
.panel-scrim-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .tab-pane > :not(.panel-overlay),
  .panel-scrim-enter-active,
  .panel-scrim-leave-active {
    transition: none;
  }
}

.panel-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: var(--space-7);
  background: rgba(255, 255, 255, 0.85);
  color: var(--ink-secondary);
  font-size: var(--text-content);
  font-weight: 500;
}
</style>
