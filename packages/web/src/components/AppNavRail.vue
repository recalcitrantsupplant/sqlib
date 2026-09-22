<template>
  <nav class="nav-rail" aria-label="Primary">
    <!--
      The head of the rail is the library switcher, not a logo: the rail is the
      app's only already-global surface, so the thing that reparents every
      section below it belongs above them all (nav doc §2).
    -->
    <LibrarySwitcher @create-library="emit('create-library')" @home="emit('home')" />

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
import { computed, ref } from 'vue';
import { Settings } from '@lucide/vue';
import LibrarySwitcher from './LibrarySwitcher.vue';
import SettingsDialog from './SettingsDialog.vue';
import PrefixMappingsEditor from './PrefixMappingsEditor.vue';
import PrefixManagerIcon from './icons/PrefixManagerIcon.vue';
import { useFeatureFlags } from '../composables/useFeatureFlags';
import type { RailSection } from '../lib/railSections';
import { RAIL_ENTRIES } from '../lib/railEntries';

defineProps<{ activeSection: RailSection | null }>();

const emit = defineEmits<{
  (e: 'select', section: RailSection): void;
  /** Opens the page's Add Library dialog; the rail holds no dialog of its own. */
  (e: 'create-library'): void;
  /** The mark at the head of the rail: back to the splash, from any page. */
  (e: 'home'): void;
}>();

const { isEnabled } = useFeatureFlags();

const settingsOpen = ref(false);
const prefixEditorOpen = ref(false);

const settingsEnabled = computed(() => isEnabled('settings'));

const visibleSections = computed(() =>
  RAIL_ENTRIES.filter((entry) => entry.feature === null || isEnabled(entry.feature)),
);
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
