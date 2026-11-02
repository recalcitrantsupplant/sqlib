<template>
  <div class="library-layout">
    <AppNavRail :active-section="null" @select="handleRailSelect" @home="router.push('/')" />

    <main class="pane" data-testid="library-page">
      <header class="bar">
        <span class="crumb">Libraries /</span>
        <h1 class="title" data-testid="library-page-title">{{ library?.name ?? 'Library' }}</h1>
        <span class="spacer" />
        <button v-if="library" type="button" class="btn-compact" data-testid="library-page-export" @click="exportOpen = true">Export…</button>
      </header>

      <TabStrip v-model="tab" :tabs="tabs" group-label="Library" variant="pane" />

      <div v-if="!libraryId" class="body"><p class="muted">No library.</p></div>

      <div v-else-if="tab === 'environments'" class="env-tab">
        <p v-if="envs.loadError.value || chainError" class="error env-error" data-testid="chain-error">{{ envs.loadError.value ?? chainError }}</p>
        <div v-if="envs.environments.value.length === 0" class="body">
          <EnvironmentSetup v-if="!envs.loading.value" :can-control="canControl" :busy="busy" @setup="setUp" />
        </div>
        <div v-else class="env-split">
          <EnvironmentList
            :environments="envs.environments.value"
            :rows="envs.rows.value"
            :selected="selectedEnv"
            :can-control="canControl"
            @select="selectEnv"
            @add="openAdd"
          />
          <div v-if="selectedEnv === COMPARE_ALL" class="compare">
            <InlineNote v-if="notice" :tone="notice.tone === 'danger' ? 'danger' : 'muted'" data-testid="board-notice">{{ notice.text }}</InlineNote>
            <PointerBoard
              :environments="envs.environments.value"
              :rows="envs.rows.value"
              :can-promote="canPromote"
              :versions-of="envs.versionsOf"
              @move="movePointer"
            />
          </div>
          <EnvironmentDetail
            v-else-if="selectedEnvironment"
            :environment="selectedEnvironment"
            :column="selectedIndex + 1"
            :previous-name="selectedIndex === 0 ? 'latest' : envs.environments.value[selectedIndex - 1].name"
            :rows="envs.rows.value"
            :backends="backends"
            :holders="grants.holders.value[selectedEnvironment.id] ?? null"
            :can-control="canControl"
            :may-promote="canPromote(selectedEnvironment.id)"
            :is-first="selectedIndex === 0"
            :is-last="selectedIndex === envs.environments.value.length - 1"
            :busy="busy"
            :notice="notice"
            :versions-of="envs.versionsOf"
            @edit="openEdit(selectedEnvironment)"
            @reorder="(by) => moveEnvironment(selectedEnvironment!, by)"
            @delete="askDelete(selectedEnvironment)"
            @move="movePointer"
            @move-all="moveAll"
            @dismiss="notice = null"
          />
        </div>
      </div>

      <div v-else class="body">
        <section v-if="tab === 'overview'" class="overview" data-testid="library-overview">
          <p v-if="library?.description" class="description">{{ library.description }}</p>
          <dl class="facts">
            <dt>Queries</dt><dd>{{ countOf('Query') }}</dd>
            <dt>Groups</dt><dd>{{ countOf('QueryGroup') }}</dd>
            <dt>Rule sets</dt><dd>{{ countOf('RuleSet') }}</dd>
            <dt>Environments</dt>
            <dd>
              <button type="button" class="link" @click="tab = 'environments'">
                {{ envs.environments.value.length ? envs.environments.value.map((env) => env.name).join(' → ') : 'None' }}
              </button>
            </dd>
          </dl>
        </section>

        <LibraryAccessTab
          v-else-if="tab === 'access'"
          :library-id="libraryId"
          :environments="envs.environments.value"
          :grants="grants"
        />
      </div>
    </main>

    <EnvironmentDialog
      v-model:open="dialogOpen"
      :environments="envs.environments.value"
      :backends="backends"
      :editing="editing"
      :busy="busy"
      :error="dialogError"
      @submit="submitDialog"
    />

    <AlertDialog v-model:open="deleteOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {{ deleting?.name }}?</AlertDialogTitle>
        </AlertDialogHeader>
        <ul class="effects">
          <li>{{ deletingHolds }} promoted {{ deletingHolds === 1 ? 'version' : 'versions' }}</li>
          <li>Runs that name {{ deleting?.name }} fail</li>
          <li>Its Run and Promote access goes</li>
        </ul>
        <label class="confirm">
          <span>Type {{ deleting?.name }} to delete</span>
          <input v-model="deleteTyped" class="confirm-input" data-testid="environment-delete-confirm" autocomplete="off" />
        </label>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            class="delete-action"
            :disabled="deleteTyped !== deleting?.name"
            data-testid="environment-delete-submit"
            @click="confirmDelete"
          >
            Delete {{ deleting?.name }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <LibraryExportDialog
      v-if="library"
      v-model:open="exportOpen"
      :library-id="library.id"
      :library-name="library.name"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * The Library page: one library's own settings, at `/library`.
 *
 * A screen like `/mcp-server`, not a rail section. The switcher, the
 * homepage's library rows and the environment badge open it. Environments
 * belong to one library, so they are managed here rather than beside
 * Backends, which are account level. See CLAUDE.md for the on-screen text
 * rules this page follows.
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from '#imports';
import type { Backend, Environment } from '@sparql-query-lib/contracts';
import AppNavRail from '@/components/AppNavRail.vue';
import TabStrip from '@/components/shared/TabStrip.vue';
import LibraryExportDialog from '@/components/LibraryExportDialog.vue';
import EnvironmentDetail from '@/components/library-page/EnvironmentDetail.vue';
import EnvironmentList from '@/components/library-page/EnvironmentList.vue';
import EnvironmentSetup from '@/components/library-page/EnvironmentSetup.vue';
import InlineNote from '@/components/shared/InlineNote.vue';
import EnvironmentDialog from '@/components/library-page/EnvironmentDialog.vue';
import PointerBoard from '@/components/library-page/PointerBoard.vue';
import LibraryAccessTab from '@/components/library-page/LibraryAccessTab.vue';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useActiveLibrary } from '@/composables/useActiveLibrary';
import { useApiClient } from '@/composables/useApiClient';
import { useAuth } from '@/composables/useAuth';
import { useDeploymentMode } from '@/composables/useDeploymentMode';
import { useLibraryEnvironments } from '@/composables/useLibraryEnvironments';
import { useLibraryGrants } from '@/composables/useLibraryGrants';
import { COMPARE_ALL, environmentView, type PointerMove, type PromotableKind } from '@/lib/environmentBoard';
import { isScreenSection, SCREEN_SECTION_PATHS, type RailSection } from '@/lib/railSections';

type LibraryTab = 'overview' | 'environments' | 'access';

const route = useRoute();
const router = useRouter();
const api = useApiClient();
const auth = useAuth();
const { isReadOnly } = useDeploymentMode();
const { activeLibraryId, activeLibrary, setActiveLibrary } = useActiveLibrary();

const libraryId = computed(() => activeLibraryId.value);
const library = computed(() => activeLibrary.value);

const envs = useLibraryEnvironments(() => libraryId.value);
const grants = useLibraryGrants(() => libraryId.value, () => envs.environments.value);

const backends = ref<Backend[]>([]);
const exportOpen = ref(false);

const canControl = computed(() =>
  !isReadOnly.value && !!libraryId.value && auth.canLibrary(libraryId.value, 'control'));
const showsAccess = computed(() => auth.mode.value !== 'disabled' && canControl.value);

function canPromote(environment: string): boolean {
  return !isReadOnly.value && auth.canEnvironment(environment, 'promote');
}

const tabs = computed(() => [
  { value: 'overview', label: 'Overview', testId: 'library-tab-overview' },
  { value: 'environments', label: 'Environments', count: envs.environments.value.length, testId: 'library-tab-environments' },
  ...(showsAccess.value ? [{ value: 'access', label: 'Access', testId: 'library-tab-access' }] : []),
]);

function tabFromRoute(): LibraryTab {
  const value = route.query.tab;
  return value === 'environments' || value === 'access' ? value : 'overview';
}

const tab = ref<LibraryTab>(tabFromRoute());
watch(tab, (value) => {
  if (route.query.tab !== value) router.replace({ query: { ...route.query, tab: value } });
});
watch(() => route.query.tab, () => { tab.value = tabFromRoute(); });

/*
 * The environment shown beside the list, kept in `?env=` by name. With none
 * named, the first one with something behind, else the first in the chain.
 */
const selectedEnv = computed<string | null>(() => {
  const list = envs.environments.value;
  const wanted = route.query.env;
  if (wanted === COMPARE_ALL) return COMPARE_ALL;
  const named = typeof wanted === 'string' ? list.find((env) => env.name === wanted) : null;
  if (named) return named.id;
  const waiting = list.find((_, index) => environmentView(envs.rows.value, index + 1).differing.length > 0);
  return (waiting ?? list[0])?.id ?? null;
});

const selectedIndex = computed(() => envs.environments.value.findIndex((env) => env.id === selectedEnv.value));
const selectedEnvironment = computed(() => envs.environments.value[selectedIndex.value] ?? null);

function selectEnv(value: string) {
  notice.value = null;
  const name = value === COMPARE_ALL ? COMPARE_ALL : envs.environments.value.find((env) => env.id === value)?.name;
  if (name) router.replace({ query: { ...route.query, env: name } });
}

function countOf(kind: PromotableKind): number {
  return envs.entities.value.filter((entity) => entity.kind === kind).length;
}

async function loadAll() {
  await envs.load();
  if (showsAccess.value || canControl.value) await grants.load();
}

onMounted(async () => {
  const wanted = typeof route.query.library === 'string' ? route.query.library : null;
  if (wanted && wanted !== activeLibraryId.value) setActiveLibrary(wanted);
  backends.value = await api.listBackends().catch(() => []);
});

watch(libraryId, () => void loadAll(), { immediate: true });

// --- chain ----------------------------------------------------------------

const busy = ref(false);
const chainError = ref<string | null>(null);
const dialogOpen = ref(false);
const dialogError = ref<string | null>(null);
const editing = ref<Environment | null>(null);

function openAdd() {
  editing.value = null;
  dialogError.value = null;
  dialogOpen.value = true;
}

function openEdit(env: Environment) {
  editing.value = env;
  dialogError.value = null;
  dialogOpen.value = true;
}

/** The position a new environment takes: halfway between `after` and the one that follows it. */
function positionAfter(after: string | null): number {
  const list = envs.environments.value;
  const index = after ? list.findIndex((env) => env.id === after) : -1;
  const before = index >= 0 ? (list[index].position ?? (index + 1) * 10) : 0;
  const next = list[index + 1];
  if (!next) return before + 10;
  const nextPosition = next.position ?? before + 10;
  return nextPosition - before > 1 ? Math.floor((before + nextPosition) / 2) : before + 1;
}

async function submitDialog(value: { name: string; defaultBackend: string | null; after: string | null; startFrom: string }) {
  busy.value = true;
  dialogError.value = null;
  const result = editing.value
    ? await envs.update(editing.value.id, { name: value.name, defaultBackend: value.defaultBackend })
    : await envs.create({
      name: value.name,
      defaultBackend: value.defaultBackend,
      position: positionAfter(value.after),
      startFrom: value.startFrom,
    });
  busy.value = false;
  if (!result.ok) {
    dialogError.value = result.error ?? 'The change was not saved';
    return;
  }
  dialogOpen.value = false;
  await envs.refresh();
  await grants.load();
}

async function setUp(names: string[], startFrom: string) {
  busy.value = true;
  chainError.value = null;
  const result = await envs.createChain(names, startFrom);
  busy.value = false;
  if (!result.ok) chainError.value = result.error ?? 'The environments were not created';
  await grants.load();
}

async function moveEnvironment(env: Environment, by: -1 | 1) {
  busy.value = true;
  chainError.value = null;
  const result = await envs.move(env.id, by);
  busy.value = false;
  if (!result.ok) chainError.value = result.error ?? 'The order was not saved';
}

const deleteOpen = ref(false);
const deleting = ref<Environment | null>(null);
const deleteTyped = ref('');
const deletingHolds = computed(() => deleting.value?.versions?.length ?? 0);

function askDelete(env: Environment) {
  deleting.value = env;
  deleteTyped.value = '';
  deleteOpen.value = true;
}

async function confirmDelete() {
  const target = deleting.value;
  if (!target || deleteTyped.value !== target.name) return;
  chainError.value = null;
  const result = await envs.remove(target.id);
  if (!result.ok) chainError.value = result.error ?? 'The environment was not deleted';
  await grants.load();
}

// --- board ----------------------------------------------------------------

const notice = ref<{ tone: 'warning' | 'danger'; text: string } | null>(null);

async function moveAll(moves: PointerMove[]) {
  busy.value = true;
  notice.value = null;
  for (const move of moves) {
    if (!(await movePointer(move))) break;
  }
  busy.value = false;
}

/** Returns whether the move landed. */
async function movePointer(value: PointerMove): Promise<boolean> {
  if (!busy.value) notice.value = null;
  const env = envs.environments.value.find((candidate) => candidate.id === value.environment);
  const outcome = await envs.movePointer(value.environment, value.entity.id, value.version, value.from);
  if (outcome.conflict) {
    notice.value = { tone: 'danger', text: `${value.entity.name} in ${env?.name} changed before your move. Check it and try again.` };
  } else if (!outcome.ok) {
    notice.value = { tone: 'danger', text: outcome.error ?? 'The move failed' };
  } else if (outcome.partsBehind) {
    const parts = outcome.partsBehind === 1 ? '1 query' : `${outcome.partsBehind} queries`;
    notice.value = { tone: 'warning', text: `${value.entity.name} runs ${parts} at other versions than ${env?.name} has.` };
  }
  return outcome.ok;
}

function handleRailSelect(section: RailSection) {
  const query = libraryId.value ? { library: libraryId.value } : {};
  if (isScreenSection(section)) {
    router.push({ path: SCREEN_SECTION_PATHS[section], query });
    return;
  }
  router.push({ path: `/${section}`, query });
}
</script>

<style scoped>
.library-layout {
  display: flex;
  height: 100vh;
  overflow: hidden;
  background: var(--surface);
}

.pane {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  overflow-y: auto;
}

.bar {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-5) var(--space-6);
  border-bottom: 1px solid var(--border-default);
}

.crumb {
  color: var(--ink-muted);
  font-size: var(--text-body);
}

.title {
  margin: 0;
  color: var(--ink);
  font-size: var(--text-title);
  font-weight: var(--weight-semibold);
}

.spacer {
  flex: 1;
}

.body {
  display: flex;
  flex-direction: column;
  gap: var(--space-7);
  padding: var(--space-6);
  min-width: 0;
}

.env-tab {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

.env-error {
  padding: var(--space-4) var(--space-6) 0;
}

.env-split {
  display: flex;
  flex: 1;
  min-height: 0;
}

.compare {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
  padding: var(--space-6) var(--space-7);
  overflow: auto;
}

.muted {
  margin: 0;
  color: var(--ink-muted);
}

.error {
  margin: 0;
  color: var(--danger-ink);
  font-size: var(--text-body);
}

.overview {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  max-width: 640px;
}

.description {
  margin: 0;
  color: var(--ink-secondary);
  font-size: var(--text-body-lg);
}

.facts {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--space-3) var(--space-7);
  margin: 0;
  font-size: var(--text-body);
}

.facts dt {
  color: var(--ink-muted);
}

.facts dd {
  margin: 0;
  color: var(--ink);
}

.link {
  padding: 0;
  border: none;
  background: none;
  color: var(--action-ink);
  font: inherit;
  cursor: pointer;
}

.effects {
  margin: 0;
  padding-left: var(--space-7);
  color: var(--ink-secondary);
  font-size: var(--text-body);
}

.confirm {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  color: var(--ink-secondary);
  font-size: var(--text-label);
}

.confirm-input {
  height: var(--control-h);
  padding: 0 var(--space-3);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink);
  font: inherit;
}

.delete-action {
  background: var(--danger);
  color: var(--danger-fg);
}
</style>
