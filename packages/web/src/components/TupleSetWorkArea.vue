<template>
  <div ref="workAreaRef" class="tuple-set-work-area">
    <div
      class="left-panel"
      :class="{ resizing: isResizingVertical }"
      :style="{ width: rightPanelCollapsed ? 'calc(100% - 48px)' : leftPanelWidth + '%' }"
    >
      <SaveBar
        :title="setName"
        noun="tuple set"
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
        The body is the rows and nothing else. What the set is called, what it
        is for, and what has been saved of it are the Details tab's — the
        same panel a query, a group and a rule set answer those questions in.
      -->
      <div class="body">
        <section class="group group-grow">
          <SectionLabel as="h3" size="md">Rows</SectionLabel>
          <InlineNote class="group-hint">
            Named rows, registered in this library. They fill a query's VALUES
            clause or a rule set's TUPLE(…) declaration — spliced in at execution
            and consumed. A data graph is the store something runs against; these
            are the parameters it runs with. Stored as SPARQL Results JSON, so a
            version means the same thing forever: build the rows here, or bring
            them in from a file — either way the server's parser decides what a
            cell is, and what you see below is what will execute.
          </InlineNote>

          <div class="mode-toggle" role="group" aria-label="How to enter rows">
            <button
              type="button"
              class="mode-button"
              :class="{ 'mode-button--selected': mode === 'build' }"
              data-testid="tuple-set-mode-build"
              :disabled="converting"
              @click="chooseMode('build')"
            >
              Build
            </button>
            <button
              type="button"
              class="mode-button"
              :class="{ 'mode-button--selected': mode === 'import' }"
              data-testid="tuple-set-mode-import"
              :disabled="converting"
              @click="chooseMode('import')"
            >
              Import
            </button>
            <InlineNote v-if="converting" as="span">Reading the rows…</InlineNote>
          </div>

          <!--
            Said where the labels are edited, because this is the screen that
            would otherwise imply they are identifiers. They are kept — names
            are useful for reading a table, diffing two versions, surviving a
            CSV import and pre-filling a conversion — and they are never read
            when this set fills a parameter.
          -->
          <InlineNote v-if="mode === 'build'" class="labels-note" data-testid="tuple-set-labels-note">
            <strong>Column names are labels.</strong>
            A <code>TUPLE(…)</code> is matched by arity and position; these names are never read when this
            tuple set fills a parameter. They are here so you can read the table.
          </InlineNote>

          <TupleRowsBuilder
            v-if="mode === 'build'"
            :columns="builderColumns"
            :rows="builderRows"
            data-testid="tuple-set-builder"
            @update:columns="onBuilderColumns"
            @update:rows="onBuilderRows"
          />

          <template v-else>
          <Toolbar variant="plain" wrap>
            <template #start>
              <FormField label="Source format">
                <select
                  class="control control-inline"
                  data-testid="tuple-set-source-format"
                  :value="sourceFormat"
                  @change="onFormatChosen"
                >
                  <option v-for="format in TUPLE_IMPORT_FORMATS" :key="format.value" :value="format.value">
                    {{ format.label }}
                  </option>
                </select>
              </FormField>
              <button class="upload-button" type="button" data-testid="tuple-set-upload" @click="pickFile">
                <Upload :size="13" />
                Upload a file…
              </button>
              <input
                ref="fileInputRef"
                class="file-input"
                type="file"
                data-testid="tuple-set-file"
                :accept="ACCEPTED_EXTENSIONS"
                @change="onFileChosen"
              />
            </template>
            <span class="content-meta" data-testid="tuple-set-size">{{ sizeSummary }}</span>
          </Toolbar>

          <!--
            What the chosen format means for typing, stated where the choice is
            made. Plain TSV and SPARQL Results TSV share an extension and differ
            entirely in what a cell is, so the difference has to be readable
            without opening the docs — misreading one as the other would type, or
            un-type, a whole dataset invisibly.
          -->
          <InlineNote class="format-hint" data-testid="tuple-set-format-hint">{{ formatHint }}</InlineNote>

          <p v-if="sniffedFormat && sniffedFormat !== sourceFormat" class="format-nudge" data-testid="tuple-set-format-nudge">
            This looks like {{ labelFor(sniffedFormat) }}.
            <button class="link-button" type="button" @click="acceptSniff">Use that instead</button>
          </p>

          <textarea
            v-model="contentString"
            class="content-editor"
            data-testid="tuple-set-content"
            spellcheck="false"
            :placeholder="editorPlaceholder"
          />

          <p v-if="importError" class="save-error" data-testid="tuple-set-import-error">{{ importError }}</p>
          </template>

          <p v-if="saveError" class="save-error" data-testid="tuple-set-error">{{ saveError }}</p>
          <p v-if="mode === 'build' && !builderValid && builderColumns.length > 0" class="save-error" data-testid="tuple-set-builder-invalid">
            Every column needs a name before this can be saved.
          </p>
        </section>

        <!--
          The rows as the server's parser reads them, from the text in the editor
          right now — not from the last saved version, and never from a
          second parser in the browser. `POST /tuple-sets/preview` runs exactly
          what a save would run and stops before the write, so the preview
          cannot promise something the save then disagrees with.
        -->
        <section v-if="mode === 'import' && previewRows.length > 0" class="group">
          <SectionLabel as="h3" size="md">Preview</SectionLabel>
          <InlineNote class="group-hint">
            {{ previewColumns.length }}
            {{ previewColumns.length === 1 ? 'column' : 'columns' }},
            {{ previewRowCount }} {{ previewRowCount === 1 ? 'row' : 'rows' }} —
            parsed as {{ labelFor(sourceFormat) }}. A blank cell is UNDEF, which
            binds nothing.
          </InlineNote>

          <!--
            Auto-suggest typing (issue #208): every value in a column that is
            still plain strings, and how it reads. A proposal the author
            accepts or rejects per column — checking it here is what makes
            the outcome persist; the column stays plain strings otherwise.
          -->
          <div v-if="columnTypeSuggestions.length > 0" class="type-suggestions" data-testid="tuple-set-type-suggestions">
            <span class="type-suggestions-label">Looks typed:</span>
            <label
              v-for="suggestion in columnTypeSuggestions"
              :key="suggestion.column"
              class="type-suggestion"
            >
              <input
                type="checkbox"
                :data-testid="`tuple-set-type-suggestion-${suggestion.column}`"
                :checked="isColumnTypeAccepted(suggestion.column)"
                @change="onToggleColumnType(suggestion)"
              />
              <code>?{{ suggestion.column }}</code> is {{ suggestedColumnTypeLabel(suggestion.suggested) }}
            </label>
          </div>

          <div class="table-scroll">
            <table class="rows-table" data-testid="tuple-set-preview">
              <thead>
                <tr>
                  <th v-for="column in previewColumns" :key="column">?{{ column }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, index) in previewRows" :key="index">
                  <td v-for="column in previewColumns" :key="column">
                    <span v-if="cellText(row, column)" class="cell-value">{{ cellText(row, column) }}</span>
                    <span v-else class="cell-undef">—</span>
                    <span v-if="cellAnnotation(row[column])" class="cell-annotation">
                      {{ cellAnnotation(row[column]) }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="previewRowCount > previewRows.length" class="preview-more">
            Showing the first {{ previewRows.length }} of {{ previewRowCount }} rows.
          </p>
        </section>
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

    <!--
      The same inspector every other record page carries, with the two tabs a
      tuple set has: what it is, and how to put rows here from your own code.
      There is nothing to execute, so there is no Results tab.
    -->
    <div class="right-panel" :class="{ collapsed: rightPanelCollapsed }">
      <InspectorPanel
        v-model:active-tab="activeTab"
        v-model:collapsed="rightPanelCollapsed"
        :tabs="inspectorTabs"
        testid="tuple-set-inspector"
      >
        <template #details>
          <EntityDetailsPanel
            ref="detailsPanelRef"
            v-bind="detailsProps"
            @update:name="setName = $event"
            @update:description="description = $event"
            @select-version="selectVersion"
            @set-current-version="setCurrentVersion"
            @annotate-version="annotateVersion"
            @select-draft="selectDraft"
            @copy-id="copyTupleSetId"
            @delete="removeSet"
          />
        </template>

        <!--
          A tuple set is not executable, so its Code tab answers the other
          question: how do I put rows here from my own code? That is the call
          Save makes.
        -->
        <template #code>
          <CodeSnippetPanel
            :request="codeRequest"
            :unavailable="codeUnavailable"
            :arguments-hint="codeContentHint"
          />
        </template>
      </InspectorPanel>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * One tuple set: what it is called, the rows in it, and its versions.
 *
 * The tabular sibling of `DataGraphWorkArea`, and deliberately its twin in
 * lifecycle — scratch, draft, save, immutable versions — because the two
 * entities differ in the shape of their content and in nothing else about how
 * a library holds them.
 *
 * Where it diverges is import. A data graph stores the bytes it was given; a
 * tuple set stores the *outcome* of parsing them, because the reading is part
 * of the meaning: the same TSV is one dataset read as plain strings and a
 * different one read as typed RDF terms. So the editor holds source text plus
 * an explicit statement of which dialect it is in, and what gets persisted is
 * the normalised SPARQL Results JSON the server produced — which is why the
 * preview below shows the stored version rather than the editor's contents.
 * See `docs/concepts.md`.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { toast } from 'vue-sonner';
import { Upload } from '@lucide/vue';
import InlineNote from './shared/InlineNote.vue';
import SaveBar from './shared/SaveBar.vue';
import FormField from './shared/FormField.vue';
import SectionLabel from './shared/SectionLabel.vue';
import Toolbar from './shared/Toolbar.vue';
import CodeSnippetPanel from './shared/CodeSnippetPanel.vue';
import InspectorPanel, { type InspectorTab } from './shared/InspectorPanel.vue';
import EntityDetailsPanel from './shared/EntityDetailsPanel.vue';
import TupleRowsBuilder from './tuple-sets/TupleRowsBuilder.vue';
// @ts-ignore - Nuxt auto-import
import { useRuntimeConfig } from '#imports';
import type { SnippetRequest } from '@/lib/codeSnippets';
import { useTupleSetsStore } from '@/composables/useTupleSetsStore';
import { usePanelResize } from '@/composables/usePanelResize';
import { useApiClient, type TupleSetVersion } from '@/composables/useApiClient';
import { useActiveLibrary } from '@/composables/useActiveLibrary';
import { useScratchRecord } from '@/composables/useScratchRecord';
import { useServerLimits } from '@/composables/useServerLimits';
import { useCallableDrafts, UNASSIGNED_LIBRARY_ID } from '@/composables/useCallableDrafts';
import {
  TUPLE_IMPORT_FORMATS,
  SUGGESTED_COLUMN_TYPE_LABELS,
  cellAnnotation,
  cellText,
  readTupleDocument,
  type ColumnTypeSuggestion,
  type SuggestedColumnType,
  type TupleSourceFormat,
} from '@/types/tuple-sets';
import type { SparqlBinding } from '@/types/argument-sets';

/**
 * How the rows are being entered.
 *
 * Not a property of the tuple set — the same rows can be typed or pasted, and
 * the stored version cannot tell which happened. It is remembered per record
 * only so a reload puts you back where you were working.
 */
type RowsMode = 'build' | 'import';

const props = defineProps<{
  tupleSetId?: string | null;
  scratchId?: string | null;
}>();

const emit = defineEmits<{
  (e: 'scratch-saved', payload: { id: string; name: string; libraryId: string }): void;
  (e: 'tuple-set-deleted'): void;
}>();

const store = useTupleSetsStore();
const apiClient = useApiClient();
const { activeLibraryId } = useActiveLibrary();
const draftsStore = useCallableDrafts();

const setId = ref<string | null>(props.tupleSetId ?? null);
const setName = ref('');
const description = ref('');
const contentString = ref('');
const sourceFormat = ref<TupleSourceFormat>('csv');
const versions = ref<TupleSetVersion[]>([]);
const currentVersionId = ref<string | null>(null);
const isSaving = ref(false);
const isDeleting = ref(false);
const saveError = ref<string | null>(null);
const setCreatedAt = ref<string | null>(null);

/**
 * Which version the editor was loaded from, and what it held.
 *
 * The pair is what the Details tab's version list highlights and what tells a
 * draft from an unmodified read: the editor is showing the draft exactly when
 * its text has diverged from the version it was loaded from.
 */
const loadedVersionId = ref<string | null>(null);
const loadedVersionContent = ref('');
/** What the server's sniffer thinks, when it disagrees with the choice made. */
const sniffedFormat = ref<TupleSourceFormat | null>(null);

const mode = ref<RowsMode>('build');
/** Set while the server is turning pasted text into rows, which disables the toggle. */
const converting = ref(false);
/** A parse failure on the current text — shown under the editor, not as a toast. */
const importError = ref<string | null>(null);

/*
 * The builder's model is SPARQL Results JSON in pieces: `builderColumns` is
 * `head.vars` and `builderRows` is `results.bindings`. Serialising the two is
 * the whole of "saving from the builder", which is why building needs no
 * import step and no source format of its own.
 */
const builderColumns = ref<string[]>([]);
const builderRows = ref<SparqlBinding[]>([]);

/** Live rows for the import preview, as the server's parser read them. */
const previewDoc = ref<{ columns: string[]; rows: SparqlBinding[]; rowCount: number } | null>(null);

/**
 * Column-type auto-suggestion (issue #208): what the server proposes for the
 * current text, and which of those proposals the author has accepted.
 *
 * `acceptedColumnTypes` is import-time state only — it is sent alongside the
 * next save and then forgotten, never a property of a saved version. Kept as
 * its own map (column → type) rather than a flag on the suggestion, since a
 * suggestion is recomputed on every preview and an acceptance should survive
 * exactly as long as the suggestion it was made for.
 */
const columnTypeSuggestions = ref<ColumnTypeSuggestion[]>([]);
const acceptedColumnTypes = reactive<Record<string, SuggestedColumnType>>({});

function suggestedColumnTypeLabel(type: SuggestedColumnType): string {
  return SUGGESTED_COLUMN_TYPE_LABELS[type];
}

function isColumnTypeAccepted(column: string): boolean {
  return column in acceptedColumnTypes;
}

function onToggleColumnType(suggestion: ColumnTypeSuggestion) {
  if (isColumnTypeAccepted(suggestion.column)) {
    delete acceptedColumnTypes[suggestion.column];
  } else {
    acceptedColumnTypes[suggestion.column] = suggestion.suggested;
  }
  // Accepting or rejecting is a direct action, not typing — the preview
  // (and what a save would persist) should reflect it immediately rather
  // than waiting for the next debounced tick.
  previewedFor = '';
  void refreshPreview();
}

/** Drop an acceptance the current text no longer backs, matching type as well as name. */
function pruneAcceptedColumnTypes(current: ColumnTypeSuggestion[]) {
  const stillSuggested = new Map(current.map((s) => [s.column, s.suggested]));
  for (const column of Object.keys(acceptedColumnTypes)) {
    if (stillSuggested.get(column) !== acceptedColumnTypes[column]) {
      delete acceptedColumnTypes[column];
    }
  }
}

interface TupleSetBody {
  description?: string;
  contentString?: string;
  sourceFormat?: TupleSourceFormat;
  mode?: RowsMode;
}

const { isScratch } = useScratchRecord({
  scratchId: () => props.scratchId ?? null,
  missingMessage: 'That scratch tuple set is not in this browser',
  track: [setName, description, contentString, sourceFormat],
  hydrate: (record) => {
    const body = (record.body ?? {}) as TupleSetBody;
    setName.value = record.name;
    description.value = body.description ?? '';
    contentString.value = body.contentString ?? '';
    sourceFormat.value = body.sourceFormat ?? 'csv';
    mode.value = body.mode ?? 'build';
    if (mode.value === 'build') adoptBuilderFrom(contentString.value);
  },
  collect: (record) => ({
    name: setName.value || record.name,
    body: {
      description: description.value,
      contentString: contentString.value,
      sourceFormat: sourceFormat.value,
      mode: mode.value,
    },
  }),
});

const currentVersionNumber = computed(
  () => versions.value.find((version) => version.id === currentVersionId.value)?.version ?? null,
);

/* ------------------------------------------------------------- inspector */

/*
 * The same split every other work area drags on, with the same floors and the
 * same remembered width (`usePanelResize`).
 */
const workAreaRef = ref<HTMLElement | null>(null);
const {
  panelWidthPercent: leftPanelWidth,
  startResize: startVerticalResize,
  isResizing: isResizingVertical,
  collapsed: rightPanelCollapsed,
  resetWidth: resetPanelWidth,
} = usePanelResize({
  containerRef: workAreaRef,
  storageKey: 'tupleSet',
  collapsible: true,
  initialWidthPercent: 62,
});

/* Details first: opening a set, the question is what this is. */
const activeTab = ref('details');

const inspectorTabs = computed<InspectorTab[]>(() => [
  { id: 'details', label: 'Details' },
  { id: 'code', label: 'Code' },
]);

const detailsPanelRef = ref<InstanceType<typeof EntityDetailsPanel> | null>(null);

/** Save on an unnamed set sends you to the one field that names it. */
function promptForNameInDetails() {
  activeTab.value = 'details';
  rightPanelCollapsed.value = false;
  void nextTick(() => detailsPanelRef.value?.focusName());
}

/*
 * The Details tab. One prop bag rather than a dozen props, as on the query and
 * rule set screens: it is a single view of this component's state.
 */
const detailsProps = computed(() => ({
  name: setName.value,
  description: description.value,
  isScratch: isScratch.value,
  entityId: isScratch.value ? null : (setId.value || null),
  entityNoun: 'tuple set',
  // No Tags row: a tuple set is not one of the taggable kinds the model
  // supports (tags doc §4.6), and a control that always failed would be worse
  // than none.
  showBackend: false,
  showSignature: false,
  versionOptions: versionOptions.value,
  selectedVersion: loadedVersionId.value,
  currentVersion: currentVersionId.value,
  // A scratch set has no server entity to point at anything.
  canSetCurrentVersion: !isScratch.value,
  canAnnotateVersions: !isScratch.value && !!setId.value,
  editCount: editCount.value,
  draftSavedAt: locallySavedAt.value,
  // The editor is showing the draft whenever its text has diverged from the
  // version it was loaded from.
  draftSelected: editCount.value > 0
    && contentString.value.trim() !== loadedVersionContent.value.trim(),
  createdAt: isScratch.value ? null : setCreatedAt.value,
  // A scratch set lives in this browser: Discard in the save bar is what
  // removes it, and there is no server entity for Delete to address.
  canDelete: !isScratch.value && !!setId.value,
  deleting: isDeleting.value,
}));

/**
 * The version rows, newest first.
 *
 * A version's comment is what its author said about it; where there is none,
 * the row says what the server measured instead — rows, columns, size and the
 * dialect it was read from — which is what the list under the editor used to
 * show.
 */
const versionOptions = computed(() =>
  [...versions.value]
    .sort((a, b) => b.version - a.version)
    .map((version) => ({
      value: version.id,
      label: String(version.version),
      // The note and the stand-in for it are separate: editing a version
      // nobody commented starts from an empty field, not from the summary.
      comment: version.comment ?? null,
      summary: versionSummary(version),
      dateModified: version.dateModified ?? version.dateCreated ?? null,
    })),
);

function versionSummary(version: TupleSetVersion) {
  const rows = version.rowCount ?? 0;
  const columns = (version.tupleColumns ?? []).length;
  const from = version.sourceFormat ? ` · from ${labelFor(version.sourceFormat)}` : '';
  return `${rows} ${rows === 1 ? 'row' : 'rows'} · ${columns} cols · ${formatBytes(version.byteSize)}${from}`;
}

/** Read one of the saved versions back into the editor. */
function selectVersion(versionId: string) {
  const version = versions.value.find((candidate) => candidate.id === versionId);
  if (version) showVersion(version);
}

/** Go back to the unsaved edits after reading an older version. */
function selectDraft() {
  const draft = draftBody.value;
  if (!draft) return;
  if (typeof draft.contentString === 'string') contentString.value = draft.contentString;
  if (draft.sourceFormat) sourceFormat.value = draft.sourceFormat;
  if (mode.value === 'build') adoptBuilderFrom(contentString.value);
  loadedVersionId.value = currentVersionId.value;
  loadedVersionContent.value = savedContent.value;
}

/**
 * Point the set at one of its versions.
 *
 * The editor keeps showing whatever it was showing: choosing what a caller
 * with no version pinned gets is not a request to read that version.
 */
async function setCurrentVersion(versionId: string) {
  if (!setId.value) return;
  try {
    await store.updateTupleSet(setId.value, { currentVersion: versionId } as never);
    currentVersionId.value = versionId;
    const version = versions.value.find((candidate) => candidate.id === versionId);
    toast.success(version ? `v${version.version} is now current` : 'Current version updated');
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Failed to set the current version');
  }
}

/*
 * The note on a version, written from the row that displays it.
 *
 * Save collects nothing now — it is one click — so this is where a version
 * gets its comment, against the version it describes and at any time after it
 * exists. Optimistic, with the old note put back if the write fails.
 */
async function annotateVersion({ value, comment }: { value: string; comment: string | null }) {
  const id = setId.value;
  const version = versions.value.find((candidate) => candidate.id === value);
  if (!id || !version) return;

  const previous = version.comment ?? null;
  const apply = (next: string | null) => {
    versions.value = versions.value.map((entry) => (
      entry.id === value ? { ...entry, comment: next } : entry
    ));
  };
  apply(comment);

  try {
    await store.annotateVersion(id, version.version, comment);
  } catch (error) {
    apply(previous);
    console.error('[TupleSetWorkArea] Failed to save the version note', error);
    toast.error('Failed to save the note');
  }
}

async function copyTupleSetId() {
  if (!setId.value) return;
  try {
    await navigator.clipboard.writeText(setId.value);
    toast.success('Tuple set ID copied');
  } catch {
    toast.error('Could not copy the ID');
  }
}

/**
 * Provenance values no import dialog offers, because they are not chosen: they
 * are what "save these results" and the ETL sink (#211) write. The versions
 * list still needs a word for each.
 */
const DERIVED_FORMAT_LABELS: Record<string, string> = {
  'query-results': 'query results',
  'etl-results': 'ETL results',
};

function labelFor(format: TupleSourceFormat | string): string {
  return TUPLE_IMPORT_FORMATS.find((entry) => entry.value === format)?.label
    ?? DERIVED_FORMAT_LABELS[format]
    ?? String(format);
}

const formatHint = computed(
  () => TUPLE_IMPORT_FORMATS.find((entry) => entry.value === sourceFormat.value)?.hint ?? '',
);

const editorPlaceholder = computed(() =>
  sourceFormat.value === 'sparql-results-json'
    ? '{"head": {"vars": ["city"]}, "results": {"bindings": [{"city": {"type": "literal", "value": "Paris"}}]}}'
    : sourceFormat.value === 'sparql-results-tsv'
      ? '?city\t?population\n<http://example.org/Paris>\t2161000'
      : 'city,population\nParis,2161000',
);

/* ---------------------------------------------------------------- preview */

const previewColumns = computed(() => previewDoc.value?.columns ?? []);
const previewRowCount = computed(() => previewDoc.value?.rowCount ?? 0);

/**
 * Capped, because a tuple set is allowed to be large and a table is not a
 * viewer. The count above the grid is the version's own, so the cap never
 * misreports how much is stored.
 */
const PREVIEW_ROW_LIMIT = 50;
const previewRows = computed(() => (previewDoc.value?.rows ?? []).slice(0, PREVIEW_ROW_LIMIT));

/* ------------------------------------------------------------ draft state */

const setLibraryId = ref<string | null>(null);
/** When the browser-local draft was last written, for the Details draft row. */
const locallySavedAt = ref<string | null>(null);
let draftSaveHandle: ReturnType<typeof setTimeout> | null = null;
/** Set while a set is being read from the server, so a load is not an edit. */
const hydratingRecord = ref(false);

/** The body the editor was last loaded from, to compare against. */
const savedContent = ref('');
const savedFormat = ref<TupleSourceFormat>('csv');

const openDraft = computed(() => {
  void draftsStore.allDrafts.value;
  return setId.value ? draftsStore.draftFor(setId.value) : null;
});

const editCount = computed(() => (isScratch.value ? 0 : openDraft.value?.edits ?? 0));

const draftBody = computed(() => {
  const body = openDraft.value?.body;
  return body && typeof body === 'object' ? (body as TupleSetBody) : null;
});

/** Typing back to what is saved is an undo, not an edit. */
const matchesSaved = () =>
  contentString.value.trim() === savedContent.value.trim()
  && sourceFormat.value === savedFormat.value;

function persistDraft() {
  const id = setId.value;
  if (!id || isScratch.value) return;
  const existing = draftsStore.draftFor(id);
  draftsStore.save({
    id: existing?.id ?? `urn:ui-temp:draft-of-${id}`,
    libraryId: setLibraryId.value || activeLibraryId.value || UNASSIGNED_LIBRARY_ID,
    type: 'query',
    kind: 'draft',
    section: 'tupleSet',
    name: setName.value,
    description: description.value || null,
    queryString: null,
    body: {
      description: description.value,
      contentString: contentString.value,
      sourceFormat: sourceFormat.value,
      mode: mode.value,
    } satisfies TupleSetBody,
    // Rows are a solution sequence — the stored form is literally SPARQL
    // Results JSON — so BINDINGS is what they are, not an approximation.
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
  const id = setId.value;
  if (!id) return;
  const existing = draftsStore.draftFor(id);
  if (existing) draftsStore.remove(existing.id);
  locallySavedAt.value = null;
}

watch([contentString, sourceFormat, description], () => {
  if (isScratch.value || hydratingRecord.value) return;
  if (!setId.value) return;
  if (draftSaveHandle) clearTimeout(draftSaveHandle);
  draftSaveHandle = setTimeout(() => {
    draftSaveHandle = null;
    if (matchesSaved()) {
      removeDraft();
      return;
    }
    persistDraft();
  }, 500);
});

/** Throw the unsaved edits away and go back to the saved version. */
function discardDraft() {
  if (draftSaveHandle) {
    clearTimeout(draftSaveHandle);
    draftSaveHandle = null;
  }
  removeDraft();
  hydratingRecord.value = true;
  contentString.value = savedContent.value;
  sourceFormat.value = savedFormat.value;
  if (mode.value === 'build') adoptBuilderFrom(savedContent.value);
  void Promise.resolve().then(() => { hydratingRecord.value = false; });
  toast.success('Draft discarded');
}

const canSave = computed(() => {
  if (!setName.value.trim() || !contentString.value.trim()) return false;
  // A grid with no columns serialises to a syntactically fine document that
  // binds nothing, so emptiness has to be judged on the model rather than on
  // the text it produces.
  if (mode.value === 'build' && !builderValid.value) return false;
  if (isScratch.value || !setId.value) return true;
  // Saving an unchanged body would mint a version identical to the last
  // one. Nothing to save is not an error, it is a disabled button.
  return editCount.value > 0;
});

/** What is in the editor now, before the server has parsed anything. */
const sizeSummary = computed(() => {
  const bytes = new Blob([contentString.value]).size;
  if (bytes === 0) return 'empty';
  const lines = contentString.value.split('\n').filter((line) => line.trim().length > 0).length;
  return `${formatBytes(bytes)} · ${lines} ${lines === 1 ? 'line' : 'lines'}`;
});

/* -------------------------------------------------------------------- code */

/*
 * The save call, in the reader's language.
 *
 * `POST /tuple-sets/{id}/versions` — what the Save button sends once the set
 * exists. A set that does not exist yet is created by `POST /tuple-sets` first,
 * which is why a scratch set gets a message instead of a snippet it could not
 * run.
 */
const config = useRuntimeConfig();

/** Past this, the rows go in as a placeholder: a snippet is to read, not to scroll. */
const INLINE_CONTENT_LIMIT = 2000;

const contentIsInlined = computed(() => contentString.value.length <= INLINE_CONTENT_LIMIT);

const codeRequest = computed<SnippetRequest>(() => {
  const apiBaseUrl = String(config.public.apiBaseUrl).replace(/\/$/, '');
  const id = setId.value || '<tuple-set-id>';
  return {
    method: 'POST',
    url: `${apiBaseUrl}/tuple-sets/${encodeURIComponent(id)}/versions`,
    body: {
      contentString: contentIsInlined.value ? contentString.value : '<the rows, as text>',
      sourceFormat: sourceFormat.value,
    },
  };
});

const codeUnavailable = computed(() =>
  setId.value
    ? null
    : 'This tuple set has not been saved yet — save it once to get an id, then versions go to the call below.',
);

const codeContentHint = computed(() => {
  if (!contentIsInlined.value) {
    return `The rows are stood in for: ${contentString.value.length} characters is too many to read in a snippet. Send your own rows in their place.`;
  }
  // In Build mode there is no format to choose — what the grid emits is already
  // the stored form, and the snippet says so rather than implying a dialect.
  return mode.value === 'build'
    ? 'The rows are the ones in the grid above, already in the stored form.'
    : 'The rows are the ones in the editor above, in the source format selected there.';
});

/* ----------------------------------------------------------------- builder */

/** Names are required to save, but not to type — see `renameColumn`. */
const builderValid = computed(
  () => builderColumns.value.length > 0 && builderColumns.value.every((name) => name.trim().length > 0),
);

/**
 * The builder's rows as the stored document.
 *
 * A blank cell is dropped rather than written, because UNDEF in this format is
 * an absent key: `{"city": {"value": ""}}` binds the empty literal, which
 * matches nothing and reads as a bug in the data. Same rule the arguments
 * panel's `pruneUndef` applies on its way out.
 */
function serialiseBuilder(): string {
  const bindings = builderRows.value.map((row) => {
    const out: SparqlBinding = {};
    for (const column of builderColumns.value) {
      const term = row[column];
      if (!term || (term.value ?? '').trim().length === 0) continue;
      out[column] = term;
    }
    return out;
  });
  return JSON.stringify({ head: { vars: builderColumns.value }, results: { bindings } });
}

/** Push the builder's state into the fields the draft and save paths read. */
function syncFromBuilder() {
  contentString.value = serialiseBuilder();
  // What the builder emits already *is* the stored form, so the source format
  // is not a choice here — stating anything else would be a false provenance.
  sourceFormat.value = 'sparql-results-json';
  sniffedFormat.value = null;
  importError.value = null;
}

function onBuilderColumns(next: string[]) {
  builderColumns.value = next;
  syncFromBuilder();
}

function onBuilderRows(next: SparqlBinding[]) {
  builderRows.value = next;
  syncFromBuilder();
}

/** Load stored SRJ into the grid. Safe on junk — `readTupleDocument` is total. */
function adoptBuilderFrom(text: string) {
  const parsed = readTupleDocument(text);
  builderColumns.value = parsed.columns;
  builderRows.value = parsed.rows;
}

/**
 * Switch between typing rows and pasting them.
 *
 * Going to Build has to turn the editor's text into rows, and only the server
 * can do that faithfully for CSV or TSV — a parser in the browser would be a
 * second implementation of the one thing a version's meaning depends on. So
 * the conversion is a round trip, and a failure leaves the mode where it was
 * rather than dropping the author into an empty grid.
 */
async function chooseMode(next: RowsMode) {
  if (mode.value === next || converting.value) return;

  if (next === 'import') {
    // Nothing to convert: the builder has been writing SRJ into `contentString`
    // all along, and that is exactly what the import editor edits.
    mode.value = 'import';
    void refreshPreview();
    return;
  }

  if (!contentString.value.trim()) {
    builderColumns.value = [];
    builderRows.value = [];
    mode.value = 'build';
    return;
  }

  converting.value = true;
  importError.value = null;
  try {
    const parsed = await apiClient.previewTupleContent(
      contentString.value,
      sourceFormat.value,
      { ...acceptedColumnTypes },
    );
    adoptBuilderFrom(parsed.contentString);
    mode.value = 'build';
    syncFromBuilder();
    // Any accepted type is now baked into the builder's rows rather than a
    // pending suggestion — carrying it forward would try to apply it a second
    // time on save and be refused as already-typed.
    Object.keys(acceptedColumnTypes).forEach((column) => delete acceptedColumnTypes[column]);
    columnTypeSuggestions.value = [];
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not read those rows';
    importError.value = message;
    toast.error(message);
  } finally {
    converting.value = false;
  }
}

/* ----------------------------------------------------------- live preview */

let previewHandle: ReturnType<typeof setTimeout> | null = null;
/** The text the preview on screen belongs to, so an unchanged body is not re-parsed. */
let previewedFor = '';

async function refreshPreview() {
  const text = contentString.value;
  const key = `${sourceFormat.value}\u0000${text}`;
  if (key === previewedFor) return;

  if (!text.trim()) {
    previewDoc.value = null;
    importError.value = null;
    columnTypeSuggestions.value = [];
    previewedFor = key;
    return;
  }

  try {
    // As-is first, so the suggestion list reflects this edit before any
    // accepted type is forced onto it — an edit that breaks a previously
    // accepted column (a non-numeric value lands in what was an integer
    // column) must drop that acceptance rather than surface as a parse error.
    const base = await apiClient.previewTupleContent(text, sourceFormat.value);
    const suggestions = base.columnTypeSuggestions ?? [];
    columnTypeSuggestions.value = suggestions;
    pruneAcceptedColumnTypes(suggestions);

    const accepted = { ...acceptedColumnTypes };
    const parsed = Object.keys(accepted).length > 0
      ? await apiClient.previewTupleContent(text, sourceFormat.value, accepted)
      : base;

    const document = readTupleDocument(parsed.contentString);
    previewDoc.value = {
      columns: parsed.tupleColumns,
      rows: document.rows,
      rowCount: parsed.rowCount,
    };
    importError.value = null;
  } catch (error) {
    // A parse failure is the useful half of the preview: it is the same error
    // saving would return, arriving before the author asks for it.
    previewDoc.value = null;
    importError.value = error instanceof Error ? error.message : 'Could not read those rows';
  } finally {
    previewedFor = key;
  }
}

watch([contentString, sourceFormat, mode], () => {
  if (mode.value !== 'import') {
    previewDoc.value = null;
    return;
  }
  if (previewHandle) clearTimeout(previewHandle);
  // Longer than the draft autosave: this is a round trip over content that can
  // be a megabyte, and it costs nothing to be a beat behind the typing.
  previewHandle = setTimeout(() => {
    previewHandle = null;
    void refreshPreview();
  }, 700);
});

/* ------------------------------------------------------------------ import */

/**
 * Extensions offered in the file picker, and the format each *starts* from.
 *
 * `.tsv` maps to plain TSV rather than the SPARQL-results dialect because that
 * is the safer of the two to be wrong about: reading typed terms as strings is
 * visible in the preview, while reading strings as terms fails the import
 * outright. The sniffer corrects it either way — see `refreshSniff`.
 */
const EXTENSION_FORMATS: Record<string, TupleSourceFormat> = {
  '.csv': 'csv',
  '.tsv': 'tsv',
  '.tab': 'tsv',
  '.txt': 'csv',
  '.json': 'sparql-results-json',
  '.srj': 'sparql-results-json',
};

const ACCEPTED_EXTENSIONS = Object.keys(EXTENSION_FORMATS).join(',');

/**
 * Refused before reading.
 *
 * The same cap the server enforces, read from it rather than restated here:
 * both are environment variables on the API, and a copy in the SPA meant a
 * deployment that raised the server's still had uploads refused at the old
 * figure. Refusing early is the point — reading a very large file into a string
 * to be told no is a hung tab, not a validation message.
 */
const { limits: serverLimits, ensureLoaded: loadServerLimits } = useServerLimits();

const fileInputRef = ref<HTMLInputElement | null>(null);

function pickFile() {
  fileInputRef.value?.click();
}

async function onFileChosen(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  // Cleared immediately so choosing the same file twice fires `change` again.
  input.value = '';
  if (!file) return;

  if (file.size > serverLimits.value.tupleSetVersionBytes) {
    const message = `${file.name} is ${formatBytes(file.size)} — the limit is `
      + `${formatBytes(serverLimits.value.tupleSetVersionBytes)} per version.`;
    saveError.value = message;
    toast.error(message);
    return;
  }

  const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  const guessed = EXTENSION_FORMATS[extension];
  if (guessed) sourceFormat.value = guessed;

  try {
    contentString.value = await file.text();
    saveError.value = null;
    // Named from the file, but only when the author has not named it — an
    // upload should not rename a set someone deliberately titled.
    if (!setName.value.trim()) {
      setName.value = file.name.replace(/\.[^.]+$/, '');
    }
    await refreshSniff();
    toast.success(`Loaded ${file.name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not read that file';
    saveError.value = message;
    toast.error(message);
  }
}

/**
 * Ask the server what the content looks like, and hold the answer aside.
 *
 * Advisory by design: it *offers* a correction rather than applying one,
 * because the choice between plain and SPARQL-results TSV is the author's to
 * make — a header of `?x` columns is strong evidence and not proof, and
 * silently switching would be the invisible re-typing the explicit choice
 * exists to prevent.
 */
async function refreshSniff() {
  const text = contentString.value;
  if (!text.trim()) {
    sniffedFormat.value = null;
    return;
  }
  try {
    sniffedFormat.value = await apiClient.detectTupleFormat(text);
  } catch {
    // A sniff that fails costs a nudge, not an import. Nothing to report.
    sniffedFormat.value = null;
  }
}

function acceptSniff() {
  if (!sniffedFormat.value) return;
  sourceFormat.value = sniffedFormat.value;
  sniffedFormat.value = null;
}

function onFormatChosen(event: Event) {
  sourceFormat.value = (event.target as HTMLSelectElement).value as TupleSourceFormat;
  // The author has now stated the format, so a standing nudge is answered
  // whether or not they took it.
  sniffedFormat.value = null;
}

function formatBytes(bytes: number | null | undefined) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

/* --------------------------------------------------------------- lifecycle */

function showVersion(version: TupleSetVersion) {
  // Loading a version into the editor is a starting point for the next one,
  // never an edit of that version. What comes back is the stored SRJ rather
  // than whatever dialect was imported — that is the point of normalising — so
  // the format follows the content it describes.
  contentString.value = version.contentString;
  sourceFormat.value = 'sparql-results-json';
  sniffedFormat.value = null;
  if (mode.value === 'build') adoptBuilderFrom(version.contentString);
  // What the editor is now showing, so the version list highlights this row
  // rather than the draft it was showing a moment ago.
  loadedVersionId.value = version.id;
  loadedVersionContent.value = version.contentString;
  toast.success(`Loaded v${version.version} into the editor`);
}

/*
 * Save. It takes nothing: the bar collects no note and no name, so a new
 * version starts without a comment and gets one — if it deserves one — from
 * its row in the Details tab afterwards.
 */
async function save() {
  if (!canSave.value) return;
  const libraryId = activeLibraryId.value;
  if (!libraryId) {
    toast.error('Choose a library first.');
    return;
  }

  isSaving.value = true;
  saveError.value = null;
  try {
    if (!setId.value) {
      const created = await store.createTupleSet({
        name: setName.value.trim(),
        description: description.value.trim() || null,
        isPartOf: [libraryId],
      } as never);
      setId.value = created.id;
      emit('scratch-saved', { id: created.id, name: created.name, libraryId });
    } else {
      await store.updateTupleSet(setId.value, {
        name: setName.value.trim(),
        description: description.value.trim() || null,
      } as never);
    }

    const version = await store.createVersion(setId.value!, {
      contentString: contentString.value,
      sourceFormat: sourceFormat.value,
      // What the save bar asked for on a saved set. Optional, and what
      // the Details version list reads when it is there.
      // Accepted column-type suggestions (issue #208). Empty outside import
      // mode — the builder bakes an accepted type into the rows themselves
      // and clears this map the moment it does.
      ...(Object.keys(acceptedColumnTypes).length > 0
        ? { columnTypes: { ...acceptedColumnTypes } }
        : {}),
    });
    currentVersionId.value = version.id;
    loadedVersionId.value = version.id;
    loadedVersionContent.value = contentString.value;
    versions.value = await store.loadVersions(setId.value!);
    savedContent.value = contentString.value;
    savedFormat.value = sourceFormat.value;
    if (draftSaveHandle) {
      clearTimeout(draftSaveHandle);
      draftSaveHandle = null;
    }
    removeDraft();
    toast.success(
      `Saved v${version.version} — ${version.rowCount ?? 0} rows, ${(version.tupleColumns ?? []).length} columns`,
    );
  } catch (error) {
    // The server rejects a cell it cannot read as a term, a blank node, a
    // ragged row and anything over the size caps, and its message says which
    // line. Shown beside the editor rather than only as a toast: a parse error
    // is something you fix in the text right there.
    const message = error instanceof Error ? error.message : 'Failed to save tuple set';
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
    await store.deleteTupleSet(setId.value);
    // A draft of a set that no longer exists is a sidebar row that opens
    // nothing, so it goes with the set.
    removeDraft();
    emit('tuple-set-deleted');
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Failed to delete tuple set');
  } finally {
    isDeleting.value = false;
  }
}

async function load(id: string) {
  hydratingRecord.value = true;
  try {
    const tupleSet = await store.getTupleSet(id);
    setName.value = tupleSet.name;
    description.value = tupleSet.description ?? '';
    currentVersionId.value = tupleSet.currentVersion ?? null;
    setCreatedAt.value = (tupleSet as { dateCreated?: string | null }).dateCreated ?? null;
    setLibraryId.value = (tupleSet as { isPartOf?: string[] }).isPartOf?.[0] ?? null;

    versions.value = await store.loadVersions(id);
    const current = versions.value.find((version) => version.id === tupleSet.currentVersion)
      ?? versions.value.at(-1);
    savedContent.value = current?.contentString ?? '';
    // Stored content is SRJ whatever it was imported from, so that is what the
    // editor is holding when it shows a saved body.
    savedFormat.value = current ? 'sparql-results-json' : 'csv';
    // The editor is loaded from the current version, draft or not: a draft is
    // measured against it, and the version list highlights it.
    loadedVersionId.value = current?.id ?? null;
    loadedVersionContent.value = savedContent.value;

    /*
     * A draft wins over the saved text, because it is the newer of the two
     * — the whole point of keeping it is that a reload does not lose it. The
     * saved body stays in `savedContent` so Discard has somewhere to
     * go back to.
     */
    const draft = draftBody.value;
    contentString.value = typeof draft?.contentString === 'string'
      ? draft.contentString
      : savedContent.value;
    sourceFormat.value = draft?.sourceFormat ?? savedFormat.value;
    if (typeof draft?.description === 'string') description.value = draft.description;
    sniffedFormat.value = null;
    /*
     * Build by default. Stored content is always SRJ, so the grid can always
     * show it, and rows you can edit in place beat a wall of JSON — the import
     * editor is for getting data *in*, not for living in.
     */
    mode.value = draft?.mode ?? 'build';
    if (mode.value === 'build') adoptBuilderFrom(contentString.value);
  } finally {
    // Cleared after the refs settle, so hydration never lands as an edit.
    await Promise.resolve();
    hydratingRecord.value = false;
  }
}

onMounted(() => {
  void loadServerLimits();
  if (props.tupleSetId) void load(props.tupleSetId);
});

watch(
  () => props.tupleSetId,
  (next) => {
    // A pending autosave belongs to the set that was open, not the one being
    // opened; letting it fire would write the old body under the new id.
    if (draftSaveHandle) {
      clearTimeout(draftSaveHandle);
      draftSaveHandle = null;
    }
    setId.value = next ?? null;
    setLibraryId.value = null;
    setCreatedAt.value = null;
    loadedVersionId.value = null;
    loadedVersionContent.value = '';
    savedContent.value = '';
    savedFormat.value = 'csv';
    saveError.value = null;
    sniffedFormat.value = null;
    importError.value = null;
    previewDoc.value = null;
    previewedFor = '';
    builderColumns.value = [];
    builderRows.value = [];
    if (next) void load(next);
  },
);

onBeforeUnmount(() => {
  if (previewHandle) {
    clearTimeout(previewHandle);
    previewHandle = null;
  }
  if (!draftSaveHandle) return;
  clearTimeout(draftSaveHandle);
  draftSaveHandle = null;
  // Closing the tab mid-debounce should not lose the edit that was queued.
  if (!isScratch.value && setId.value && !matchesSaved()) persistDraft();
});
</script>

<style scoped>
.tuple-set-work-area {
  position: relative;
  display: flex;
  height: 100%;
  background: var(--surface-raised);
}

.left-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  background: var(--surface);
  overflow: hidden;
  transition: width 0.3s ease;
  will-change: width;
}

/* Disable the transition while actively resizing, for immediate feedback. */
.left-panel.resizing {
  transition: none;
}

.right-panel {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 48px;
  background: var(--surface);
  overflow: hidden;
  transition: flex 0.3s ease, min-width 0.3s ease;
}

.right-panel.collapsed {
  flex: 0 0 48px;
  max-width: 48px;
}

.vertical-resizer {
  position: relative;
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 8px;
  background: var(--surface-raised);
  cursor: col-resize;
  transition: opacity 0.3s ease, width 0.3s ease;
}

.vertical-resizer.hidden {
  width: 0;
  opacity: 0;
  pointer-events: none;
}

.vertical-resizer:hover {
  background: var(--action);
}

.vertical-resizer .resizer-handle {
  width: 2px;
  height: 40px;
  border-radius: var(--radius-sm);
  background: var(--gray-600);
  pointer-events: none;
}

.vertical-resizer:hover .resizer-handle {
  background: var(--surface);
}

.body {
  display: flex;
  flex-direction: column;
  flex: 1;
  padding: var(--space-5);
  overflow-y: auto;
}

.group {
  max-width: 70ch;
  min-width: 0;
  margin-bottom: var(--space-6);
}

.group-grow {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: var(--grid-6);
}

/* Where the hint sits under its section label is the section's fact. */
.group-hint {
  margin: var(--space-2) 0 var(--space-4);
}

.control {
  width: 100%;
  height: var(--control-h-sm);
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink);
  font-family: inherit;
  font-size: var(--text-label);
}

.control-inline {
  width: auto;
  min-width: var(--grid-4);
}

.content-editor {
  flex: 1;
  min-height: var(--grid-6);
  box-sizing: border-box;
  padding: var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink);
  font-family: var(--font-mono);
  font-size: var(--text-label);
  line-height: 1.6;
  resize: vertical;
  white-space: pre;
  overflow-wrap: normal;
  overflow-x: auto;
}

.file-input {
  display: none;
}

.upload-button {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  height: var(--control-h-sm);
  padding: 0 var(--space-5);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface-subtle);
  color: var(--ink);
  font-family: inherit;
  font-size: var(--text-label);
  cursor: pointer;
}

.content-meta {
  color: var(--ink-muted);
  font-size: var(--text-label);
}

.mode-toggle {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-4);
}

.mode-button {
  padding: var(--space-2) var(--space-5);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink-muted);
  font-family: inherit;
  font-size: var(--text-label);
  cursor: pointer;
}

.mode-button--selected {
  background: var(--surface-subtle);
  color: var(--ink);
  border-color: var(--action-border, var(--border-strong));
}

.mode-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.format-hint {
  margin: var(--space-3) 0 var(--space-2);
}

/* Margin stays with the parent: where the note sits is this screen's fact. */
.labels-note {
  margin: var(--space-3) 0 var(--space-2);
}

.format-nudge {
  margin: 0 0 var(--space-3);
  color: var(--ink);
  font-size: var(--text-label);
}

.link-button {
  border: none;
  background: none;
  padding: 0;
  color: var(--accent-ink, var(--ink));
  font-family: inherit;
  font-size: var(--text-label);
  text-decoration: underline;
  cursor: pointer;
}

.save-error {
  margin: var(--space-3) 0 0;
  color: var(--danger-ink);
  font-size: var(--text-label);
}

.type-suggestions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  margin: 0 0 var(--space-3);
  font-size: var(--text-label);
}

.type-suggestions-label {
  color: var(--ink-muted);
}

.type-suggestion {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--ink);
  cursor: pointer;
}

.table-scroll {
  overflow-x: auto;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
}

.rows-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-label);
}

.rows-table th,
.rows-table td {
  padding: var(--space-2) var(--space-4);
  text-align: left;
  border-bottom: 1px solid var(--border-default);
  white-space: nowrap;
}

.rows-table th {
  color: var(--ink-muted);
  font-family: var(--font-mono);
  font-weight: 500;
}

.rows-table tbody tr:last-child td {
  border-bottom: none;
}

.cell-value {
  font-family: var(--font-mono);
}

.cell-undef {
  color: var(--ink-muted);
}

.cell-annotation {
  margin-left: var(--space-2);
  color: var(--ink-muted);
  font-size: calc(var(--text-label) * 0.9);
}

.preview-more {
  margin: var(--space-3) 0 0;
  color: var(--ink-muted);
  font-size: var(--text-label);
}

</style>
