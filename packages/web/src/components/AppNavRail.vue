<template>
  <nav class="nav-rail" aria-label="Primary">
    <!--
      The head of the rail is the library switcher, not a logo: the rail is the
      app's only already-global surface, so the thing that reparents every
      section below it belongs above them all (nav doc §2).
    -->
    <LibrarySwitcher @create-library="emit('create-library')" />

    <template v-for="entry in visibleSections" :key="entry.section">
      <div v-if="entry.dividerBefore" class="rail-divider" />
      <button
        class="rail-button"
        :class="{ active: activeSection === entry.section }"
        :aria-current="activeSection === entry.section ? 'page' : undefined"
        :title="entry.title"
        @click="emit('select', entry.section)"
      >
        <component :is="entry.icon" :size="16" />
        <span class="rail-label">{{ entry.label }}</span>
      </button>
    </template>

    <div class="rail-footer">
      <button class="rail-icon-button" title="Prefix manager" @click="prefixEditorOpen = true">
        <PrefixManagerIcon :size="16" />
      </button>
      <button
        v-if="settingsEnabled"
        class="rail-icon-button"
        title="Settings"
        aria-label="Settings"
        @click="settingsOpen = true"
      >
        <Settings :size="16" />
      </button>
    </div>

    <SettingsDialog
      v-if="settingsEnabled"
      v-model:open="settingsOpen"
      @open-prefix-manager="prefixEditorOpen = true"
    />
    <PrefixMappingsEditor v-model:open="prefixEditorOpen" />
  </nav>
</template>

<script setup lang="ts">
import { computed, ref, type Component } from 'vue';
import {
  Sparkles,
  NotebookPen,
  FileCode2,
  Workflow,
  Scale,
  GitFork,
  Gauge,
  CircleCheck,
  Braces,
  Database,
  Table2,
  Server,
  Settings,
} from '@lucide/vue';
import LibrarySwitcher from './LibrarySwitcher.vue';
import SettingsDialog from './SettingsDialog.vue';
import PrefixMappingsEditor from './PrefixMappingsEditor.vue';
import PrefixManagerIcon from './icons/PrefixManagerIcon.vue';
import { useFeatureFlags } from '../composables/useFeatureFlags';
import type { RailSection } from '../lib/railSections';

defineProps<{ activeSection: RailSection | null }>();

const emit = defineEmits<{
  (e: 'select', section: RailSection): void;
  /** Opens the page's Add Library dialog; the rail holds no dialog of its own. */
  (e: 'create-library'): void;
}>();

const { isEnabled } = useFeatureFlags();

const settingsOpen = ref(false);
const prefixEditorOpen = ref(false);

const settingsEnabled = computed(() => isEnabled('settings'));

interface RailEntry {
  section: RailSection;
  label: string;
  title: string;
  icon: Component;
  enabled: () => boolean;
  /** Draws the rule that separates account-level Backends from the rest. */
  dividerBefore?: boolean;
}

/*
 * Order is the v2 mockup's, and the labels are deliberately short enough to fit
 * the 56px rail without wrapping. There is no Play entry: a playground is an
 * unsaved item inside its own section, not a destination (nav doc §1).
 *
 * The divider sits above Backends, not below Build. Connections are
 * account-level and libraries point at them, so Backends is one level out from
 * everything above it — the rule is the whole explanation (nav doc §2).
 */
const SECTIONS: RailEntry[] = [
  // First, because it is the library's front page — the screen you show
  // someone before they know which type they want. Everything under it reads
  // as a drill-down.
  // The library's front page. It replaced a screen that rendered every query in
  // the library as a cell whether or not anyone had asked for it: the contents
  // are what you import here, and what you write around them is the point.
  { section: 'notebooks', label: 'Notebook', title: 'Notebook — prose and cells you write, run in order, with each result named', icon: NotebookPen, enabled: () => isEnabled('queries') },
  { section: 'queries', label: 'Query', title: 'Queries', icon: FileCode2, enabled: () => isEnabled('queries') },
  { section: 'queryGroups', label: 'Groups', title: 'Query groups', icon: Workflow, enabled: () => isEnabled('queryGroups') },
  { section: 'rules', label: 'Rules', title: 'Rules, data blocks and rule sets', icon: Scale, enabled: () => isEnabled('rulesSuite') },
  { section: 'etl', label: 'ETL', title: 'ETL', icon: GitFork, enabled: () => isEnabled('playgroundEtl') },
  { section: 'benchmarks', label: 'Bench', title: 'Benchmarks', icon: Gauge, enabled: () => isEnabled('benchmarks') },
  // Beside Bench because they invoke the same subjects the same way; separate
  // from it because a test is judged and a benchmark is measured.
  { section: 'tests', label: 'Tests', title: 'Tests — a callable, its inputs, and what it should produce', icon: CircleCheck, enabled: () => isEnabled('tests') },
  // Data graphs are registered reference RDF — the same move Backends made for
  // remote capabilities, so they get the same kind of home rather than living
  // in a dropdown inside the editor of something that consumes them.
  { section: 'dataGraphs', label: 'Graphs', title: 'Data graphs — reference RDF the library holds', icon: Database, enabled: () => isEnabled('dataGraphs') },
  // Beside Data because they are the same kind of thing — a static asset the
  // library registers — differing in shape rather than in kind. A data graph is
  // the store something runs against; a tuple set is rows spliced into a VALUES
  // clause and consumed. RDF input is data, tabular input is a parameter.
  { section: 'tupleSets', label: 'Tuples', title: 'Tuple sets — tabular rows a rule set\'s TUPLE(…) declaration is filled with', icon: Table2, enabled: () => isEnabled('tupleSets') },
  // The third of the three: Graphs and Tuples are pieces you keep, an argument
  // set is one filled-in call to a query or a group — a table per VALUES
  // clause, a graph per start-node port, and the LIMIT/OFFSET numbers.
  { section: 'argumentSets', label: 'Argument sets', title: 'Argument sets — one call\'s worth of input for a query or a group', icon: Braces, enabled: () => isEnabled('argumentSets') },
  { section: 'build', label: 'Build', title: 'Build — the callable library and the assistant', icon: Sparkles, enabled: () => true },
  {
    section: 'backends',
    label: 'Backends',
    title: 'Account-level — shared by every library',
    icon: Server,
    enabled: () => isEnabled('backends'),
    dividerBefore: true,
  },
];

const visibleSections = computed(() => SECTIONS.filter((entry) => entry.enabled()));
</script>

<style scoped>
.nav-rail {
  width: 56px;
  flex-shrink: 0;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-4) 0;
  background: var(--surface);
  border-right: 1px solid var(--border-default);
}

.rail-button {
  width: 44px;
  height: 42px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
  border: none;
  border-radius: var(--radius-panel);
  background: transparent;
  color: var(--ink-muted);
  font-family: inherit;
  cursor: pointer;
}

.rail-button:hover {
  background: var(--surface-subtle);
  color: var(--ink-secondary);
}

.rail-button.active {
  background: var(--action-surface);
  color: var(--action);
}

.rail-label {
  font-size: var(--text-micro);
  line-height: 1;
}

.rail-button.active .rail-label {
  font-weight: var(--weight-semibold);
}

.rail-divider {
  width: 28px;
  height: 1px;
  flex-shrink: 0;
  margin: var(--space-3) 0;
  background: var(--border-subtle);
}

.rail-footer {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.rail-icon-button {
  width: 44px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-panel);
  background: transparent;
  color: var(--ink-muted);
  cursor: pointer;
}

.rail-icon-button:hover {
  background: var(--surface-subtle);
  color: var(--ink-secondary);
}
</style>
