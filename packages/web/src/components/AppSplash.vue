<template>
  <!--
    The screen the app opens on, before a section is picked.

    Three reading zones in one column — type, browse, catch up. The field owns
    the top of the screen, because the fastest way into a library you know is to
    name the thing you want; the grid says what this library holds, in the rail's
    own order; and the log at the foot says what has moved lately, in one wide
    column where long names have room.

    The libraries themselves are one card in that grid rather than a list down
    the page. A deployment has a handful of them and you pick one and forget it,
    so the list opens from its card rather than occupying the screen in front of
    everyone who already knows which library they are in.
  -->
  <div class="splash" data-testid="app-splash">
    <div class="splash-inner">
      <header class="cold-open">
        <h1 class="wordmark">SQLIB</h1>
        <p class="standfirst">
          <template v-if="activeLibraryName">
            {{ activeLibraryName }} · {{ totalItems }} {{ totalItems === 1 ? 'item' : 'items' }}
          </template>
          <template v-else>
            A library of SPARQL queries, groups, rule sets and the inputs they run on.
          </template>
        </p>
        <!--
          A button drawn as a field, not a field: what it opens is the command
          palette, which has its own input and its own matching. A second search
          box here would be a second thing to keep in step with it.
        -->
        <button
          type="button"
          class="command-field"
          data-testid="splash-command-field"
          :title="`Open the command palette (${paletteBinding})`"
          @click="openPalette"
        >
          <Search :size="16" class="command-icon" />
          <span class="command-placeholder">Run, open or create anything…</span>
          <span class="command-key">{{ paletteBinding }}</span>
        </button>
      </header>

      <section class="grid" aria-label="What this library holds">
        <SplashCountCard
          label="Libraries"
          :title="librariesTitle"
          :icon="Library"
          :count="libraries.length"
          family="axis"
          to
          data-testid="splash-libraries"
          :aria-expanded="librariesOpen"
          @open="librariesOpen = !librariesOpen"
        />
        <SplashCountCard
          v-for="card in cards"
          :key="card.section"
          :label="card.label"
          :title="card.title"
          :icon="card.icon"
          :count="card.count"
          :family="card.family"
          :to="card.enabled"
          :disabled="!card.enabled"
          :data-testid="`splash-section-${card.section}`"
          @open="emit('select', card.section)"
        />
      </section>

      <!--
        Rename and delete live here because the tree they used to live on is
        gone and nothing else offers them. This is a holding place, not a claim
        that the landing screen is where a library is managed.
      -->
      <section v-if="librariesOpen" class="block" data-testid="splash-libraries-panel">
        <SectionLabel as="h2">Libraries</SectionLabel>
        <EmptyState v-if="libraries.length === 0" size="sm" title="No libraries yet" />
        <ul v-else class="libraries">
          <li v-for="library in libraries" :key="library.id" class="library-row">
            <button
              type="button"
              class="library-open"
              :title="`Make ${library.name} the active library`"
              :data-testid="`splash-library-${library.id}`"
              @click="setActiveLibrary(library.id)"
            >
              <span class="library-name">
                {{ library.name }}
                <Check v-if="library.id === activeLibraryId" :size="12" class="library-active" />
              </span>
              <span v-if="library.description" class="library-description">
                {{ library.description }}
              </span>
            </button>
            <div v-if="!isReadOnly" class="library-actions">
              <button
                type="button"
                class="row-action"
                title="Rename this library"
                :data-testid="`splash-library-edit-${library.id}`"
                @click="emit('edit-library', { libraryId: library.id, libraryName: library.name })"
              >
                <Pencil :size="13" />
              </button>
              <button
                type="button"
                class="row-action row-action--danger"
                title="Delete this library"
                :data-testid="`splash-library-delete-${library.id}`"
                @click="emit('delete-library', { libraryId: library.id, libraryName: library.name })"
              >
                <Trash2 :size="13" />
              </button>
            </div>
          </li>
        </ul>
        <button
          v-if="!isReadOnly"
          type="button"
          class="new-library"
          data-testid="splash-library-create"
          @click="emit('create-library')"
        >
          <Plus :size="13" /> New library
        </button>
      </section>

      <SplashActivityLog :entries="activity" @open="openEntity" />

      <SplashStatusStrip :backend="backendFact" :tests="testsFact" />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Enabled and disabled are told apart by tone alone, deliberately.
 *
 * A row of badges reading "enabled" next to every card would be a column of
 * the same word repeated, and the exceptions are what the reader is looking
 * for. A disabled section keeps its place in rail order so the grid is the
 * same shape on every deployment, and shows an em dash where its count would
 * be: zero is a fact about a library, "not in this deployment" is not.
 */
import { computed, onMounted, ref } from 'vue';
import { Check, Library, Pencil, Plus, Search, Trash2 } from '@lucide/vue';
import SectionLabel from './shared/SectionLabel.vue';
import EmptyState from './shared/EmptyState.vue';
import SplashCountCard from './splash/SplashCountCard.vue';
import SplashActivityLog from './splash/SplashActivityLog.vue';
import SplashStatusStrip, { type StripFact } from './splash/SplashStatusStrip.vue';
import { RAIL_ENTRIES } from '../lib/railEntries';
import type { RailSection } from '../lib/railSections';
import { formatBinding } from '../lib/keys';
import { useFeatureFlags } from '../composables/useFeatureFlags';
import { useActiveLibrary } from '../composables/useActiveLibrary';
import { useDeploymentMode } from '../composables/useDeploymentMode';
import { useCommandPalette } from '../composables/useCommandPalette';
import { useLibraryInventory, type ActivityEntry } from '../composables/useLibraryInventory';
import { useBackendsStore } from '../composables/useBackendsStore';
import { useBackendProbes, type BackendHealth } from '../composables/useBackendProbes';
import { useTestsStore } from '../composables/useTestsStore';
import { isInLibrary } from '../composables/useEntityKinds';
import type { ListSection } from '../lib/sections';

const emit = defineEmits<{
  (e: 'select', section: RailSection): void;
  (e: 'open-entity', payload: { section: ListSection; id: string }): void;
  (e: 'create-library'): void;
  (e: 'edit-library', payload: { libraryId: string; libraryName: string }): void;
  (e: 'delete-library', payload: { libraryId: string; libraryName: string }): void;
}>();

const { isEnabled } = useFeatureFlags();
const { libraries, activeLibraryId, activeLibraryName, setActiveLibrary, ensureLoaded } = useActiveLibrary();
const { isReadOnly, ensureLoaded: ensureDeploymentMode } = useDeploymentMode();
const { openPalette } = useCommandPalette();
const { counts, totalItems, activity, load: loadInventory } = useLibraryInventory(activeLibraryId);
const backendsStore = useBackendsStore();
const { healthFor, loadProbes } = useBackendProbes();
const testsStore = useTestsStore();

const librariesOpen = ref(false);

const paletteBinding = computed(() => formatBinding('Mod+k'));

const librariesTitle = computed(() =>
  librariesOpen.value ? 'Hide the libraries' : 'Every library on this deployment',
);

/**
 * The grid, in the order the mockup settles on: what the library defines, then
 * the backends it runs against and the inputs it keeps, then what judges it.
 *
 * It is the rail's order with one move — Backends, which the rail keeps below a
 * divider because it is account-level, heads the second row here for the same
 * reason: it is where the inputs start.
 *
 * MCP is left out, as Build was before it. It is a screen rather than a
 * section, and it is about this deployment's MCP server rather than about
 * anything the library holds, so it has nothing to count in a grid of library
 * contents.
 */
const CARD_ORDER: RailSection[] = [
  'notebooks', 'queries', 'queryGroups', 'rules', 'etl',
  'backends', 'dataGraphs', 'tupleSets', 'argumentSets',
  'tests', 'benchmarks',
];

const FAMILY_OF: Record<RailSection, 'definition' | 'input' | 'evidence' | 'axis'> = {
  notebooks: 'definition',
  queries: 'definition',
  queryGroups: 'definition',
  rules: 'definition',
  etl: 'definition',
  mcp: 'definition',
  backends: 'axis',
  dataGraphs: 'input',
  tupleSets: 'input',
  argumentSets: 'input',
  tests: 'evidence',
  benchmarks: 'evidence',
};

const cards = computed(() =>
  CARD_ORDER.map((section) => {
    const entry = RAIL_ENTRIES.find((candidate) => candidate.section === section)!;
    const enabled = entry.feature === null || isEnabled(entry.feature);
    /*
     * The Notebook has no count of its own: notebooks are drafts held in this
     * browser, not entities the library stores, so a number under it would
     * count something other than what every other card counts.
     */
    const count = counts.value[section] ?? null;
    return {
      section,
      label: entry.label,
      title: enabled ? entry.title : `${entry.title} — not enabled in this deployment`,
      icon: entry.icon,
      family: FAMILY_OF[section],
      count: enabled ? count : null,
      enabled,
    };
  }),
);

/** Which store this library talks to, and whether it answered last time we asked. */
const TONE_OF_HEALTH: Record<BackendHealth, StripFact['tone']> = {
  healthy: 'success',
  slow: 'warning',
  unreachable: 'danger',
  never_probed: 'neutral',
};

const backendFact = computed<StripFact | null>(() => {
  const id = libraries.value.find((library) => library.id === activeLibraryId.value)?.defaultBackend;
  if (!id) return null;
  const backend = backendsStore.backends.value.find((candidate) => candidate.id === id);
  if (!backend) return null;
  const health = healthFor(id);
  return {
    label: backend.name,
    title: `Default backend — ${backend.backendType}, last probe: ${health.replace('_', ' ')}`,
    tone: TONE_OF_HEALTH[health],
  };
});

/**
 * The verdicts this browser holds, as one line.
 *
 * `lastRunByTest` is a board rather than a history — one verdict per test, kept
 * in this browser (`lib/testRunCache.ts`) — so the line is omitted entirely
 * until something has been run here. A pass rate over no runs would read as
 * "nothing is passing".
 */
const testsFact = computed<StripFact | null>(() => {
  const library = activeLibraryId.value;
  if (!library) return null;
  const tests = testsStore.tests.value.filter((test) => isInLibrary(test, library));
  const judged = tests.filter((test) => testsStore.lastRunByTest.value[test.id]);
  if (judged.length === 0) return null;
  const passed = judged.filter((test) => testsStore.lastRunByTest.value[test.id]?.passed).length;
  return {
    label: `${passed}/${judged.length} passing`,
    title: `The last verdict held in this browser for ${judged.length} of ${tests.length} tests`,
    tone: passed === judged.length ? 'success' : 'danger',
  };
});

function openEntity(entry: ActivityEntry) {
  emit('open-entity', { section: entry.section, id: entry.id });
}

onMounted(() => {
  void ensureLoaded();
  void ensureDeploymentMode();
  void loadInventory();
  void loadProbes();
});
</script>

<style scoped>
.splash {
  height: 100%;
  overflow-y: auto;
  background: var(--surface-raised);
}

/* A reading column, centred, wide enough for six cards across: the grid is the
   widest thing on the page and everything else lines up with it. */
.splash-inner {
  max-width: 960px;
  margin: 0 auto;
  padding: var(--space-8) var(--space-6);
  display: flex;
  flex-direction: column;
  gap: var(--space-7);
}

/* The cold open: two lines and a field, centred, with room above and below so
   nothing else competes for the top of the screen. */
.cold-open {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-8) 0 var(--space-5);
}

.wordmark {
  margin: 0;
  font-family: var(--font-mono);
  font-size: var(--text-hero-fluid);
  font-weight: var(--weight-semibold);
  letter-spacing: 0.02em;
  color: var(--ink);
}

.standfirst {
  margin: 0;
  color: var(--ink-muted);
  font-size: var(--text-body-lg);
  text-align: center;
}

.command-field {
  /* Taller than a control, because it is the one thing on the screen you are
     meant to reach for first. Named rather than inline: it aligns with the
     block, not with the control scale. */
  --splash-field-h: 44px;

  display: flex;
  align-items: center;
  gap: var(--space-4);
  width: 100%;
  max-width: 560px;
  height: var(--splash-field-h);
  margin-top: var(--space-2);
  padding: 0 var(--space-5);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  background: var(--surface);
  font-family: inherit;
  cursor: pointer;
}

.command-field:hover,
.command-field:focus-visible {
  border-color: var(--action-border);
}

.command-icon {
  flex-shrink: 0;
  color: var(--ink-muted);
}

.command-placeholder {
  color: var(--ink-muted);
  font-size: var(--text-content);
}

.command-key {
  margin-left: auto;
  color: var(--ink-muted);
  font-family: var(--font-mono);
  font-size: var(--text-micro);
}

/*
 * Six across, which is what makes the rows read as the three families: the
 * libraries and what this one defines, then the backends and the inputs, then
 * the evidence. Below the width six cards can hold a label in, it falls back to
 * as many as fit.
 */
.grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: var(--space-3);
}

@media (max-width: 900px) {
  .grid {
    grid-template-columns: repeat(auto-fit, minmax(var(--grid-5), 1fr));
  }
}

.block {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.libraries {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.library-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius);
  background: var(--surface);
}

.library-open {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border: none;
  background: transparent;
  color: inherit;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}

.library-name {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  overflow: hidden;
  color: var(--ink);
  font-size: var(--text-body);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.library-active {
  flex-shrink: 0;
  color: var(--action);
}

/* One line, ellipsised. A library description is a paragraph in places, and
   the row is a row. */
.library-description {
  overflow: hidden;
  color: var(--ink-muted);
  font-size: var(--text-micro);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.library-actions {
  flex-shrink: 0;
  display: flex;
  gap: var(--space-1);
}

.row-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--control-h-sm);
  height: var(--control-h-sm);
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink-muted);
  cursor: pointer;
}

.row-action:hover,
.row-action:focus-visible {
  border-color: var(--border-default);
  background: var(--surface-subtle);
  color: var(--ink);
}

.row-action--danger:hover,
.row-action--danger:focus-visible {
  color: var(--danger);
}

.new-library {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  height: var(--control-h);
  padding: 0 var(--space-3);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink-secondary);
  font-family: inherit;
  font-size: var(--text-body);
  cursor: pointer;
}

.new-library:hover,
.new-library:focus-visible {
  border-color: var(--border-strong);
  color: var(--ink);
}
</style>
