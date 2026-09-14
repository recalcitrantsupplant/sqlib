<template>
  <div ref="workAreaRef" class="argument-set-work-area">
    <div
      class="left-panel"
      :class="{ resizing: isResizingVertical }"
      :style="{ width: rightPanelCollapsed ? 'calc(100% - 48px)' : leftPanelWidth + '%' }"
    >
      <SaveBar
        :title="setName"
        noun="argument set"
        :is-scratch="isScratch"
        :current-version-number="currentVersionNumber"
        :edit-count="editCount"
        :saving="isSaving"
        :can-save="canSave"
        :needs-name="!setName.trim()"
        :show-format="false"
        :show-diff="false"
        :show-edit="false"
        @save="save"
        @needs-name="promptForNameInDetails"
        @discard="discardDraft"
        @delete="removeSet"
      />

      <!--
        The parameters this set fills, in the order a run reads them: the tables
        that go into VALUES clauses, the graphs that go into a group's declared
        ports, then the numbers. Composed here rather than detected, because a
        set on this screen has no callable to detect a signature from — which is
        the whole point of it having a screen.
      -->
      <div class="body">
        <section class="group">
          <SectionLabel as="h3" size="md">Tables</SectionLabel>
          <p class="group-hint">
            One per VALUES clause. A table is matched to a clause by the
            variables it binds, not by the order they were written in, so the
            names here are what has to line up.
          </p>

          <TupleBindingEditor
            v-for="(binding, index) in tupleBindings"
            :key="binding.tupleSignature || index"
            :variables="binding.variables"
            :model-value="binding"
            :library-id="setLibraryId || activeLibraryId"
            @update:model-value="updateBinding(index, $event)"
          />

          <p v-if="!tupleBindings.length" class="empty-hint" data-testid="argument-set-no-tables">
            No tables yet.
          </p>

          <form class="add-row" data-testid="argument-set-add-table" @submit.prevent="addTable">
            <FormField label="Variables" hint="Space-separated, as the clause declares them — city, or postcode state.">
              <input
                v-model="newTableVariables"
                class="text-input"
                data-testid="argument-set-new-table-variables"
                placeholder="city"
              >
            </FormField>
            <button type="submit" class="ghost-button" :disabled="!newTableVariables.trim()">Add table</button>
          </form>
        </section>

        <!--
          Graphs, in order — no port names. A set carries payload and the group
          it is run against says which of its start-node inputs each graph
          fills, so this screen has no port to offer and would be guessing if it
          asked for one. Order is the routing key, hence Move up / Move down.

          A query declares no graph parameter at all: its store is its backend,
          and running one over a graph is a backend hydrated from that graph. A
          set carrying graphs still runs against a query; they are simply not
          used, which the query screen says.
        -->
        <section class="group">
          <SectionLabel as="h3" size="md">Graphs</SectionLabel>
          <p class="group-hint">
            The RDF this set hands to a query group, in order: the first graph
            fills the first data input its start node declares, and so on. The
            group decides which input that is — nothing here names a port.
            Queries do not take these: a query's store is its backend.
          </p>

          <div
            v-for="(binding, index) in graphBindings"
            :key="binding.id || index"
            class="graph-binding"
            data-testid="argument-set-graph-binding"
          >
            <span class="slot-number" data-testid="argument-set-graph-slot">{{ index + 1 }}</span>
            <FormField label="Data graph">
              <SearchSelect
                test-id="argument-set-graph-select"
                aria-label="Data graph"
                placeholder="Choose a graph…"
                empty-label="Choose a graph…"
                :model-value="binding.dataGraphVersionId ?? null"
                :options="dataGraphSelectOptions"
                @update:model-value="(value) => updateGraph(index, { dataGraphVersionId: value || null })"
              />
            </FormField>
            <div class="graph-actions">
              <button
                type="button"
                class="ghost-button"
                data-testid="argument-set-graph-up"
                :disabled="index === 0"
                @click="moveGraph(index, -1)"
              >Move up</button>
              <button
                type="button"
                class="ghost-button"
                data-testid="argument-set-graph-down"
                :disabled="index === graphBindings.length - 1"
                @click="moveGraph(index, 1)"
              >Move down</button>
              <button type="button" class="ghost-button" @click="removeGraph(index)">Remove</button>
            </div>
          </div>

          <p v-if="!graphBindings.length" class="empty-hint" data-testid="argument-set-no-graphs">
            No graphs yet.
          </p>

          <button type="button" class="ghost-button" data-testid="argument-set-add-graph" @click="addGraph">
            Add graph
          </button>
        </section>

        <section class="group">
          <SectionLabel as="h3" size="md">Numbers</SectionLabel>
          <p class="group-hint">
            LIMIT and OFFSET values, named by the placeholder they fill. A query
            group takes these too, passed through to whichever of its member
            queries declares that name.
          </p>

          <div
            v-for="(scalar, index) in scalarBindings"
            :key="scalar.id || index"
            class="scalar-binding"
            data-testid="argument-set-scalar-binding"
          >
            <FormField label="Kind">
              <select
                class="text-input"
                :value="scalar.parameterKind"
                @change="updateScalar(index, { parameterKind: ($event.target as HTMLSelectElement).value as 'limit' | 'offset' })"
              >
                <option value="limit">LIMIT</option>
                <option value="offset">OFFSET</option>
              </select>
            </FormField>
            <FormField label="Name">
              <input
                :value="scalar.parameterName"
                class="text-input"
                @input="updateScalar(index, { parameterName: ($event.target as HTMLInputElement).value })"
              >
            </FormField>
            <FormField label="Value">
              <input
                :value="scalar.numericValue"
                type="number"
                min="0"
                class="text-input"
                @input="updateScalar(index, { numericValue: Number(($event.target as HTMLInputElement).value) })"
              >
            </FormField>
            <button type="button" class="ghost-button" @click="removeScalar(index)">Remove</button>
          </div>

          <p v-if="!scalarBindings.length" class="empty-hint" data-testid="argument-set-no-scalars">
            No numbers yet.
          </p>

          <button type="button" class="ghost-button" data-testid="argument-set-add-scalar" @click="addScalar">
            Add number
          </button>
        </section>

        <!--
          The switcher turned around. "Here are my arguments, what accepts them"
          is a real question, and this is the only screen it can be asked from —
          which is most of the answer to what a rail entry for an argument set
          is for.
        -->
        <section class="group">
          <SectionLabel as="h3" size="md">Fits</SectionLabel>
          <p class="group-hint">
            The queries and groups in this library, judged against what this set
            fills.
          </p>

          <ul v-if="fits.length" class="fits-list" data-testid="argument-set-fits">
            <li v-for="entry in fits" :key="entry.id" class="fits-row">
              <span class="fits-name">{{ entry.name }}</span>
              <span class="fits-verdict" :class="`fits-verdict--${entry.verdict}`">{{ entry.verdict }}</span>
              <button
                type="button"
                class="link-button"
                :disabled="entry.verdict === 'mismatch'"
                data-testid="argument-set-run-with"
                @click="emit('open-callable', { id: entry.id, kind: entry.kind, argumentSetId: setId ?? null })"
              >
                Run with…
              </button>
            </li>
          </ul>
          <p v-else class="empty-hint">Nothing in this library takes these arguments yet.</p>
        </section>

        <p v-if="saveError" class="save-error" data-testid="argument-set-error">{{ saveError }}</p>
      </div>
    </div>

    <div
      class="vertical-resizer"
      :class="{ hidden: rightPanelCollapsed }"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the inspector panel"
      title="Drag to resize · double-click to reset"
      @mousedown="startVerticalResize"
      @dblclick="resetPanelWidth"
    >
      <div class="resizer-handle"></div>
    </div>

    <div class="right-panel" :class="{ collapsed: rightPanelCollapsed }">
      <InspectorPanel
        v-model:active-tab="activeTab"
        v-model:collapsed="rightPanelCollapsed"
        :tabs="inspectorTabs"
        testid="argument-set-inspector"
      >
        <template #details>
          <EntityDetailsPanel
            ref="detailsPanelRef"
            v-bind="detailsProps"
            @update:name="setName = $event"
            @update:description="description = $event"
            @select-version="selectVersion"
            @copy-id="copyArgumentSetId"
            @delete="removeSet"
          />

          <!--
            Where it was made, as a link. Provenance rather than a fence: the
            same set serves any callable whose signature it matches, which is
            what the Fits list above is for.
          -->
          <div v-if="provenanceLabel" class="provenance" data-testid="argument-set-provenance">
            <span class="provenance-label">Made on</span>
            <button
              type="button"
              class="link-button"
              @click="emit('open-callable', { id: targetId!, kind: provenanceKind!, argumentSetId: setId ?? null })"
            >
              {{ provenanceLabel }}
            </button>
          </div>
        </template>

        <template #code>
          <CodeSnippetPanel :request="codeRequest" :unavailable="codeUnavailable" />
        </template>
      </InspectorPanel>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * One argument set: the parameters it fills, and what accepts them.
 *
 * The third of the three rail record pages, and deliberately the twin of
 * `TupleSetWorkArea` and `DataGraphWorkArea` in lifecycle — scratch, draft,
 * save, immutable versions — because a library holds all three the same way.
 *
 * Where it diverges is that its content is *composed* rather than authored. A
 * tuple set is one table you type or import; an argument set is a bundle of
 * parameters that normally comes from a callable's signature. On this screen
 * there is no callable to detect one from, so the parameters are added by hand
 * — a variable list makes a table, a port name makes a graph slot, a
 * placeholder name makes a number. That is what a set composed here *is*: an
 * assembly you then offer to whatever fits it.
 *
 * See `docs/concepts.md`.
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { toast } from 'vue-sonner';
import SaveBar from './shared/SaveBar.vue';
import FormField from './shared/FormField.vue';
import SearchSelect from './shared/SearchSelect.vue';
import SectionLabel from './shared/SectionLabel.vue';
import CodeSnippetPanel from './shared/CodeSnippetPanel.vue';
import InspectorPanel, { type InspectorTab } from './shared/InspectorPanel.vue';
import EntityDetailsPanel from './shared/EntityDetailsPanel.vue';
import TupleBindingEditor from './query-work-area/TupleBindingEditor.vue';
import type { SnippetRequest } from '@/lib/codeSnippets';
import { useArgumentSetsStore } from '@/composables/useArgumentSetsStore';
import { useDataGraphsStore } from '@/composables/useDataGraphsStore';
import { usePanelResize } from '@/composables/usePanelResize';
import { useApiClient } from '@/composables/useApiClient';
import { useActiveLibrary } from '@/composables/useActiveLibrary';
import { useScratchRecord } from '@/composables/useScratchRecord';
import { useCallableDrafts, UNASSIGNED_LIBRARY_ID } from '@/composables/useCallableDrafts';
import { useTupleSetsStore } from '@/composables/useTupleSetsStore';
import { buildQuerySignature, compatibility } from '@/lib/argumentSignature';
import { pinBindings, referencesOf } from '@/lib/tupleSetReferences';
import type {
  ArgumentGraphBinding,
  ArgumentScalarBinding,
  ArgumentSetDraftBody,
  ArgumentTupleBinding,
} from '@/types/argument-sets';
import type { DataGraphOption } from '@/types/data-graphs';

const props = defineProps<{
  argumentSetId?: string | null;
  scratchId?: string | null;
}>();

const emit = defineEmits<{
  (e: 'scratch-saved', payload: { id: string; name: string; libraryId: string }): void;
  (e: 'argument-set-deleted'): void;
  (e: 'open-callable', payload: { id: string; kind: 'query' | 'queryGroup'; argumentSetId: string | null }): void;
}>();

const store = useArgumentSetsStore();
const dataGraphsStore = useDataGraphsStore();
const tupleSetsStore = useTupleSetsStore();
const apiClient = useApiClient();
const { activeLibraryId } = useActiveLibrary();
const draftsStore = useCallableDrafts();

const setId = ref<string | null>(props.argumentSetId ?? null);
const setName = ref('');
const description = ref('');
const scope = ref<'query' | 'queryGroup' | null>(null);
const targetId = ref<string | null>(null);
const setLibraryId = ref<string | null>(null);
const setCreatedAt = ref<string | null>(null);

const tupleBindings = ref<ArgumentTupleBinding[]>([]);
const scalarBindings = ref<ArgumentScalarBinding[]>([]);
const graphBindings = ref<ArgumentGraphBinding[]>([]);

const versions = ref<Array<{ id: string; version: number; dateModified?: string; dateCreated?: string }>>([]);
const currentVersionId = ref<string | null>(null);
const loadedVersionId = ref<string | null>(null);

const isSaving = ref(false);
const isDeleting = ref(false);
const saveError = ref<string | null>(null);
const locallySavedAt = ref<string | null>(null);
const newTableVariables = ref('');
const dataGraphOptions = ref<DataGraphOption[]>([]);
/* Typed at rather than scrolled — the library's graphs are many and hand-named. */
const dataGraphSelectOptions = computed(() =>
  dataGraphOptions.value.map((option) => ({
    value: option.versionId,
    label: `${option.name} · v${option.version}`,
  })),
);
const fits = ref<Array<{ id: string; name: string; kind: 'query' | 'queryGroup'; verdict: string }>>([]);

/* --------------------------------------------------------------- editing */

const bareVariables = (input: string): string[] =>
  input.split(/[\s,]+/).map(part => part.trim().replace(/^\?/, '')).filter(Boolean);

function addTable() {
  const variables = bareVariables(newTableVariables.value);
  if (!variables.length) return;
  const signature = [...variables].sort().join('|');
  if (tupleBindings.value.some(binding => [...binding.variables].sort().join('|') === signature)) {
    toast.error('This set already has a table over those variables.');
    return;
  }
  tupleBindings.value = [...tupleBindings.value, { tupleSignature: signature, variables, rows: [] }];
  newTableVariables.value = '';
  markEdited();
}

function updateBinding(index: number, binding: ArgumentTupleBinding) {
  tupleBindings.value = tupleBindings.value.map((existing, at) => (at === index ? binding : existing));
  markEdited();
}

/**
 * The bindings as the API takes them, with `position` stamped from the order
 * on screen.
 *
 * A group routes by slot, so the order these sit in *is* the meaning. Stamped
 * on the way out rather than tracked per binding, so moving one row cannot
 * leave the rest disagreeing about where they are.
 */
function positionedBindings(tuples: typeof tupleBindings.value = tupleBindings.value) {
  return {
    tupleBindings: tuples.map((binding, position) => ({ ...binding, position })),
    scalarBindings: scalarBindings.value,
    graphBindings: graphBindings.value.map((binding, position) => ({ ...binding, position })),
  };
}

/**
 * Load enough of the library's tuple sets for every linked reference to be
 * describable and pinnable.
 *
 * Called before a save because pinning reads `TupleSet.currentVersion` out of
 * the store, and on load because the references shown on this screen arrive as
 * bare version IRIs from the server.
 */
async function warmReferences(): Promise<void> {
  const references = tupleBindings.value.flatMap(binding => referencesOf(binding));
  if (!references.length) return;
  await tupleSetsStore.resolveReferences(
    references,
    setLibraryId.value || activeLibraryId.value,
  );
}

function addGraph() {
  graphBindings.value = [...graphBindings.value, { dataGraphVersionId: null }];
  markEdited();
}

/**
 * Reorder the graphs.
 *
 * Order is what a group routes against, so it is the one thing on this screen
 * a person has to be able to state. `position` is rewritten from the array on
 * save rather than tracked here, so there is one source of truth for it.
 */
function moveGraph(index: number, delta: number) {
  const to = index + delta;
  if (to < 0 || to >= graphBindings.value.length) return;
  const next = [...graphBindings.value];
  [next[index], next[to]] = [next[to], next[index]];
  graphBindings.value = next;
  markEdited();
}

function updateGraph(index: number, patch: Partial<ArgumentGraphBinding>) {
  graphBindings.value = graphBindings.value.map((existing, at) =>
    (at === index ? { ...existing, ...patch } : existing));
  markEdited();
}

function removeGraph(index: number) {
  graphBindings.value = graphBindings.value.filter((_, at) => at !== index);
  markEdited();
}

function addScalar() {
  scalarBindings.value = [...scalarBindings.value, {
    parameterKind: 'limit', parameterName: '', numericValue: 100,
  }];
  markEdited();
}

function updateScalar(index: number, patch: Partial<ArgumentScalarBinding>) {
  scalarBindings.value = scalarBindings.value.map((existing, at) =>
    (at === index ? { ...existing, ...patch } : existing));
  markEdited();
}

function removeScalar(index: number) {
  scalarBindings.value = scalarBindings.value.filter((_, at) => at !== index);
  markEdited();
}

/* ---------------------------------------------------------- scratch/draft */

const { isScratch } = useScratchRecord({
  scratchId: () => props.scratchId ?? null,
  missingMessage: 'That scratch argument set is not in this browser',
  track: [setName, description, tupleBindings, scalarBindings, graphBindings],
  hydrate: (record) => {
    const body = (record.body ?? {}) as Partial<ArgumentSetDraftBody> & { description?: string };
    setName.value = record.name;
    description.value = body.description ?? '';
    scope.value = body.scope ?? null;
    targetId.value = body.targetId ?? null;
    tupleBindings.value = body.tupleBindings ?? [];
    scalarBindings.value = body.scalarBindings ?? [];
    graphBindings.value = body.graphBindings ?? [];
  },
  collect: (record) => ({
    name: setName.value || record.name,
    body: {
      description: description.value,
      scope: scope.value,
      targetId: targetId.value,
      basedOnVersion: null,
      ...positionedBindings(),
    },
  }),
});

const openDraft = computed(() => (setId.value ? draftsStore.draftFor(setId.value) : null));
const editCount = computed(() => (isScratch.value ? 0 : openDraft.value?.edits ?? 0));

let draftHandle: ReturnType<typeof setTimeout> | null = null;

/** Debounced, like every other record page's draft: a keystroke is not a save. */
function markEdited() {
  if (isScratch.value || !setId.value) return;
  if (draftHandle) clearTimeout(draftHandle);
  draftHandle = setTimeout(persistDraft, 500);
}

function persistDraft() {
  const id = setId.value;
  if (!id || isScratch.value) return;
  const existing = draftsStore.draftFor(id);
  draftsStore.save({
    id: existing?.id ?? `urn:ui-temp:draft-of-${id}`,
    libraryId: setLibraryId.value || activeLibraryId.value || UNASSIGNED_LIBRARY_ID,
    type: 'query',
    kind: 'draft',
    section: 'argumentSet',
    name: setName.value,
    description: description.value || null,
    queryString: null,
    body: {
      description: description.value,
      scope: scope.value,
      targetId: targetId.value,
      basedOnVersion: null,
      tupleBindings: tupleBindings.value,
      scalarBindings: scalarBindings.value,
      graphBindings: graphBindings.value,
    },
    resultKind: 'BINDINGS',
    inputTuples: [],
    limitParameters: [],
    offsetParameters: [],
    outputs: [],
    basedOn: id,
    edits: (existing?.edits ?? 0) + 1,
  });
  locallySavedAt.value = new Date().toISOString();
}

function removeDraft() {
  const existing = setId.value ? draftsStore.draftFor(setId.value) : null;
  if (existing) draftsStore.remove(existing.id);
  locallySavedAt.value = null;
}

function discardDraft() {
  removeDraft();
  void load();
}

/* ------------------------------------------------------------- inspector */

const workAreaRef = ref<HTMLElement | null>(null);
const {
  panelWidthPercent: leftPanelWidth,
  startResize: startVerticalResize,
  isResizing: isResizingVertical,
  collapsed: rightPanelCollapsed,
  resetWidth: resetPanelWidth,
} = usePanelResize({
  containerRef: workAreaRef,
  storageKey: 'argumentSet',
  collapsible: true,
  initialWidthPercent: 62,
});

const activeTab = ref('details');

const inspectorTabs = computed<InspectorTab[]>(() => [
  { id: 'details', label: 'Details' },
  { id: 'code', label: 'Code' },
]);

const detailsPanelRef = ref<InstanceType<typeof EntityDetailsPanel> | null>(null);

function promptForNameInDetails() {
  activeTab.value = 'details';
  rightPanelCollapsed.value = false;
  void nextTick(() => detailsPanelRef.value?.focusName());
}

const currentVersionNumber = computed(
  () => versions.value.find(version => version.id === currentVersionId.value)?.version ?? null,
);

const versionOptions = computed(() =>
  [...versions.value]
    .sort((a, b) => b.version - a.version)
    .map(version => ({
      value: version.id,
      label: String(version.version),
      // An argument set version has no comment field at all — the API's PATCH
      // accepts nothing but an empty body (#210) — so the column stays blank
      // and there is nothing to annotate.
      comment: null,
      dateModified: version.dateModified ?? version.dateCreated ?? null,
    })),
);

const provenanceKind = computed(() => scope.value);
const provenanceLabel = computed(() => {
  if (!targetId.value || !scope.value) return null;
  return scope.value === 'query' ? 'the query it was made on' : 'the group it was made on';
});

const detailsProps = computed(() => ({
  name: setName.value,
  description: description.value,
  isScratch: isScratch.value,
  entityId: isScratch.value ? null : (setId.value || null),
  entityNoun: 'argument set',
  showBackend: false,
  showSignature: false,
  versionOptions: versionOptions.value,
  selectedVersion: loadedVersionId.value,
  currentVersion: currentVersionId.value,
  // Every version is created current and there is no "point at an older one"
  // story yet, so the control is absent rather than present and inert.
  canSetCurrentVersion: false,
  editCount: editCount.value,
  draftSavedAt: locallySavedAt.value,
  draftSelected: editCount.value > 0,
  createdAt: isScratch.value ? null : setCreatedAt.value,
  canDelete: !isScratch.value && !!setId.value,
  deleting: isDeleting.value,
}));

const codeRequest = computed<SnippetRequest>(() => ({
  method: 'POST',
  url: '/argument-sets',
  body: {
    name: setName.value || 'My arguments',
    libraryId: setLibraryId.value || activeLibraryId.value || 'urn:sqlib:library:…',
    // Pinned, because the snippet is the request a save would send: a linked
    // tuple set travels as `tupleSetVersions`, and the editor's own reference
    // field is not something the body schema accepts.
    ...positionedBindings(pinBindings(tupleBindings.value, tupleSetsStore.currentVersionIdOf).bindings),
  },
}));

const codeUnavailable = computed(() =>
  (activeLibraryId.value || setLibraryId.value) ? null : 'Choose a library first.');

/* ------------------------------------------------------------------ fits */

/**
 * Which callables in this library take these arguments.
 *
 * Judged with the same `compatibility` the switcher uses on a callable's
 * screen, read the other way round: there, one query against many sets; here,
 * one set against many callables. A mismatch stays listed rather than hidden,
 * because "this does not fit anything" is the answer often enough to be worth
 * showing.
 */
async function loadFits() {
  const libraryId = setLibraryId.value || activeLibraryId.value;
  if (!libraryId) {
    fits.value = [];
    return;
  }
  try {
    const queries = (await apiClient.listQueries())
      .filter(query => (query.isPartOf ?? []).includes(libraryId));

    /*
     * A query's signature lives on its version, not on the listing, so this is
     * one request per query — the same shape `loadCurrentVersions` takes for
     * the tuple-set switcher, and bounded by how many queries a library has.
     * A version that will not load contributes no row rather than an
     * unjudgeable one.
     */
    const rows = await Promise.all(queries.map(async (query) => {
      if (!query.currentVersionNumber) return null;
      try {
        const { data } = await apiClient.getQueryVersion(query.id, query.currentVersionNumber);
        /*
         * An input tuple names its members, a member names its variable, and a
         * variable carries the name. All three arrive in the one expanded
         * response, so the chain is walked here rather than paid for as three
         * more requests per query.
         */
        const variableNameById = new Map((data.inputs ?? []).map(input => [input.id, input.variableName]));
        const memberById = new Map((data.tupleMembers ?? []).map(member => [member.id, member]));
        const valuesInputs = (data.inputTuples ?? []).map(tuple =>
          (tuple.memberEntries ?? [])
            .map(memberId => memberById.get(memberId))
            .filter((member): member is NonNullable<typeof member> => member !== undefined)
            .sort((a, b) => a.position - b.position)
            .map(member => variableNameById.get(member.variable) ?? '')
            .map(name => name.replace(/^\?/, ''))
            .filter(name => name.length > 0));

        const signature = buildQuerySignature({
          valuesInputs,
          limitParameters: (data.limitParameters ?? []).map(parameter => String(parameter.name ?? '')),
          offsetParameters: (data.offsetParameters ?? []).map(parameter => String(parameter.name ?? '')),
        });
        const verdict = compatibility(signature, tupleBindings.value);
        return { id: query.id, name: query.name, kind: 'query' as const, verdict: verdict.verdict };
      } catch {
        return null;
      }
    }));
    fits.value = rows.filter((row): row is NonNullable<typeof row> => row !== null);
  } catch {
    // A listing this screen could not read is an empty Fits list, not a broken
    // page: everything else here still works without it.
    fits.value = [];
  }
}

/* ------------------------------------------------------------- lifecycle */

const canSave = computed(() =>
  setName.value.trim().length > 0
  && (tupleBindings.value.length > 0 || scalarBindings.value.length > 0 || graphBindings.value.length > 0));

function selectVersion(versionId: string) {
  loadedVersionId.value = versionId;
}

async function copyArgumentSetId() {
  if (!setId.value) return;
  try {
    await navigator.clipboard.writeText(setId.value);
    toast.success('Argument set ID copied');
  } catch {
    toast.error('Could not copy the ID');
  }
}

async function loadDataGraphOptions() {
  const libraryId = setLibraryId.value || activeLibraryId.value;
  if (!libraryId) return;
  try {
    const graphs = await apiClient.listDataGraphs();
    const options: DataGraphOption[] = [];
    for (const graph of graphs) {
      if (!graph.currentVersion) continue;
      options.push({
        versionId: graph.currentVersion,
        name: graph.name,
        version: 0,
        detail: '',
        graphId: graph.id,
      } as DataGraphOption);
    }
    dataGraphOptions.value = options;
  } catch {
    dataGraphOptions.value = [];
  }
}

async function load() {
  if (!setId.value) return;
  try {
    const detail = await store.getArgumentSet(setId.value);
    setName.value = detail.name;
    description.value = detail.description ?? '';
    scope.value = detail.scope ?? null;
    targetId.value = detail.targetId ?? null;
    setLibraryId.value = detail.libraryId ?? null;
    setCreatedAt.value = detail.dateCreated ?? null;
    currentVersionId.value = detail.currentVersionId ?? null;
    loadedVersionId.value = detail.currentVersionId ?? null;
    tupleBindings.value = detail.currentVersion?.tupleBindings ?? detail.tupleBindings ?? [];
    scalarBindings.value = detail.currentVersion?.scalarBindings ?? detail.scalarBindings ?? [];
    graphBindings.value = detail.currentVersion?.graphBindings ?? detail.graphBindings ?? [];
    versions.value = await store.loadVersions(setId.value);
    await Promise.all([loadDataGraphOptions(), loadFits(), warmReferences()]);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Failed to load the argument set');
  }
}

async function save(payload?: { name?: string }) {
  if (!canSave.value) return;
  const libraryId = setLibraryId.value || activeLibraryId.value;
  if (!libraryId) {
    toast.error('Choose a library first.');
    return;
  }

  isSaving.value = true;
  saveError.value = null;
  try {
    /*
     * Saving is where a linked tuple set stops floating: the reference is
     * resolved to the version current *now* and written as that version, so
     * this saved set keeps meaning what it meant however the tuple set moves
     * afterwards (`docs/explanation/versioning-and-immutability.md`). A
     * reference with nothing to pin to stops the save rather than being
     * dropped out of it — a set silently missing one of its sources runs and
     * answers wrongly.
     */
    await warmReferences();
    const pinned = pinBindings(tupleBindings.value, tupleSetsStore.currentVersionIdOf);
    if (pinned.unresolved.length > 0) {
      toast.error('A linked tuple set has no saved version to pin to. Save the tuple set, or unlink it, then try again.');
      return;
    }

    const bindings = positionedBindings(pinned.bindings);
    if (!setId.value) {
      const created = await store.createArgumentSet({
        name: (payload?.name ?? setName.value).trim(),
        description: description.value.trim() || undefined,
        libraryId,
        scope: scope.value,
        targetId: targetId.value,
        ...bindings,
      });
      setId.value = created.id;
      setLibraryId.value = created.libraryId ?? libraryId;
      currentVersionId.value = created.currentVersionId ?? null;
      loadedVersionId.value = created.currentVersionId ?? null;
      versions.value = await store.loadVersions(created.id);
      emit('scratch-saved', { id: created.id, name: created.name, libraryId });
      toast.success('Saved v1');
    } else {
      const version = await store.createVersion(setId.value, bindings);
      currentVersionId.value = version.id;
      loadedVersionId.value = version.id;
      versions.value = await store.loadVersions(setId.value);
      toast.success(`Saved v${version.version}`);
    }
    if (draftHandle) {
      clearTimeout(draftHandle);
      draftHandle = null;
    }
    removeDraft();
    await loadFits();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save the argument set';
    saveError.value = message;
    toast.error(message);
  } finally {
    isSaving.value = false;
  }
}

async function removeSet() {
  if (!setId.value) return;
  isDeleting.value = true;
  try {
    await store.deleteArgumentSet(setId.value);
    removeDraft();
    emit('argument-set-deleted');
    toast.success('Argument set deleted');
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Failed to delete the argument set');
  } finally {
    isDeleting.value = false;
  }
}

onMounted(() => {
  if (setId.value) void load();
  else void loadDataGraphOptions();
});

watch(() => props.argumentSetId, (next) => {
  setId.value = next ?? null;
  if (next) void load();
});
</script>

<style scoped>
.argument-set-work-area {
  display: flex;
  height: 100%;
  min-width: 0;
}

.left-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}

.left-panel.resizing {
  user-select: none;
}

.body {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-6);
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.group-hint,
.empty-hint {
  margin: 0;
  font-size: var(--text-body);
  color: var(--ink-muted);
}

.empty-hint {
  font-style: italic;
}

.add-row,
.graph-binding,
.scalar-binding {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}

/* The slot, which is the whole of a graph's identity to the group routing it. */
.slot-number {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  margin-bottom: var(--space-2);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  color: var(--ink-muted);
  font-size: var(--text-body);
  font-variant-numeric: tabular-nums;
}

.graph-actions {
  display: flex;
  gap: 4px;
}


.text-input {
  padding: var(--space-2) var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  font-size: var(--text-body-lg);
  min-width: 140px;
}

.ghost-button,
.link-button {
  background: none;
  border: 1px solid transparent;
  cursor: pointer;
  font-size: var(--text-body);
  color: var(--action);
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius);
}

.ghost-button {
  border-color: var(--border-default);
  color: inherit;
}

.ghost-button:disabled,
.link-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.fits-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.fits-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--text-body-lg);
}

.fits-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fits-verdict {
  font-size: var(--text-label);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-full);
  border: 1px solid var(--border-default);
}

.fits-verdict--fits {
  border-color: var(--success);
  color: var(--success);
}

.fits-verdict--partial {
  border-color: var(--warning);
  color: var(--warning);
}

.fits-verdict--mismatch {
  color: var(--ink-muted);
}

.provenance {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: var(--space-4) var(--space-5);
  font-size: var(--text-body);
}

.provenance-label {
  color: var(--ink-muted);
}

.save-error {
  margin: 0;
  color: var(--danger);
  font-size: var(--text-body);
}

.vertical-resizer {
  width: 6px;
  cursor: col-resize;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
}

.vertical-resizer.hidden {
  display: none;
}

.resizer-handle {
  width: 2px;
  height: 32px;
  background: var(--gray-600);
  border-radius: var(--radius-sm);
}

.right-panel {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.right-panel.collapsed {
  flex: 0 0 48px;
}
</style>
