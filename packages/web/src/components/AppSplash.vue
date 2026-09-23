<template>
  <!--
    The screen the app opens on, before a section is picked.

    It replaces the unscoped artifact tree, which was the last surface drawn in
    the pre-rail style: a second navigator listing every library and backend
    beside a rail that already lists every section. What a landing screen owes
    someone is what this deployment is and what it has, so that is what this
    draws — the sections in rail order, the ones that are off in a muted tone,
    and the libraries.
  -->
  <div class="splash" data-testid="app-splash">
    <div class="splash-inner">
      <header>
        <h1 class="wordmark">SQLIB</h1>
        <p class="standfirst">
          A library of SPARQL queries, groups, rule sets and the inputs they run on.
        </p>
      </header>

      <section class="block">
        <SectionLabel as="h2">Sections</SectionLabel>
        <ul class="sections">
          <li v-for="entry in sections" :key="entry.section">
            <button
              v-if="entry.enabled"
              type="button"
              class="section-card"
              :title="entry.title"
              :data-testid="`splash-section-${entry.section}`"
              @click="emit('select', entry.section)"
            >
              <component :is="entry.icon" :size="16" class="section-icon" />
              <span class="card-label">{{ entry.label }}</span>
            </button>
            <div
              v-else
              class="section-card section-card--off"
              :title="`${entry.title} — not enabled in this deployment`"
              :data-testid="`splash-section-${entry.section}`"
              aria-disabled="true"
            >
              <component :is="entry.icon" :size="16" class="section-icon" />
              <span class="card-label">{{ entry.label }}</span>
            </div>
          </li>
        </ul>
      </section>

      <section class="block">
        <SectionLabel as="h2">Libraries</SectionLabel>
        <p v-if="libraries.length === 0" class="empty">No libraries yet.</p>
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
            <!--
              Rename and delete live here because the tree they used to live on
              is gone and nothing else offers them. This is a holding place, not
              a claim that the landing screen is where a library is managed.
            -->
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

      <!--
        About, as a footer rather than a screen of its own. What it holds is
        read once — which build this is, and where the source and the docs are
        — and a destination nobody navigates to is a worse home for that than
        the bottom of the screen they land on.
      -->
      <footer class="about" data-testid="splash-about">
        <span class="build" data-testid="splash-version" :title="buildTitle">
          Version {{ label }}
        </span>
        <a class="about-link" :href="REPO_URL" target="_blank" rel="noreferrer">
          <Code :size="13" /> Source
        </a>
        <a class="about-link" :href="DOCS_URL" target="_blank" rel="noreferrer">
          <BookOpen :size="13" /> Documentation
        </a>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Enabled and disabled are told apart by tone alone, deliberately.
 *
 * A row of badges reading "enabled" next to every section would be a column of
 * the same word repeated, and the exceptions are what the reader is looking
 * for. A disabled section keeps its place in rail order so the list is the
 * same shape on every deployment.
 */
import { computed, onMounted } from 'vue';
import { BookOpen, Check, Code, Pencil, Plus, Trash2 } from '@lucide/vue';
import SectionLabel from './shared/SectionLabel.vue';
import { RAIL_ENTRIES } from '../lib/railEntries';
import type { RailSection } from '../lib/railSections';
import { useFeatureFlags } from '../composables/useFeatureFlags';
import { useActiveLibrary } from '../composables/useActiveLibrary';
import { useDeploymentMode } from '../composables/useDeploymentMode';
import { useBuildInfo } from '../composables/useBuildInfo';
import { DOCS_URL, REPO_URL } from '../lib/docs';

const emit = defineEmits<{
  (e: 'select', section: RailSection): void;
  (e: 'create-library'): void;
  (e: 'edit-library', payload: { libraryId: string; libraryName: string }): void;
  (e: 'delete-library', payload: { libraryId: string; libraryName: string }): void;
}>();

const { isEnabled } = useFeatureFlags();
const { libraries, activeLibraryId, setActiveLibrary, ensureLoaded } = useActiveLibrary();
const { isReadOnly, ensureLoaded: ensureDeploymentMode } = useDeploymentMode();
const { label, commit, builtOn } = useBuildInfo();

/* The build date and full commit belong in the tooltip, not on the line. */
const buildTitle = computed(() => {
  const parts = [commit.value ? `Commit ${commit.value}` : '', builtOn.value ? `built ${builtOn.value}` : ''];
  return parts.filter(Boolean).join(', ');
});

/*
 * Build is left out. It is a screen rather than a section, and its future is
 * not settled — naming it here would promise something this list cannot keep.
 */
const sections = computed(() =>
  RAIL_ENTRIES.filter((entry) => entry.section !== 'build').map((entry) => ({
    ...entry,
    enabled: entry.feature === null || isEnabled(entry.feature),
  })),
);

onMounted(() => {
  void ensureLoaded();
  void ensureDeploymentMode();
});
</script>

<style scoped>
.splash {
  height: 100%;
  overflow-y: auto;
  background: var(--surface-raised);
}

.about {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  margin-top: var(--space-4);
  padding-top: var(--space-4);
  border-top: 1px solid var(--border-subtle);
  color: var(--ink-muted);
  font-size: var(--text-micro);
}

.build {
  font-variant-numeric: tabular-nums;
}

.about-link {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--ink-secondary);
  text-decoration: none;
}

.about-link:hover,
.about-link:focus-visible {
  color: var(--ink);
  text-decoration: underline;
}

/* A reading column, centred: the page is prose and two short lists, and a list
   stretched across a wide monitor is a list nobody reads the right-hand end
   of. */
.splash-inner {
  max-width: 720px;
  margin: 0 auto;
  padding: var(--space-8) var(--space-6);
  display: flex;
  flex-direction: column;
  gap: var(--space-7);
}

.wordmark {
  margin: 0;
  font-size: var(--text-hero);
  font-weight: var(--weight-semibold);
  letter-spacing: 0.04em;
  color: var(--ink);
}

.standfirst {
  margin: var(--space-2) 0 0;
  color: var(--ink-secondary);
  font-size: var(--text-body);
}

.block {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.sections {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.section-card {
  width: 100%;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  height: var(--control-h-lg);
  padding: 0 var(--space-3);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink);
  font-family: inherit;
  font-size: var(--text-body);
  text-align: left;
  cursor: pointer;
}

button.section-card:hover,
button.section-card:focus-visible {
  border-color: var(--border-strong);
  background: var(--surface-subtle);
}

/* Off, in tone: muted ink, a subtle border and no pointer. */
.section-card--off {
  border-color: var(--border-subtle);
  background: transparent;
  color: var(--ink-muted);
  cursor: default;
}

.section-icon {
  flex-shrink: 0;
}

.card-label {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
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

.empty {
  margin: 0;
  color: var(--ink-muted);
  font-size: var(--text-body);
}
</style>
