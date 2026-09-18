<template>
  <div class="notebook-layout">
    <AppNavRail active-section="notebooks" @select="handleRailSelect" />

    <NotebookRail :entries="outlineEntries" :values="boundValues" :stale-names="staleValueNames" />

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
        <Button size="sm" variant="outline" data-testid="notebook-export" @click="exportDocument">
          <Download :size="12" /> Export
        </Button>
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
        <span v-if="nb.loading.value">loading the library…</span>
      </div>

      <p v-if="notice" class="notice notice--error" data-testid="notebook-notice">{{ notice }}</p>

      <div class="page-body">
        <div class="measure">
          <template v-if="nb.notebook.value.cells.length > 0">
            <div v-for="(cell, index) in nb.notebook.value.cells" :id="`cell-${cell.id}`" :key="cell.id" class="slot">
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
                @run="nb.run(cell.id)"
                @remove="nb.removeCell(cell.id)"
                @move="nb.moveCell(cell.id, $event)"
                @rename="rename(cell.id, $event)"
                @update="nb.updateCell(cell.id, $event)"
                @save="openSave(cell.out)"
              />
            </div>
          </template>

          <EmptyState
            v-else
            title="An empty notebook"
            description="Write prose, import a query, a group or a rule set, and run it. Each run binds its result to a name the cells below can use."
          />

          <div class="add-row">
            <span class="add-row__label">Add</span>
            <button type="button" class="add" data-testid="notebook-add-markdown" @click="addMarkdown">
              Markdown
            </button>
            <button type="button" class="add" data-testid="notebook-add-cell" @click="insertOpen = true">
              Query, group or rule set…
            </button>
            <span class="page-header__spacer"></span>
            <button
              v-if="nb.notebook.value.cells.length === 0 && queryTargets.length > 0"
              type="button"
              class="add"
              data-testid="notebook-start-from-library"
              @click="startFromLibrary"
            >
              Start from the library — add {{ queryTargets.length }} query cells
            </button>
          </div>
        </div>
      </div>
    </main>

    <NotebookInsertMenu
      v-model:open="insertOpen"
      :targets="insertTargets"
      @insert="insertTarget"
      @insert-markdown="addMarkdown"
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
          <button type="button" class="add" @click="saveOpen = false">Cancel</button>
          <Button size="sm" :disabled="saving || !saveEntityName.trim()" data-testid="notebook-save-confirm" @click="confirmSave">
            {{ saving ? 'Saving…' : 'Save' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
// @ts-ignore - Nuxt auto-import
import { useRoute, useRouter } from '#imports';
import { Download, Play, Upload } from '@lucide/vue';
import { defineArgsElement } from '@sparql-query-lib/runtime/args-element';
import AppNavRail from '../components/AppNavRail.vue';
import NotebookRail from '../components/notebook/NotebookRail.vue';
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
import { useActiveLibrary } from '../composables/useActiveLibrary';
import { useBackendsStore } from '../composables/useBackendsStore';
import { useLibrariesStore } from '../composables/useLibrariesStore';
import { useNotebook, type NotebookTarget } from '../composables/useNotebook';
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

const nb = useNotebook(libraryId);

const insertOpen = ref(false);
const saveOpen = ref(false);
const saveName = ref('');
const saveEntityName = ref('');
const saving = ref(false);
const running = ref(false);
const notice = ref<string | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);

const backendLabel = computed(
  () =>
    backendsStore.backends.value.find((backend) => backend.id === activeLibrary.value?.defaultBackend)?.name ??
    null,
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

function setTitle(title: string) {
  nb.notebook.value = { ...nb.notebook.value, title: title.trim() || 'Untitled notebook' };
}

function addMarkdown() {
  nb.addCell(markdownCell(''));
}

function cellForTarget(target: NotebookTarget): RunCell {
  const common = { id: mintCellId(), out: nb.mintValueName(), label: target.name };
  if (target.kind === 'ruleset') return { ...common, kind: 'ruleset', ruleSet: target.id };
  if (target.kind === 'group') return { ...common, kind: 'group', group: target.id };
  return { ...common, kind: 'query', query: target.id };
}

function insertTarget(target: NotebookTarget) {
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

.page-body {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-7) var(--space-5);
}

.measure {
  max-width: 880px;
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

.add-row__label {
  font-size: var(--text-micro);
  color: var(--ink-muted);
}

.add {
  height: var(--control-h-sm);
  padding: 0 var(--space-3);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink);
  font-size: var(--text-body);
  cursor: pointer;
}

.add:hover {
  background: var(--surface-subtle);
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
