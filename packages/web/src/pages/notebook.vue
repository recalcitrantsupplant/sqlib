<template>
  <div class="notebook-layout">
    <AppNavRail active-section="notebooks" @select="handleRailSelect" />

    <!--
      A notebook is an asset like every other one the rail lists, so it is
      opened from the same list component the other sections use. Scratch-only,
      as ETL's is: a notebook has no server entity yet, and a `Saved 0` header
      that can never move off zero reads as something being broken.
    -->
    <EntityListSidebar
      section="notebooks"
      section-label="Notebooks"
      item-noun="notebook"
      item-noun-plural="notebooks"
      :saved="[]"
      :scratch="scratchRecords"
      :selection="sidebarSelection"
      :supports-saved="false"
      :supports-scratch="true"
      @select-scratch="openDocument"
      @create-scratch="createDocument"
      @discard-scratch="documents.remove"
    />

    <!--
      Kept beside the document even when it is empty, the way the mockup has
      it: the two lists are what the screen promises — what this notebook says,
      and what it has produced — and a rail that appears once you have enough
      cells is a rail you learn about by accident.
    -->
    <main class="page">
      <header class="page-header">
        <label class="visually-hidden" for="notebook-title">Notebook title</label>
        <input
          id="notebook-title"
          class="title"
          type="text"
          :value="nb.notebook.value.title"
          data-testid="notebook-title"
          @change="setTitle(($event.target as HTMLInputElement).value)"
        />
        <span v-if="activeLibrary" class="chip">{{ activeLibrary.name }}</span>
        <span class="chip chip--quiet">floating · tracks current versions</span>

        <span class="page-header__spacer"></span>

        <Button size="sm" :disabled="!hasRunCells || running" data-testid="notebook-run-all" @click="runAll">
          <Play :size="12" />
          {{ running ? 'Running…' : 'Run all' }}
        </Button>
        <!--
          Three exports behind one control. The notebook's own file is the
          first; the other two are the library's, and they live here because
          this screen is the library's front page now that the screen which
          held them is gone.
        -->
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button size="sm" variant="outline" data-testid="notebook-export">
              <Download :size="12" /> Export
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem data-testid="notebook-export-file" @select="exportDocument">
              This notebook (.sqlibnb)
            </DropdownMenuItem>
            <DropdownMenuItem data-testid="notebook-export-html" :disabled="exporting" @select="exportLibraryHtml">
              {{ exporting ? 'Exporting…' : 'The library, as a runnable page' }}
            </DropdownMenuItem>
            <DropdownMenuItem data-testid="notebook-copy-bundle" @select="copyBundle">
              {{ bundleCopied ? 'Copied' : 'Copy the library’s bundle JSON' }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button size="sm" variant="outline" data-testid="notebook-import" @click="fileInput?.click()">
          <Upload :size="12" /> Import
        </Button>
        <input
          ref="fileInput"
          class="visually-hidden"
          type="file"
          accept=".sqlibnb,application/json"
          aria-label="Open a notebook file"
          @change="importDocument"
        />
      </header>

      <div class="page-strip">
        <span v-if="backendLabel">Runs go to <strong>{{ backendLabel }}</strong> — library default</span>
        <span>{{ nb.notebook.value.cells.length }} cells</span>
        <span v-if="documents.savedAt.value" data-testid="notebook-saved-note">saved locally</span>
        <span v-if="nb.loading.value">loading the library…</span>
      </div>

      <p v-if="notice" class="notice notice--error" data-testid="notebook-notice">{{ notice }}</p>

      <div ref="pageRow" class="page-row" :class="{ resizing: isResizingInspector }">
        <div class="page-body" :style="{ width: inspectorCollapsed ? 'calc(100% - 48px)' : `${documentWidth}%` }">
          <div class="measure">
            <template v-if="nb.notebook.value.cells.length > 0">
              <div
                v-for="(cell, index) in nb.notebook.value.cells"
                :id="`cell-${cell.id}`"
                :key="cell.id"
                class="slot"
              >
                <NotebookMarkdownCell
                  v-if="cell.kind === 'markdown'"
                  :cell="cell"
                  :index="index + 1"
                  @update="nb.updateCell(cell.id, { source: $event })"
                  @remove="nb.removeCell(cell.id)"
                  @move="nb.moveCell(cell.id, $event)"
                />
                <NotebookRunCell
                  v-else
                  :cell="cell"
                  :index="index + 1"
                  :target="nb.targetFor(cell)"
                  :state="nb.stateFor(cell.id)"
                  :value="nb.values.value[cell.out] ?? null"
                  :value-options="valueOptionsAbove(index)"
                  :can-write="canWrite"
                  :backend-options="backendOptions"
                  :default-backend="defaultBackendId"
                  :backends-loading="backendsStore.loading.value"
                  @run="nb.run(cell.id)"
                  @remove="nb.removeCell(cell.id)"
                  @move="nb.moveCell(cell.id, $event)"
                  @rename="rename(cell.id, $event)"
                  @update="nb.updateCell(cell.id, $event)"
                  @save="openSave(cell.out)"
                  @save-as-test="openSaveAsTest(cell)"
                />
              </div>
            </template>

            <EmptyState
              v-else
              title="An empty notebook"
              description="Write prose, import a query, a group or a rule set, and run it. Each run binds its result to a name the cells below can use."
            />

            <!--
              One button per cell kind, each opening the picker on its own tab.
              They are the app's own <Button>, not a local class: a row of
              hand-rolled buttons beside the header's real ones is exactly the
              mismatch the design tokens exist to stop.
            -->
            <div class="add-row">
              <SectionLabel as="span">Add</SectionLabel>
              <Button size="sm" variant="outline" data-testid="notebook-add-markdown" @click="addMarkdown">
                <FileText :size="12" /> Markdown
              </Button>
              <Button size="sm" variant="outline" data-testid="notebook-add-cell" @click="openPicker('query')">
                <Search :size="12" /> Query
              </Button>
              <Button size="sm" variant="outline" data-testid="notebook-add-group" @click="openPicker('group')">
                <Workflow :size="12" /> Query group
              </Button>
              <Button size="sm" variant="outline" data-testid="notebook-add-ruleset" @click="openPicker('ruleset')">
                <Scale :size="12" /> Rule set
              </Button>
              <span class="page-header__spacer"></span>
              <Button
                v-if="nb.notebook.value.cells.length === 0 && queryTargets.length > 0"
                size="sm"
                variant="ghost"
                data-testid="notebook-start-from-library"
                @click="startFromLibrary"
              >
                Start from the library — add {{ queryTargets.length }} query cells
              </Button>
            </div>
          </div>
        </div>

        <!--
          The same split every other work area drags on, with the same floors
          and the same remembered width: a screen that resized differently from
          the query screen beside it is the divergence people notice.
        -->
        <div
          class="vertical-resizer"
          :class="{ hidden: inspectorCollapsed }"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the inspector panel"
          title="Drag to resize · double-click to reset"
          @mousedown="startInspectorResize"
          @dblclick="resetInspectorWidth"
        >
          <div class="resizer-handle"></div>
        </div>

        <!--
          The right-hand panel every other work area keeps its properties in.
          What the notebook has produced is inspector material, beside the
          document rather than in the contents rail with what it says.
        -->
        <div class="right-panel" :class="{ collapsed: inspectorCollapsed }">
        <InspectorPanel
          v-model:active-tab="inspectorTab"
          v-model:collapsed="inspectorCollapsed"
          :tabs="inspectorTabs"
          testid="notebook-inspector"
        >
          <template #outline>
            <NotebookRail :entries="outlineEntries" />
          </template>
          <template #values>
            <NotebookValuesPanel :values="boundValues" :stale-names="staleValueNames" />
          </template>
        </InspectorPanel>
        </div>
      </div>
    </main>

    <NotebookInsertMenu
      v-model:open="insertOpen"
      v-model:kind="insertKind"
      :targets="insertTargets"
      @insert="insertTarget"
      @insert-markdown="addMarkdown"
    />

    <SaveAsTestDialog
      v-model:open="testDialogOpen"
      :library-id="libraryId"
      :query-id="testTarget?.queryId ?? null"
      :query-name="testTarget?.name ?? ''"
      :query-type="testTarget?.queryType ?? null"
      :payload="testTarget?.payload ?? null"
      :result="testTarget?.result ?? null"
      :backend-id="defaultBackendId"
    />

    <Dialog v-model:open="saveOpen">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save @{{ saveName }} to the library</DialogTitle>
          <DialogDescription>
            {{ saveDescription }}
          </DialogDescription>
        </DialogHeader>
        <label class="field">
          <SectionLabel as="span">Name</SectionLabel>
          <input v-model="saveEntityName" class="field__input" type="text" data-testid="notebook-save-name" />
        </label>
        <DialogFooter>
          <Button size="sm" variant="outline" @click="saveOpen = false">Cancel</Button>
          <Button size="sm" :disabled="saving || !saveEntityName.trim()" data-testid="notebook-save-confirm" @click="confirmSave">
            {{ saving ? 'Saving…' : 'Save' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
// @ts-ignore - Nuxt auto-import
import { useRoute, useRouter } from '#imports';
import { Download, FileText, Play, Scale, Search, Upload, Workflow } from '@lucide/vue';
import { defineArgsElement } from '@sparql-query-lib/runtime/args-element';
import AppNavRail from '../components/AppNavRail.vue';
import EntityListSidebar, { type SidebarSelection } from '../components/EntityListSidebar.vue';
import SaveAsTestDialog from '../components/notebook/SaveAsTestDialog.vue';
import NotebookRail from '../components/notebook/NotebookRail.vue';
import NotebookValuesPanel from '../components/notebook/NotebookValuesPanel.vue';
import InspectorPanel from '../components/shared/InspectorPanel.vue';
import NotebookMarkdownCell from '../components/notebook/NotebookMarkdownCell.vue';
import NotebookRunCell from '../components/notebook/NotebookRunCell.vue';
import NotebookInsertMenu from '../components/notebook/NotebookInsertMenu.vue';
import EmptyState from '../components/shared/EmptyState.vue';
import SectionLabel from '../components/shared/SectionLabel.vue';
import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { useApiClient } from '../composables/useApiClient';
import { useFeatureFlags } from '../composables/useFeatureFlags';
import { useActiveLibrary } from '../composables/useActiveLibrary';
import { EPHEMERAL_BACKEND_ID } from '@sparql-query-lib/types';
import { useBackendsStore } from '../composables/useBackendsStore';
import { useLibrariesStore } from '../composables/useLibrariesStore';
import { useNotebook, type NotebookTarget } from '../composables/useNotebook';
import { useNotebookDocuments } from '../composables/useNotebookDocuments';
import { usePanelResize } from '../composables/usePanelResize';
import { useCallableDrafts } from '../composables/useCallableDrafts';
import { downloadTextFile } from '../lib/downloadFile';
import { markdownTitle } from '../lib/markdown';
import {
  markdownCell,
  mintCellId,
  parseNotebookJson,
  serializeNotebook,
  isRunCell,
  NOTEBOOK_FILE_EXTENSION,
  type NotebookCell,
  type RunCell,
} from '../lib/notebookFormat';
import { describeValue } from '../lib/notebookValues';
import { isScreenSection, SCREEN_SECTION_PATHS, type RailSection } from '../lib/railSections';

/**
 * The notebook screen: a document you write, not a library you render.
 *
 * Its counterpart is `/library`, which renders every query the library holds.
 * That screen answers "what is in here"; this one answers "here is how you use
 * it" — prose, a handful of cells in the order that makes sense, and each run
 * bound to a name the cells below can read.
 *
 * Everything runs through the REST API, so a cell can be a rule set or a group
 * with any edge type — the things the export bundle cannot carry and does not
 * need to. See `docs/proposals/notebook-cells.md`.
 */

const route = useRoute();
const router = useRouter();
const librariesStore = useLibrariesStore();
const backendsStore = useBackendsStore();

const requestedLibraryId = (route.query.library as string) || null;
const { activeLibraryId: libraryId, activeLibrary, setActiveLibrary } = useActiveLibrary();

const apiClient = useApiClient();
const { isEnabled } = useFeatureFlags();
const defaultBackendId = computed(() => activeLibrary.value?.defaultBackend ?? null);
const nb = useNotebook(libraryId, defaultBackendId);

/**
 * The stores a cell may run against.
 *
 * The ephemeral in-memory store leads, as it does on the query screen: it is
 * the one that needs no configuration, and a notebook demonstrating something
 * often wants exactly that.
 */
const backendOptions = computed(() => {
  const options = new Map<string, string>([[EPHEMERAL_BACKEND_ID, 'Ephemeral Oxigraph (in-memory)']]);
  for (const backend of backendsStore.backends.value) options.set(backend.id, backend.name);
  return [...options].map(([value, label]) => ({ value, label }));
});
const documents = useNotebookDocuments(libraryId);
const draftsStore = useCallableDrafts(libraryId);

const insertOpen = ref(false);
const insertKind = ref<NotebookTarget['kind']>('query');
const saveOpen = ref(false);
const saveName = ref('');
const saveEntityName = ref('');
const saving = ref(false);
const running = ref(false);
const notice = ref<string | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const exporting = ref(false);
const bundleCopied = ref(false);
const testDialogOpen = ref(false);
const testTarget = ref<{
  queryId: string;
  name: string;
  queryType: string | null;
  payload: unknown;
  result: unknown;
} | null>(null);

/*
 * No per-library permission model yet, so "can write" is the flag that decides
 * whether tests exist at all — the reading the screen this replaced used.
 */
const canWrite = computed(() => isEnabled('tests'));

const inspectorTab = ref('outline');

const pageRow = ref<HTMLElement | null>(null);
const {
  panelWidthPercent: documentWidth,
  startResize: startInspectorResize,
  isResizing: isResizingInspector,
  collapsed: inspectorCollapsed,
  resetWidth: resetInspectorWidth,
} = usePanelResize({
  containerRef: pageRow,
  storageKey: 'notebook',
  collapsible: true,
  initialWidthPercent: 68,
});
/*
 * Two tabs rather than two rails. The outline had a column of its own at
 * first, which put four panels either side of the document and left the
 * reading column narrower than the query in it — and "where am I" and "what
 * have I made" are both questions about the document beside you.
 */
const inspectorTabs = computed(() => [
  { id: 'outline', label: 'Outline', count: nb.notebook.value.cells.length },
  { id: 'values', label: 'Values', count: boundValues.value.length },
]);

const backendLabel = computed(
  () => backendsStore.backends.value.find((backend) => backend.id === defaultBackendId.value)?.name ?? null,
);

const insertTargets = computed(() => [...nb.targets.value.values()]);
const queryTargets = computed(() => insertTargets.value.filter((target) => target.kind === 'query'));

const hasRunCells = computed(() => nb.notebook.value.cells.some(isRunCell));

const boundValues = computed(() =>
  nb.notebook.value.cells
    .filter(isRunCell)
    .map((cell) => nb.values.value[cell.out])
    .filter((value): value is NonNullable<typeof value> => Boolean(value)),
);

/** A value is stale when the cell that bound it is. One fact, shown in two places. */
const staleValueNames = computed(() =>
  nb.notebook.value.cells
    .filter(isRunCell)
    .filter((cell) => nb.stateFor(cell.id).stale)
    .map((cell) => cell.out),
);

const outlineEntries = computed(() =>
  nb.notebook.value.cells.map((cell, index) => {
    if (cell.kind === 'markdown') {
      return { id: cell.id, index: index + 1, label: markdownTitle(cell.source), badge: null, prose: true };
    }
    const target = nb.targetFor(cell);
    return {
      id: cell.id,
      index: index + 1,
      label: target?.name ?? cell.label ?? 'Missing',
      badge: target?.kind === 'ruleset' ? 'RUL' : target?.kind === 'group' ? 'GRP' : 'QRY',
      prose: false,
    };
  }),
);

/** What a cell will bind once it runs, from what it points at. */
const VALUE_TYPE_BY_RESULT = {
  BINDINGS: 'rows',
  BOOLEAN: 'boolean',
  GRAPH: 'graph',
  UPDATE: 'graph',
} as const;

/**
 * The values a cell may read: the names bound *above* it.
 *
 * Scope is what keeps the notebook a sequence rather than a graph, and offering
 * a name from below would invite a reference the document itself refuses
 * (`validateNotebook`).
 *
 * Names are listed from the cells rather than from what has run, so a whole
 * chain can be wired before anything is run and then driven with Run all. A
 * name with no value yet says so instead of disappearing — a wiring that
 * vanished when its upstream had not run would read as one the notebook had
 * forgotten.
 */
function valueOptionsAbove(index: number) {
  return nb.notebook.value.cells
    .slice(0, index)
    .filter(isRunCell)
    .map((cell) => {
      const value = nb.values.value[cell.out];
      if (value) return { name: cell.out, type: value.type, summary: describeValue(value) };
      const target = nb.targetFor(cell);
      return {
        name: cell.out,
        type: VALUE_TYPE_BY_RESULT[target?.resultKind ?? 'BINDINGS'],
        summary: 'not run yet',
      };
    });
}

/** The records themselves, for the sidebar, which lists drafts rather than documents. */
const scratchRecords = computed(() => draftsStore.scratchFor('notebook'));

const sidebarSelection = computed<SidebarSelection>(() =>
  documents.openId.value ? { kind: 'scratch', id: documents.openId.value } : { kind: 'none', id: null },
);

function createDocument() {
  const created = documents.create();
  nb.setNotebook(created.notebook);
}

function openDocument(id: string) {
  const opened = documents.open(id);
  if (opened) nb.setNotebook(opened);
}

/*
 * Autosave, the rule the rest of the app follows: there is no Save button, so
 * the debounce is the safety net. Deep, because a cell's arguments change
 * inside the document rather than replacing it.
 */
watch(
  () => nb.notebook.value,
  (notebook) => documents.touch(notebook),
  { deep: true },
);

function openPicker(kind: NotebookTarget['kind']) {
  insertKind.value = kind;
  insertOpen.value = true;
}

function setTitle(title: string) {
  nb.notebook.value = { ...nb.notebook.value, title: title.trim() || 'Untitled notebook' };
}

/** Every insertion writes into a document; one is minted if none is open. */
function ensureDocument() {
  if (!documents.openId.value) documents.create(nb.notebook.value);
}

function addMarkdown() {
  ensureDocument();
  nb.addCell(markdownCell(''));
}

function cellForTarget(target: NotebookTarget): RunCell {
  const common = { id: mintCellId(), out: nb.mintValueName(), label: target.name };
  if (target.kind === 'ruleset') return { ...common, kind: 'ruleset', ruleSet: target.id };
  if (target.kind === 'group') return { ...common, kind: 'group', group: target.id };
  return { ...common, kind: 'query', query: target.id };
}

function insertTarget(target: NotebookTarget) {
  ensureDocument();
  nb.addCell(cellForTarget(target) as NotebookCell);
}

/**
 * The old library page, as a starting draft.
 *
 * One cell per query is what that screen shows unconditionally; here it is an
 * opening move someone cuts down to the five that matter and writes prose
 * around. That is the whole difference between rendered and authored.
 */
function startFromLibrary() {
  for (const target of queryTargets.value) insertTarget(target);
}

function rename(cellId: string, name: string) {
  const problem = nb.renameOutput(cellId, name);
  notice.value = problem;
}

async function runAll() {
  running.value = true;
  try {
    await nb.runAll();
  } finally {
    running.value = false;
  }
}

/**
 * The library as a self-contained page, and its compiled bundle.
 *
 * Both were the old library screen's, and both are facts about the library
 * rather than about this document — which is why they sit under Export beside
 * the notebook's own file rather than being lost with the screen.
 */
async function exportLibraryHtml() {
  const id = libraryId.value;
  if (!id) return;
  exporting.value = true;
  notice.value = null;
  try {
    const html = await apiClient.getLibraryExportHtml(id, { examples: 'all' });
    const name = (activeLibrary.value?.name ?? 'library').replace(/[^a-zA-Z0-9-_]+/g, '-').toLowerCase();
    downloadTextFile(html, `${name}.html`, 'text/html');
  } catch (cause) {
    notice.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    exporting.value = false;
  }
}

async function copyBundle() {
  const id = libraryId.value;
  if (!id) return;
  notice.value = null;
  try {
    const payload = await apiClient.getLibraryExportBundle(id, { examples: 'all' });
    await navigator.clipboard.writeText(JSON.stringify(payload.bundle, null, 2));
    bundleCopied.value = true;
    setTimeout(() => (bundleCopied.value = false), 1500);
  } catch (cause) {
    // Silence here reads as "copied" — the one thing that did not happen.
    notice.value = cause instanceof Error ? `Could not copy the bundle: ${cause.message}` : 'Could not copy the bundle.';
  }
}

/**
 * Hold a query, its arguments and a result, and you are holding a test case.
 *
 * The call it names is the one that *ran* (`lastRun`), not the one the form
 * currently describes: a slot fed from a value was filled with rows the cell no
 * longer shows.
 */
function openSaveAsTest(cell: RunCell) {
  const target = nb.targetFor(cell);
  const ran = nb.lastRun.value[cell.id];
  if (!target || !ran) return;
  testTarget.value = {
    queryId: target.id,
    name: target.name,
    queryType: target.resultKind === 'BINDINGS' ? 'SELECT' : target.resultKind === 'BOOLEAN' ? 'ASK' : 'CONSTRUCT',
    payload: ran.payload,
    result: ran.result,
  };
  testDialogOpen.value = true;
}

function exportDocument() {
  const name = nb.notebook.value.title.replace(/[^a-zA-Z0-9-_]+/g, '-').toLowerCase();
  downloadTextFile(serializeNotebook(nb.notebook.value), `${name}${NOTEBOOK_FILE_EXTENSION}`, 'application/json');
}

async function importDocument(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  notice.value = null;
  try {
    const parsed = parseNotebookJson(await file.text());
    // An imported file becomes a document of its own rather than overwriting
    // whichever one happened to be open.
    documents.create(parsed);
    nb.setNotebook(parsed);
    if (parsed.library && parsed.library !== libraryId.value) {
      // The document travels; the entities it names do not. Switching to the
      // library it came from is the only reading of that file that can run.
      setActiveLibrary(parsed.library);
    }
  } catch (cause) {
    notice.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    input.value = '';
  }
}

const saveDescription = computed(() => {
  const value = nb.values.value[saveName.value];
  if (!value) return '';
  return value.type === 'graph'
    ? `${describeValue(value)} — saved as a data graph version in this library.`
    : `${describeValue(value)} — saved as a tuple set version in this library.`;
});

function openSave(name: string) {
  saveName.value = name;
  saveEntityName.value = name;
  saveOpen.value = true;
}

async function confirmSave() {
  saving.value = true;
  notice.value = null;
  try {
    await nb.saveValue(saveName.value, saveEntityName.value.trim());
    saveOpen.value = false;
  } catch (cause) {
    notice.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    saving.value = false;
  }
}

function handleRailSelect(section: RailSection) {
  if (section === 'notebooks') return;
  if (isScreenSection(section)) {
    router.push({
      path: SCREEN_SECTION_PATHS[section],
      query: libraryId.value ? { library: libraryId.value } : {},
    });
    return;
  }
  router.push({ path: '/', query: { section } });
}

// Shared with the library page and the exported page: one argument builder.
defineArgsElement();

onMounted(async () => {
  await Promise.all([librariesStore.loadLibraries(), backendsStore.loadBackends()]);
  if (requestedLibraryId && requestedLibraryId !== libraryId.value) setActiveLibrary(requestedLibraryId);
  /*
   * After the selection settles, not before: the library watcher clears a
   * notebook written against another library, and restoring ahead of it means
   * restoring into a document that watcher is about to replace.
   */
  await nextTick();
  // Land on the notebook last written rather than on an empty one somebody
  // then has to find their work from.
  const first = documents.documents.value[0];
  if (first) openDocument(first.id);
  await nb.load();
});

watch(libraryId, (id) => {
  if (id) router.replace({ path: '/notebook', query: { library: id } });
  void nb.load();
});
</script>

<style scoped>
.notebook-layout {
  display: flex;
  height: 100vh;
  overflow: hidden;
  background: var(--surface);
}

.page {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.page-header {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-5);
  border-bottom: 1px solid var(--border-default);
}

.page-header__spacer {
  flex-grow: 1;
}

.title {
  width: var(--grid-8);
  height: var(--control-h);
  box-sizing: border-box;
  padding: 0 var(--space-3);
  border: 1px solid transparent;
  border-radius: var(--radius);
  background: transparent;
  color: var(--ink);
  font-size: var(--text-title);
  font-weight: var(--weight-semibold);
}

.title:hover,
.title:focus-visible {
  border-color: var(--border-default);
  background: var(--surface);
}

.chip {
  height: var(--control-h-sm);
  display: inline-flex;
  align-items: center;
  padding: 0 var(--space-3);
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
  font-size: var(--text-micro);
  color: var(--ink-secondary);
}

.chip--quiet {
  background: transparent;
  border: 1px solid var(--border-subtle);
  color: var(--ink-muted);
}

.page-strip {
  display: flex;
  align-items: center;
  gap: var(--space-5);
  height: var(--control-h);
  padding: 0 var(--space-5);
  border-bottom: 1px solid var(--border-subtle);
  background: var(--surface-subtle);
  font-size: var(--text-micro);
  color: var(--ink-muted);
}

.page-row {
  flex: 1;
  min-height: 0;
  display: flex;
}

.page-body {
  min-width: 0;
  overflow-y: auto;
  padding: var(--space-7) var(--space-7) var(--space-8);
  transition: width 0.3s ease;
}

.page-row.resizing .page-body,
.page-row.resizing .right-panel {
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
  background: var(--border-hover);
  pointer-events: none;
}

.vertical-resizer:hover .resizer-handle {
  background: var(--surface);
}

/*
 * Centred, at the measure the screen this replaced settled on: 60rem is the
 * widest a cell wants, and a document pinned to the left of a 1600px monitor
 * reads as a column that lost an argument with the window.
 */
.measure {
  max-width: 60rem;
  margin-inline: auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.slot {
  scroll-margin-top: var(--space-7);
}

.add-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-panel);
}



.notice {
  margin: 0;
  padding: var(--space-3) var(--space-5);
  font-size: var(--text-body);
}

.notice--error {
  background: var(--danger-surface);
  color: var(--danger-ink);
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}


.field__input {
  height: var(--control-h);
  box-sizing: border-box;
  padding: 0 var(--space-3);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink);
  font-size: var(--text-body);
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
