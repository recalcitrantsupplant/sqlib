<template>
  <div class="build-layout">
    <AppNavRail active-section="build" @select="handleRailSelect" @home="goHome" />

    <AssistantChat
      :style="{ width: `${chatWidth}px` }"
      :library-id="libraryId"
      :library-name="activeLibrary?.name ?? null"
      :screen-context="screenContext"
    />

    <main class="artifact-pane">
      <!-- §5.1 Header row -->
      <header class="pane-header">
        <!--
          The library is named, not chosen, here: switching is the nav rail's
          job now, so this header states which library the endpoint belongs to
          instead of offering a second control for the same thing.
        -->
        <span class="library-name" data-testid="library-name">
          <Library :size="13" class="picker-icon" />{{ activeLibrary?.name ?? 'No library' }}
        </span>

        <span class="endpoint" :title="endpoint">POST {{ endpoint }}</span>
        <button type="button" class="icon-button" title="Copy base URL" @click="copyEndpoint">
          <Check v-if="endpointCopied" :size="12" />
          <Copy v-else :size="12" />
        </button>

        <div class="header-right">
          <!--
            The other view of the same library: Build is where it is made,
            Library is where it reads and runs.
          -->
          <NuxtLink v-if="isEnabled('notebook')" class="notebook-link" :to="notebookLink">
            <BookOpen :size="12" /> View as notebook
          </NuxtLink>
          <span class="feed-status" :class="eventStatus" :title="eventStatusLabel">
            <span class="feed-dot" aria-hidden="true"></span>
            <span class="sr-only">{{ eventStatusLabel }}</span>
          </span>
          <StatusBadge tone="success" :dot="false" data-testid="live-count-pill">{{ liveCount }} live</StatusBadge>
          <StatusBadge v-if="draftCount > 0" tone="warning" :dot="false" data-testid="draft-count-pill">
            <PencilLine :size="11" />{{ draftCount }} {{ draftCount === 1 ? 'draft' : 'drafts' }}
          </StatusBadge>
          <button
            type="button"
            class="save-all"
            :disabled="draftCount === 0 || saving"
            @click="saveAll"
          >
            {{ saveLabel }}
          </button>
        </div>
      </header>

      <!-- §5.2 Filter row -->
      <div class="filter-row">
        <label class="search">
          <Search :size="12" />
          <input
            v-model="search"
            type="search"
            class="search-input"
            placeholder="Search callables"
            aria-label="Search callables"
          />
        </label>

        <!--
          Type chips are both the summary and the filter. This is where "how
          much is in this library" gets answered, which is why the counts are
          on the chips rather than in a separate strip (§5.2).
        -->
        <div class="type-chips">
          <button
            v-for="chip in typeChips"
            :key="chip.id"
            type="button"
            class="chip"
            :class="{ active: typeFilter === chip.id }"
            @click="typeFilter = chip.id"
          >
            {{ chip.label }}<span class="chip-count">{{ chip.count }}</span>
          </button>
        </div>

        <div class="divider" />

        <div class="segmented" role="group" aria-label="State">
          <button
            v-for="option in STATE_OPTIONS"
            :key="option.id"
            type="button"
            class="segment"
            :class="{ active: stateFilter === option.id }"
            @click="stateFilter = option.id"
          >
            {{ option.label }}
          </button>
        </div>

        <div class="density">
          <button
            type="button"
            class="segment"
            :class="{ active: !stacked }"
            title="Compact"
            aria-label="Compact"
            @click="stacked = false"
          >
            <AlignJustify :size="13" />
          </button>
          <button
            type="button"
            class="segment"
            :class="{ active: stacked }"
            title="Expand all signatures"
            aria-label="Expand all signatures"
            @click="stacked = true"
          >
            <Rows3 :size="13" />
          </button>
        </div>
      </div>

      <div class="artifact-body">
        <div v-if="loading" class="pane-message">Loading callables…</div>
        <div v-else-if="error" class="pane-message error">{{ error }}</div>

        <CallableTable
          v-else
          :callables="visibleCallables"
          :stacked="stacked"
          :expanded-id="expandedId"
          :active-tab="activeTab"
          :backend-name="defaultBackendName"
          :backend-id="defaultBackendId"
          :library-id="libraryId"
          :empty-message="emptyMessage"
          @toggle="toggleRow"
          @open="openRow"
          @open-work-area="openInWorkArea"
          @save="saveOne"
          @update:active-tab="activeTab = $event"
        />

        <!--
          §5.5. Rule sets and backends live here because the assistant has to
          create and reference them and because backend availability is
          per-library. Managing them properly stays on their own screens.
        -->
        <ConfigSection
          title="Rulesets"
          kind="ruleset"
          :rows="rulesetRows"
          note="not callable — they change what queries return"
          empty-message="No rule sets in this library."
          open-title="Open ruleset"
          @open="openRuleSet"
        />

        <ConfigSection
          title="Backends"
          kind="backend"
          :rows="backendRows"
          empty-message="No backends configured."
          open-title="Open backend"
          @open="openBackend"
        />

        <ConnectAssistant />
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import {
  BookOpen,
  Library,
  Copy,
  Check,
  Search,
  PencilLine,
  AlignJustify,
  Rows3,
} from '@lucide/vue';
// @ts-ignore - Nuxt auto-import
import { useRoute, useRouter, useRuntimeConfig } from '#imports';
import AppNavRail from '../components/AppNavRail.vue';
import { fuzzyMatches } from '../lib/fuzzy';
import AssistantChat from '../components/build/AssistantChat.vue';
import CallableTable from '../components/build/CallableTable.vue';
import ConfigSection, { type ConfigRow } from '../components/build/ConfigSection.vue';
import ConnectAssistant from '../components/build/ConnectAssistant.vue';
import StatusBadge from '../components/shared/StatusBadge.vue';
import type { DetailTab } from '../components/build/CallableDetail.vue';
import { useActiveLibrary } from '../composables/useActiveLibrary';
import { useLibrariesStore } from '../composables/useLibrariesStore';
import { useBackendsStore } from '../composables/useBackendsStore';
import { useRuleSetsStore } from '../composables/useRuleSetsStore';
import { useCallables } from '../composables/useCallables';
import { useCallableDrafts } from '../composables/useCallableDrafts';
import { useApiClient } from '../composables/useApiClient';
import { useLibraryEvents } from '../composables/useLibraryEvents';
import { useLastExecutionError } from '../composables/useLastExecutionError';
import { useFeatureFlags } from '../composables/useFeatureFlags';
import { buildScreenContext } from '../lib/assistantScreenContext';
import { workAreaRouteFor, type Callable } from '../lib/callables';
import { isScreenSection, SCREEN_SECTION_PATHS, type RailSection } from '../lib/railSections';

const router = useRouter();
const route = useRoute();
const config = useRuntimeConfig();
const { isEnabled } = useFeatureFlags();

const librariesStore = useLibrariesStore();
const backendsStore = useBackendsStore();
const ruleSetsStore = useRuleSetsStore();
const apiClient = useApiClient();

/* 320–560 is the sensible range; resizing is not wired up yet. */
const chatWidth = ref(400);

/*
 * One switcher, one selection: the rail's control sets the active library and
 * every screen reads it. The `?library=` in the URL is still honoured on
 * arrival so a link into this screen lands on the library it names. It is read
 * once, here, because the watch below rewrites the URL from the selection.
 */
const requestedLibraryId = ((route.query.library as string) || null);
const { activeLibraryId: libraryId, activeLibrary, setActiveLibrary } = useActiveLibrary();
const search = ref('');
const typeFilter = ref<'all' | 'query' | 'group'>('all');
const stateFilter = ref<'all' | 'live' | 'draft'>('all');
const stacked = ref(false);
const expandedId = ref<string | null>(null);
const activeTab = ref<DetailTab>('try');
const endpointCopied = ref(false);
const saving = ref(false);

const { callables, liveCount, draftCount, loading, error, load } = useCallables(libraryId);
const { get: getDraft, remove: removeDraft, drafts } = useCallableDrafts(libraryId);

/*
 * The other half of the split screen. An MCP client — Claude Desktop, Claude
 * Code — writes through the same API routes this screen reads, and without
 * this the rows keep showing what they fetched on mount. Always on rather than
 * behind a toggle: a user should not have to know to press something for the
 * screen in front of them to be true. The indicator in the header is the
 * escape hatch's honest half — it says whether the feed is live, so a stale
 * screen is visibly stale.
 */
const { status: eventStatus } = useLibraryEvents({
  libraryId,
  openEntityId: expandedId,
  onChange: () => load(),
});

const eventStatusLabel = computed(() => {
  if (eventStatus.value === 'live') return 'live · connected';
  if (eventStatus.value === 'connecting') return 'live · connecting';
  return 'live · disconnected';
});

const STATE_OPTIONS = [
  { id: 'all', label: 'All' },
  { id: 'live', label: 'Live' },
  { id: 'draft', label: 'Drafts' },
] as const;

const { errorFor } = useLastExecutionError();

const openCallable = computed(
  () => callables.value.find((callable) => callable.id === expandedId.value) ?? null
);

/**
 * What the chat rail tells the assistant about this screen (#128 item 2).
 *
 * A computed rather than something assembled at send: the facts are already
 * reactive, and deriving them means the rail can never send a screen that has
 * moved on. The open row is the whole point — "why does it fail" needs to know
 * which "it" — and the draft body goes with it because an assistant that has
 * to fetch a version to see what the user is editing will fetch the *saved*
 * one, which is exactly not what is on screen.
 */
const screenContext = computed(() =>
  buildScreenContext({
    screen: 'build',
    library: activeLibrary.value ? { id: activeLibrary.value.id, name: activeLibrary.value.name } : null,
    openEntity: openCallable.value
      ? {
          id: openCallable.value.id,
          type: openCallable.value.type,
          name: openCallable.value.name,
          state: openCallable.value.state,
          tab: activeTab.value,
        }
      : null,
    draftBody: openCallable.value ? (getDraft(openCallable.value.id)?.queryString ?? null) : null,
    lastError: errorFor(openCallable.value?.id ?? null),
  })
);

const notebookLink = computed(() => ({
  path: '/library',
  query: libraryId.value ? { library: libraryId.value } : {},
}));

const endpoint = computed(
  () => `${String(config.public.apiBaseUrl).replace(/\/$/, '')}/execute`
);

const defaultBackendId = computed(() => activeLibrary.value?.defaultBackend ?? null);
const defaultBackendName = computed(
  () =>
    backendsStore.backends.value.find((backend) => backend.id === defaultBackendId.value)?.name ??
    null
);

const typeChips = computed(() => [
  { id: 'all' as const, label: 'All', count: callables.value.length },
  {
    id: 'query' as const,
    label: 'Queries',
    count: callables.value.filter((callable) => callable.type === 'query').length,
  },
  {
    id: 'group' as const,
    label: 'Groups',
    count: callables.value.filter((callable) => callable.type === 'group').length,
  },
]);

/* Fuzzy on the name, substring on the description — `lib/fuzzy` states why. The
 * table's own order stands; the search box prunes rows rather than ranking. */
const visibleCallables = computed(() =>
  callables.value.filter((callable) => {
    if (typeFilter.value !== 'all' && callable.type !== typeFilter.value) return false;
    if (stateFilter.value !== 'all' && callable.state !== stateFilter.value) return false;
    return fuzzyMatches(search.value, callable.name, callable.description);
  }),
);

const emptyMessage = computed(() => {
  if (callables.value.length === 0) {
    return 'Nothing callable in this library yet. Describe what your app needs and the assistant will build it.';
  }
  return 'No callable matches these filters.';
});

const saveLabel = computed(() => {
  if (saving.value) return 'Saving…';
  if (draftCount.value === 0) return 'Nothing to save';
  return `Save ${draftCount.value} ${draftCount.value === 1 ? 'draft' : 'drafts'}`;
});

const rulesetRows = computed<ConfigRow[]>(() =>
  ruleSetsStore.ruleSets.value
    .filter((ruleSet) => !libraryId.value || ruleSet.isPartOf.includes(libraryId.value))
    .map((ruleSet) => ({
      id: ruleSet.id,
      name: ruleSet.name,
      badge: ruleSet.currentVersion ? 'versioned' : 'no version',
      badgeTone: ruleSet.currentVersion ? ('neutral' as const) : ('warning' as const),
      facts: [
        `${ruleSet.rules?.length ?? 0} rules`,
        `${ruleSet.dataBlocks?.length ?? 0} data blocks`,
      ],
    }))
);

const backendRows = computed<ConfigRow[]>(() =>
  backendsStore.backends.value.map((backend) => ({
    id: backend.id,
    name: backend.name,
    badge: backend.id === defaultBackendId.value ? 'library default' : null,
    badgeTone: 'success' as const,
    facts: [backend.backendType, backend.endpoint ?? 'no endpoint'],
  }))
);

/** The mark at the head of the rail: back to the splash. */
function goHome() {
  router.push({ path: '/' });
}

function handleRailSelect(section: RailSection) {
  if (section === 'build') return;
  if (isScreenSection(section)) {
    router.push({
      path: SCREEN_SECTION_PATHS[section],
      query: libraryId.value ? { library: libraryId.value } : {},
    });
    return;
  }
  router.push({ path: '/', query: { section } });
}

function toggleRow(id: string) {
  // One row open at a time (§5.4) — two open detail panes and the signatures
  // above them stop lining up, which is the whole point of the fixed grid.
  expandedId.value = expandedId.value === id ? null : id;
}

function openRow(id: string, tab: 'try' | 'code') {
  expandedId.value = id;
  activeTab.value = tab;
}

function openInWorkArea(callable: Callable) {
  const draft = callable.state === 'draft' ? getDraft(callable.id) : null;
  router.push({ path: '/', query: workAreaRouteFor(callable, draft?.basedOn ?? null) });
}

function openRuleSet(id: string) {
  router.push({ path: '/', query: { ruleSet: id } });
}

function openBackend(id: string) {
  router.push({ path: '/', query: { section: 'backends', backend: id } });
}

async function copyEndpoint() {
  try {
    await navigator.clipboard.writeText(endpoint.value);
    endpointCopied.value = true;
    setTimeout(() => {
      endpointCopied.value = false;
    }, 1500);
  } catch {
    // The URL is on screen; a failed clipboard write is not worth a toast.
  }
}

/**
 * Save = create a new version, because versioned entities are immutable and
 * there is nothing to update in place (§6.4).
 *
 * Only the body goes up. The server derives inputs and outputs from the query
 * string when it stores the version, so sending the draft's detected names
 * would be handing it back its own guess.
 */
async function saveOne(callable: Callable) {
  const draft = getDraft(callable.id);
  if (!draft || draft.type !== 'query' || !draft.queryString) return;

  saving.value = true;
  try {
    await apiClient.createQueryVersion(draft.basedOn ?? draft.id, {
      queryVersion: { queryString: draft.queryString, comment: draft.description },
    });
    removeDraft(draft.id);
    await load();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Save failed';
  } finally {
    saving.value = false;
  }
}

/*
 * Per-item with partial success, not all-or-nothing (§6.4 leaves the choice
 * open). Each save is an independent POST that cannot be rolled back once
 * it lands, so an all-or-nothing promise would be one this cannot keep. A
 * draft that fails stays a draft, and the header counts say how many are left.
 */
async function saveAll() {
  saving.value = true;
  const failures: string[] = [];
  try {
    for (const draft of [...drafts.value]) {
      if (draft.type !== 'query' || !draft.queryString) {
        failures.push(draft.name);
        continue;
      }
      try {
        await apiClient.createQueryVersion(draft.basedOn ?? draft.id, {
          queryVersion: { queryString: draft.queryString, comment: draft.description },
        });
        removeDraft(draft.id);
      } catch {
        failures.push(draft.name);
      }
    }
    error.value = failures.length
      ? `Saved all but ${failures.length}: ${failures.join(', ')} still draft.`
      : null;
    await load();
  } finally {
    saving.value = false;
  }
}

watch(libraryId, (id) => {
  expandedId.value = null;
  if (id) {
    router.replace({ query: { ...route.query, library: id } });
  }
  void load();
});

onMounted(async () => {
  await Promise.all([
    librariesStore.loadLibraries(),
    backendsStore.loadBackends(),
    ruleSetsStore.fetchRuleSets(),
  ]);
  if (requestedLibraryId && requestedLibraryId !== libraryId.value) {
    setActiveLibrary(requestedLibraryId);
  } else {
    void load();
  }
});
</script>

<style scoped>
/*
 * A fixed three-column shell with no page scroll; each column scrolls on its
 * own.
 */
.build-layout {
  display: flex;
  height: 100vh;
  overflow: hidden;
  background: var(--surface-subtle);
  font-size: var(--text-body);
}

.artifact-pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--surface-subtle);
}

.pane-header {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: var(--space-4);
  height: 40px;
  flex-shrink: 0;
  padding: 0 var(--space-6);
  background: var(--surface);
  border-bottom: 1px solid var(--border-default);
}

.library-name {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;
  color: var(--ink);
  font-size: var(--text-body);
  font-weight: var(--weight-semibold);
}

.picker-icon {
  flex-shrink: 0;
  color: var(--ink-muted);
}

.endpoint {
  min-width: 0;
  font-family: var(--font-mono);
  font-size: var(--text-label);
  color: var(--ink-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  border: none;
  border-radius: var(--radius);
  background: none;
  color: var(--ink-muted);
  cursor: pointer;
}

.header-right {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-left: auto;
  flex-shrink: 0;
}

.notebook-link {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  height: 24px;
  padding: 0 var(--space-3);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  color: var(--ink-secondary);
  font-size: var(--text-label);
  text-decoration: none;
}

/*
 * A dot, not a pill. The feed being up is the normal case and deserves no
 * words; what earns attention is it being down, which is the one state that
 * changes colour and stops the screen from being trustworthy.
 */
.feed-status {
  display: inline-flex;
  align-items: center;
}

.feed-dot {
  width: 7px;
  height: 7px;
  border-radius: var(--radius-full);
  background: var(--success);
}

.feed-status.connecting .feed-dot {
  background: var(--warning);
}

.feed-status.idle .feed-dot,
.feed-status.offline .feed-dot {
  background: var(--border-default);
}

.save-all {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  height: var(--control-h);
  padding: 0 var(--space-5);
  border: 1px solid var(--action);
  border-radius: var(--radius);
  background: var(--action);
  font-family: inherit;
  font-size: var(--text-body);
  font-weight: var(--weight-semibold);
  color: var(--action-fg);
  white-space: nowrap;
  cursor: pointer;
}

.save-all:disabled {
  border-color: var(--border-default);
  background: var(--surface-raised);
  color: var(--ink-disabled);
  cursor: not-allowed;
}

.filter-row {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: var(--space-4);
  height: 36px;
  flex-shrink: 0;
  padding: 0 var(--space-6);
  background: var(--surface);
  border-bottom: 1px solid var(--border-default);
}

.search {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 190px;
  height: 26px;
  flex-shrink: 0;
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  color: var(--ink-muted);
}

.search-input {
  width: 100%;
  border: none;
  background: none;
  font-family: inherit;
  font-size: var(--text-label);
  color: var(--ink);
}

.search-input:focus {
  outline: none;
}

.type-chips {
  display: flex;
  align-items: center;
  gap: 1px;
  flex-shrink: 0;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  height: 24px;
  padding: 0 var(--space-4);
  border: none;
  border-radius: var(--radius);
  background: transparent;
  font-family: inherit;
  font-size: var(--text-label);
  color: var(--ink-muted);
  white-space: nowrap;
  cursor: pointer;
}

.chip.active {
  background: var(--action-surface);
  font-weight: var(--weight-semibold);
  color: var(--action-ink);
}

.chip-count {
  color: var(--ink-muted);
}

.chip.active .chip-count {
  color: var(--action);
}

.divider {
  width: 1px;
  height: 18px;
  flex-shrink: 0;
  background: var(--border-subtle);
}

.segmented,
.density {
  display: inline-flex;
  overflow: hidden;
  height: 26px;
  flex-shrink: 0;
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
}

.density {
  margin-left: auto;
}

.segment {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 26px;
  padding: 0 var(--space-4);
  border: none;
  border-left: 1px solid var(--border-default);
  background: var(--surface);
  font-family: inherit;
  font-size: var(--text-label);
  color: var(--ink-muted);
  cursor: pointer;
}

.segment:first-child {
  border-left: none;
}

.segment.active {
  background: var(--segment-selected);
  font-weight: var(--weight-semibold);
  color: var(--segment-selected-ink);
}

.artifact-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: var(--space-6);
}

.pane-message {
  padding: var(--space-7);
  text-align: center;
  font-size: var(--text-body);
  color: var(--ink-muted);
}

.pane-message.error {
  color: var(--danger-ink);
}
</style>
