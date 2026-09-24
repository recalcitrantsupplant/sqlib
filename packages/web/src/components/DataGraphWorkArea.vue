<template>
  <div ref="workAreaRef" class="data-graph-work-area">
    <div
      class="left-panel"
      :class="{ resizing: isResizingVertical }"
      :style="{ width: rightPanelCollapsed ? 'calc(100% - 48px)' : leftPanelWidth + '%' }"
    >
      <SaveBar
        :title="graphName"
        noun="data graph"
        :is-scratch="isScratch"
        :current-version-number="currentVersionNumber"
        :edit-count="editCount"
        :saving="isSaving"
        :can-save="canSave"
        :needs-name="!graphName.trim()"
        :show-format="false"
        :show-diff="false"
        :show-edit="false"
        @save="save"
        @needs-name="promptForNameInDetails"
        @discard="discardDraft"
        @delete="removeGraph"
      />

      <!--
        The body is the content and nothing else. What the graph is called, what
        it is for, and what has been saved of it are the Details tab's, the
        same as on a query or a rule set — a record page that edits its identity
        in the middle column and its versions below it is a third layout for the
        two questions every entity here answers the same way.
      -->
      <div class="body">
        <section class="group group-grow">
          <SectionLabel as="h3" size="md">Content</SectionLabel>
          <!--
            What an author has to know before typing, rather than what a data
            graph is: the size it may be, and where what they save ends up. The
            conceptual half of this note moved to the section overview, which is
            what someone opening Graphs with nothing selected now reads.
          -->
          <!--
            A read-only deployment keeps nothing a visitor sends it: an upload
            is read into this browser, Save is hidden, and the API refuses the
            write anyway. Saying "stored on the server" there would be false.
          -->
          <InlineNote v-if="isReadOnly" class="group-hint" data-testid="data-graph-storage-note">
            Up to {{ formatBytes(limits.dataGraphVersionBytes) }}. Kept in this browser only.
            This deployment is read-only, so nothing you upload is saved to the server.
            Runs that use the graph send it with the request and do not keep it.
          </InlineNote>
          <InlineNote v-else class="group-hint" data-testid="data-graph-storage-note">
            Up to {{ formatBytes(limits.dataGraphVersionBytes) }} per version and
            {{ formatBytes(limits.dataGraphLibraryBytes) }} across the library. Saving stores
            the content on the server. A backend that tracks this graph picks up the new
            version the next time it is used; one pinned to a version does not. Tests and
            rule runs can use a graph directly, without a backend.
          </InlineNote>

          <Toolbar variant="plain" wrap>
            <template #start>
              <!--
                Format is with the content, not with the name: it says how the
                text below is to be read, and it changes when an upload changes
                the text.
              -->
              <FormField label="Format">
                <select
                  class="control control-inline"
                  data-testid="data-graph-content-format"
                  :value="contentFormat"
                  @change="(event) => (contentFormat = (event.target as HTMLSelectElement).value as DataGraphFormat)"
                >
                  <option v-for="format in FORMATS" :key="format.value" :value="format.value">
                    {{ format.label }}
                  </option>
                </select>
              </FormField>
              <button class="upload-button" type="button" data-testid="data-graph-upload" @click="pickFile">
                <Upload :size="13" />
                Upload a file…
              </button>
              <input
                ref="fileInputRef"
                class="file-input"
                type="file"
                data-testid="data-graph-file"
                :accept="ACCEPTED_EXTENSIONS"
                @change="onFileChosen"
              />
              <!--
                Shows itself only for a format with a grammar to convert
                against: N-Triples and N-Quads have no prefix mechanism, so
                there is nothing here to offer for them.
              -->
              <PrefixConversionButtons
                :code="contentString"
                :content-type="contentFormat"
                @update:code="(value: string) => (contentString = value)"
              />
            </template>
            <span class="content-meta" data-testid="data-graph-size">{{ sizeSummary }}</span>
            <!--
              Expand belongs on this row, with the format picker and the
              upload: they are all things done *to* the content below, and a
              button sitting over the first line of a Turtle document was
              covering the prefixes.
            -->
            <template #end>
              <ExpandButton
                v-if="!contentExpanded"
                subject="this data graph"
                testid="editable-rdf-expand"
                @click="toggleContentExpand"
              />
            </template>
          </Toolbar>

          <!--
            The same editor the rest of the app writes RDF in, given the format
            the author picked: a data graph is Turtle or N-Triples like everything
            else here, and a plain textarea was the odd one out.
          -->
          <ExpandableEditor :id="CONTENT_REGION_ID" title="Data Graph" testid="data-graph-expand">
            <EditableRdfViewer
              v-model="contentString"
              class="content-editor"
              data-testid="data-graph-content"
              :content-type="contentFormat"
              min-height="var(--grid-6)"
              :prefix-source="prefixSource"
            />
          </ExpandableEditor>

          <p v-if="saveError" class="save-error" data-testid="data-graph-error">{{ saveError }}</p>
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
      data graph has: what it is, and how to put content here from your own
      code. There is nothing to execute, so there is no Results tab.
    -->
    <div class="right-panel" :class="{ collapsed: rightPanelCollapsed }">
      <InspectorPanel
        v-model:active-tab="activeTab"
        v-model:collapsed="rightPanelCollapsed"
        :tabs="inspectorTabs"
        testid="data-graph-inspector"
      >
        <template #details>
          <EntityDetailsPanel
            ref="detailsPanelRef"
            v-bind="detailsProps"
            @update:name="graphName = $event"
            @update:description="description = $event"
            @select-version="selectVersion"
            @set-current-version="setCurrentVersion"
            @annotate-version="annotateVersion"
            @select-draft="selectDraft"
            @copy-id="copyGraphId"
            @delete="removeGraph"
          />
        </template>

        <!--
          A data graph is not executed, so its Code tab answers the other
          question: how do I put content here from my own code? That is the call
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
 * One data graph: what it is called, what is in it, and its versions.
 *
 * This exists because #151 shipped the *input* — a picker inside the rules
 * editor — without anywhere to register the thing being picked. The entity's
 * whole premise is "the same move backends made", and a Backend has a list and
 * a record page, so a DataGraph needs one too. Promoting inline content from
 * the rules editor still works; it is now one way in rather than the only one.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { toast } from 'vue-sonner';
import { Upload } from '@lucide/vue';
import InlineNote from './shared/InlineNote.vue';
import SaveBar from './shared/SaveBar.vue';
import EditableRdfViewer from './EditableRdfViewer.vue';
import { prefixSourceToken } from '@/lib/prefixSources';
import ExpandableEditor from './shared/ExpandableEditor.vue';
import ExpandButton from './shared/ExpandButton.vue';
import FormField from './shared/FormField.vue';
import SectionLabel from './shared/SectionLabel.vue';
import Toolbar from './shared/Toolbar.vue';
import PrefixConversionButtons from './shared/PrefixConversionButtons.vue';
import CodeSnippetPanel from './shared/CodeSnippetPanel.vue';
import InspectorPanel, { type InspectorTab } from './shared/InspectorPanel.vue';
import EntityDetailsPanel from './shared/EntityDetailsPanel.vue';
// @ts-ignore - Nuxt auto-import
import { useRuntimeConfig } from '#imports';
import type { SnippetRequest } from '@/lib/codeSnippets';
import { useDataGraphsStore } from '@/composables/useDataGraphsStore';
import { useEditorExpand } from '@/composables/useEditorExpand';
import { usePanelResize } from '@/composables/usePanelResize';
import { useActiveLibrary } from '@/composables/useActiveLibrary';
import { useScratchRecord } from '@/composables/useScratchRecord';
import { useCallableDrafts, UNASSIGNED_LIBRARY_ID } from '@/composables/useCallableDrafts';
import type { DataGraphVersion } from '@/composables/useApiClient';
import { useServerLimits } from '@/composables/useServerLimits';
import { useDeploymentMode } from '@/composables/useDeploymentMode';
import type { DataGraphFormat } from '@/types/data-graphs';

/*
 * The pop-out is named rather than anonymous because the button that opens it
 * is no longer inside it: it sits on the toolbar above, which is a sibling of
 * the region and has to be able to address it.
 */
const CONTENT_REGION_ID = 'data-graph-content-expand';

const FORMATS: Array<{ value: DataGraphFormat; label: string }> = [
  { value: 'text/turtle', label: 'Turtle' },
  { value: 'application/n-triples', label: 'N-Triples' },
  { value: 'application/n-quads', label: 'N-Quads' },
];

const props = defineProps<{
  dataGraphId?: string | null;
  scratchId?: string | null;
}>();

const emit = defineEmits<{
  (e: 'scratch-saved', payload: { id: string; name: string; libraryId: string }): void;
  (e: 'data-graph-deleted'): void;
}>();

const store = useDataGraphsStore();
const { activeLibraryId } = useActiveLibrary();

const editorExpand = useEditorExpand();
const contentExpanded = computed(() => editorExpand.isExpanded(CONTENT_REGION_ID));
const toggleContentExpand = () => editorExpand.toggle(CONTENT_REGION_ID);
const draftsStore = useCallableDrafts();

const graphId = ref<string | null>(props.dataGraphId ?? null);
const graphName = ref('');
const description = ref('');
const contentString = ref('');
const contentFormat = ref<DataGraphFormat>('text/turtle');
const versions = ref<DataGraphVersion[]>([]);
const currentVersionId = ref<string | null>(null);
const isSaving = ref(false);
const isDeleting = ref(false);
const saveError = ref<string | null>(null);
const graphCreatedAt = ref<string | null>(null);

/**
 * Which version the editor was loaded from, and what it held.
 *
 * The pair is what the Details tab's version list highlights and what tells a
 * draft from an unmodified read: the editor is showing the draft exactly when
 * its text has diverged from the version it was loaded from, which is the same
 * test the query screen makes.
 */
const loadedVersionId = ref<string | null>(null);
const loadedVersionContent = ref('');

interface ScratchBody {
  description?: string;
  contentString?: string;
  contentFormat?: DataGraphFormat;
}

/*
 * A data graph is where a namespace is most likely to be met for the first
 * time, so it is the last place discovery should have been missing.
 */
const prefixSource = computed(() =>
  prefixSourceToken('data-graph', props.scratchId ?? graphId.value ?? null),
);

const { isScratch } = useScratchRecord({
  scratchId: () => props.scratchId ?? null,
  missingMessage: 'That scratch data graph is not in this browser',
  track: [graphName, description, contentString, contentFormat],
  hydrate: (record) => {
    const body = (record.body ?? {}) as ScratchBody;
    graphName.value = record.name;
    description.value = body.description ?? '';
    contentString.value = body.contentString ?? '';
    contentFormat.value = body.contentFormat ?? 'text/turtle';
  },
  collect: (record) => ({
    name: graphName.value || record.name,
    body: {
      description: description.value,
      contentString: contentString.value,
      contentFormat: contentFormat.value,
    },
  }),
});

const currentVersionNumber = computed(
  () => versions.value.find((version) => version.id === currentVersionId.value)?.version ?? null,
);

/* ------------------------------------------------------------- inspector */

/*
 * The same split every other work area drags on, with the same floors and the
 * same remembered width — a record page that resized differently from the
 * query screen beside it is the divergence users notice (`usePanelResize`).
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
  storageKey: 'dataGraph',
  collapsible: true,
  initialWidthPercent: 62,
});

/* Details first: opening a graph, the question is what this is. */
const activeTab = ref('details');

const inspectorTabs = computed<InspectorTab[]>(() => [
  { id: 'details', label: 'Details' },
  { id: 'code', label: 'Code' },
]);

const detailsPanelRef = ref<InstanceType<typeof EntityDetailsPanel> | null>(null);

/** Save on an unnamed graph sends you to the one field that names it. */
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
  name: graphName.value,
  description: description.value,
  isScratch: isScratch.value,
  entityId: isScratch.value ? null : (graphId.value || null),
  entityNoun: 'data graph',
  taggableKind: 'dataGraph' as const,
  // A data graph has no backend of its own — it *is* the store a run is given
  // — and nothing detects a signature in RDF.
  showBackend: false,
  showSignature: false,
  versionOptions: versionOptions.value,
  selectedVersion: loadedVersionId.value,
  currentVersion: currentVersionId.value,
  // A scratch graph has no server entity to point at anything.
  canSetCurrentVersion: !isScratch.value,
  canAnnotateVersions: !isScratch.value && !!graphId.value,
  editCount: editCount.value,
  draftSavedAt: locallySavedAt.value,
  // The editor is showing the draft whenever its text has diverged from the
  // version it was loaded from — which is exactly when the draft row is the
  // one that should look selected.
  draftSelected: editCount.value > 0
    && contentString.value.trim() !== loadedVersionContent.value.trim(),
  createdAt: isScratch.value ? null : graphCreatedAt.value,
  // A scratch graph lives in this browser: Discard in the save bar is what
  // removes it, and there is no server entity for Delete to address.
  canDelete: !isScratch.value && !!graphId.value,
  deleting: isDeleting.value,
}));

/**
 * The version rows, newest first.
 *
 * A version's comment is what its author said about it; where there is none,
 * the row says what the server measured instead — triples, size and the format
 * it was read in — which is what the list under the editor used to show and
 * the only thing worth knowing about a version you did not comment.
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

function versionSummary(version: DataGraphVersion) {
  const triples = version.tripleCount ?? 0;
  return `${triples} ${triples === 1 ? 'triple' : 'triples'} · ${formatBytes(version.byteSize)} · ${version.contentFormat}`;
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
  if (draft.contentFormat) contentFormat.value = draft.contentFormat;
  loadedVersionId.value = currentVersionId.value;
  loadedVersionContent.value = savedContent.value;
}

/**
 * Point the graph at one of its versions.
 *
 * The editor keeps showing whatever it was showing: choosing what a run with
 * no version pinned gets is not a request to read that version.
 */
async function setCurrentVersion(versionId: string) {
  if (!graphId.value) return;
  try {
    await store.updateDataGraph(graphId.value, { currentVersion: versionId } as never);
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
  const id = graphId.value;
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
    console.error('[DataGraphWorkArea] Failed to save the version note', error);
    toast.error('Failed to save the note');
  }
}

async function copyGraphId() {
  if (!graphId.value) return;
  try {
    await navigator.clipboard.writeText(graphId.value);
    toast.success('Data graph ID copied');
  } catch {
    toast.error('Could not copy the ID');
  }
}

/*
 * A saved data graph gets the same browser-local safety net a saved
 * query or rule set does: edits are a draft until they are saved, and a
 * draft survives a reload. Copied in behaviour, not in code — the body is RDF
 * rather than SPARQL, the lifecycle is identical.
 */
const graphLibraryId = ref<string | null>(null);
const locallySavedAt = ref<string | null>(null);
let draftSaveHandle: ReturnType<typeof setTimeout> | null = null;
/** Set while a graph is being read from the server, so a load is not an edit. */
const hydratingRecord = ref(false);

/** The body of the version the editor was last loaded from, to compare against. */
const savedContent = ref('');
const savedFormat = ref<DataGraphFormat>('text/turtle');

interface DataGraphDraftBody {
  description?: string;
  contentString?: string;
  contentFormat?: DataGraphFormat;
}

const openDraft = computed(() => {
  void draftsStore.allDrafts.value;
  return graphId.value ? draftsStore.draftFor(graphId.value) : null;
});

const editCount = computed(() => (isScratch.value ? 0 : openDraft.value?.edits ?? 0));

const draftBody = computed(() => {
  const body = openDraft.value?.body;
  return body && typeof body === 'object' ? (body as DataGraphDraftBody) : null;
});

/** Typing back to what is saved is an undo, not an edit. */
const matchesSaved = () =>
  contentString.value.trim() === savedContent.value.trim()
  && contentFormat.value === savedFormat.value;

function persistDraft() {
  const id = graphId.value;
  if (!id || isScratch.value) return;
  const existing = draftsStore.draftFor(id);
  draftsStore.save({
    id: existing?.id ?? `urn:ui-temp:draft-of-${id}`,
    libraryId: graphLibraryId.value || activeLibraryId.value || UNASSIGNED_LIBRARY_ID,
    type: 'query',
    kind: 'draft',
    section: 'dataGraph',
    name: graphName.value,
    description: description.value || null,
    queryString: null,
    body: {
      description: description.value,
      contentString: contentString.value,
      contentFormat: contentFormat.value,
    } satisfies DataGraphDraftBody,
    resultKind: 'GRAPH',
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
  const id = graphId.value;
  if (!id) return;
  const existing = draftsStore.draftFor(id);
  if (existing) draftsStore.remove(existing.id);
  locallySavedAt.value = null;
}

watch([contentString, contentFormat, description], () => {
  if (isScratch.value || hydratingRecord.value) return;
  if (!graphId.value) return;
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
  contentFormat.value = savedFormat.value;
  void Promise.resolve().then(() => { hydratingRecord.value = false; });
  toast.success('Draft discarded');
}

const canSave = computed(() => {
  if (!graphName.value.trim() || !contentString.value.trim()) return false;
  if (isScratch.value || !graphId.value) return true;
  // Saving an unchanged body would mint a version identical to the last
  // one. Nothing to save is not an error, it is a disabled button.
  return editCount.value > 0;
});

/** What is in the editor now, before the server has counted anything. */
const sizeSummary = computed(() => {
  const bytes = new Blob([contentString.value]).size;
  if (bytes === 0) return 'empty';
  const lines = contentString.value.split('\n').filter((line) => line.trim().length > 0).length;
  return `${formatBytes(bytes)} · ${lines} ${lines === 1 ? 'line' : 'lines'}`;
});

/**
 * Extensions offered in the file picker, and the format each implies.
 *
 * A picker that accepts anything is a picker that lets you choose a .zip and
 * find out from a parse error. The map doubles as the format guess, so
 * uploading `family.ttl` selects Turtle without the author restating it.
 */
const EXTENSION_FORMATS: Record<string, DataGraphFormat> = {
  '.ttl': 'text/turtle',
  '.turtle': 'text/turtle',
  '.nt': 'application/n-triples',
  '.ntriples': 'application/n-triples',
  '.nq': 'application/n-quads',
  '.nquads': 'application/n-quads',
};

const ACCEPTED_EXTENSIONS = Object.keys(EXTENSION_FORMATS).join(',');

/**
 * Refused before reading.
 *
 * The same cap the server enforces, read from it rather than restated here:
 * both are environment variables on the API, and a copy in the SPA meant a
 * deployment that raised the server's still had uploads refused at the old
 * figure. Refusing early is the point — reading a 500 MB file into a string to
 * be told no is a hung tab, not a validation message.
 */
const { limits, ensureLoaded: loadServerLimits } = useServerLimits();
const { isReadOnly } = useDeploymentMode();

const fileInputRef = ref<HTMLInputElement | null>(null);

function pickFile() {
  fileInputRef.value?.click();
}

async function onFileChosen(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  // Cleared immediately so choosing the same file twice fires `change` again —
  // otherwise a re-upload after an edit silently does nothing.
  input.value = '';
  if (!file) return;

  if (file.size > limits.value.dataGraphVersionBytes) {
    const message = `${file.name} is ${formatBytes(file.size)} — the limit is `
      + `${formatBytes(limits.value.dataGraphVersionBytes)} per version.`;
    saveError.value = message;
    toast.error(message);
    return;
  }

  const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  const guessed = EXTENSION_FORMATS[extension];
  if (guessed) contentFormat.value = guessed;

  try {
    contentString.value = await file.text();
    saveError.value = null;
    // Named from the file, but only when the author has not named it — an
    // upload should not rename a graph someone deliberately titled.
    if (!graphName.value.trim()) {
      graphName.value = file.name.replace(/\.[^.]+$/, '');
    }
    toast.success(`Loaded ${file.name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not read that file';
    saveError.value = message;
    toast.error(message);
  }
}

function formatBytes(bytes: number | null | undefined) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function showVersion(version: DataGraphVersion) {
  // Loading a version into the editor is a starting point for the next one,
  // never an edit of that version — versions are immutable, and saving
  // from here cuts a new one.
  contentString.value = version.contentString;
  contentFormat.value = version.contentFormat as DataGraphFormat;
  // What the editor is now showing, so the version list highlights this row
  // rather than the draft it was showing a moment ago.
  loadedVersionId.value = version.id;
  loadedVersionContent.value = version.contentString;
  toast.success(`Loaded v${version.version} into the editor`);
}

/* -------------------------------------------------------------------- code */

/*
 * `POST /data-graphs/{id}/versions` — what Save sends once the graph exists.
 * A graph that does not exist yet is created by `POST /data-graphs` first,
 * which is why a scratch graph gets a message rather than a call that 404s.
 */
const config = useRuntimeConfig();

/** Past this, the RDF goes in as a placeholder: a snippet is to read, not to scroll. */
const INLINE_CONTENT_LIMIT = 2000;

const contentIsInlined = computed(() => contentString.value.length <= INLINE_CONTENT_LIMIT);

const codeRequest = computed<SnippetRequest>(() => {
  const apiBaseUrl = String(config.public.apiBaseUrl).replace(/\/$/, '');
  const id = graphId.value || '<data-graph-id>';
  return {
    method: 'POST',
    url: `${apiBaseUrl}/data-graphs/${encodeURIComponent(id)}/versions`,
    body: {
      contentString: contentIsInlined.value ? contentString.value : '<the RDF, as text>',
      contentFormat: contentFormat.value,
    },
  };
});

const codeUnavailable = computed(() =>
  graphId.value
    ? null
    : 'This data graph has not been saved yet — save it once to get an id, then versions go to the call below.',
);

const codeContentHint = computed(() =>
  contentIsInlined.value
    ? 'The content is the one in the editor above, in the format selected there.'
    : `The content is stood in for: ${contentString.value.length} characters is too many to read in a snippet. Send the editor's contents in their place.`,
);

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
    if (!graphId.value) {
      const created = await store.createDataGraph({
        name: graphName.value.trim(),
        description: description.value.trim() || null,
        isPartOf: [libraryId],
      } as never);
      graphId.value = created.id;
      emit('scratch-saved', { id: created.id, name: created.name, libraryId });
    } else {
      await store.updateDataGraph(graphId.value, {
        name: graphName.value.trim(),
        description: description.value.trim() || null,
      } as never);
    }

    const version = await store.createVersion(graphId.value!, {
      contentString: contentString.value,
      contentFormat: contentFormat.value,
      // What the save bar asked for on a saved graph. Optional, and
      // what the Details version list reads when it is there.
    });
    currentVersionId.value = version.id;
    loadedVersionId.value = version.id;
    loadedVersionContent.value = contentString.value;
    versions.value = await store.loadVersions(graphId.value!);
    // The editor's body is now a saved version, so there are no
    // unsaved edits left to keep: the draft and its pill go together.
    savedContent.value = contentString.value;
    savedFormat.value = contentFormat.value;
    if (draftSaveHandle) {
      clearTimeout(draftSaveHandle);
      draftSaveHandle = null;
    }
    removeDraft();
    toast.success(`Saved v${version.version} — ${version.tripleCount ?? 0} triples`);
  } catch (error) {
    // The server rejects unparseable RDF and anything over the size caps, and
    // its message says which. Shown in the editor rather than only as a toast:
    // a parse error is something you fix in the text right there.
    const message = error instanceof Error ? error.message : 'Failed to save data graph';
    saveError.value = message;
    toast.error(message);
  } finally {
    isSaving.value = false;
  }
}

async function removeGraph() {
  if (!graphId.value) return;
  isDeleting.value = true;
  try {
    await store.deleteDataGraph(graphId.value);
    // A draft of a graph that no longer exists is a sidebar row that opens
    // nothing, so it goes with the graph.
    removeDraft();
    emit('data-graph-deleted');
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Failed to delete data graph');
  } finally {
    isDeleting.value = false;
  }
}

async function load(id: string) {
  hydratingRecord.value = true;
  try {
    const graph = await store.getDataGraph(id);
    graphName.value = graph.name;
    description.value = graph.description ?? '';
    currentVersionId.value = graph.currentVersion ?? null;
    graphCreatedAt.value = (graph as { dateCreated?: string | null }).dateCreated ?? null;
    graphLibraryId.value = (graph as { isPartOf?: string[] }).isPartOf?.[0] ?? null;

    versions.value = await store.loadVersions(id);
    const current = versions.value.find((version) => version.id === graph.currentVersion)
      ?? versions.value.at(-1);
    savedContent.value = current?.contentString ?? '';
    savedFormat.value = (current?.contentFormat as DataGraphFormat) ?? 'text/turtle';
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
    contentFormat.value = draft?.contentFormat ?? savedFormat.value;
    if (typeof draft?.description === 'string') description.value = draft.description;
  } finally {
    // Cleared after the refs settle, so hydration never lands as an edit.
    await Promise.resolve();
    hydratingRecord.value = false;
  }
}

onMounted(() => {
  void loadServerLimits();
  if (props.dataGraphId) void load(props.dataGraphId);
});

watch(
  () => props.dataGraphId,
  (next) => {
    // A pending autosave belongs to the graph that was open, not the one being
    // opened; letting it fire would write the old body under the new id.
    if (draftSaveHandle) {
      clearTimeout(draftSaveHandle);
      draftSaveHandle = null;
    }
    graphId.value = next ?? null;
    graphLibraryId.value = null;
    graphCreatedAt.value = null;
    loadedVersionId.value = null;
    loadedVersionContent.value = '';
    savedContent.value = '';
    savedFormat.value = 'text/turtle';
    saveError.value = null;
    if (next) void load(next);
  },
);

onBeforeUnmount(() => {
  if (!draftSaveHandle) return;
  clearTimeout(draftSaveHandle);
  draftSaveHandle = null;
  // Closing the tab mid-debounce should not lose the edit that was queued.
  if (!isScratch.value && graphId.value && !matchesSaved()) persistDraft();
});
</script>

<style scoped>
.data-graph-work-area {
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

/*
 * `--control-h`, the default control height, because these sit in a toolbar
 * row beside Expand and the prefix conversions rather than inline in a form.
 * They were a step smaller, which put three heights in one row.
 */
.control {
  width: 100%;
  height: var(--control-h);
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink);
  font-family: inherit;
  font-size: var(--text-label);
}

/* In a toolbar the format select sizes to its options rather than the row. */
.control-inline {
  width: auto;
}

.content-editor {
  flex: 1;
  min-height: var(--grid-6);
}

.file-input {
  display: none;
}

.upload-button {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  height: var(--control-h);
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

.save-error {
  margin: var(--space-3) 0 0;
  color: var(--danger-ink);
  font-size: var(--text-label);
}
</style>
