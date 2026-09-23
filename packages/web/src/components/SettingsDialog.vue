<template>
  <Dialog v-model:open="isOpen">
    <DialogContent class="settings-dialog p-0 gap-0 sm:max-w-lg" :show-close-button="false">
      <DialogTitleBar
        title="Settings"
        description="Preferences for this browser only."
        @close="handleClose"
      />

      <div class="settings-body">
        <section class="settings-section">
          <SectionLabel as="h3">Appearance</SectionLabel>
          <div class="setting-row">
            <div class="setting-text">
              <span class="setting-label">Theme</span>
              <span class="setting-description">System follows your OS.</span>
            </div>
            <div class="theme-options" role="radiogroup" aria-label="Theme">
              <button
                v-for="option in themeOptions"
                :key="option.value"
                type="button"
                role="radio"
                :aria-checked="preference === option.value"
                class="theme-option"
                :class="{ active: preference === option.value }"
                @click="setTheme(option.value)"
              >
                <component :is="option.icon" :size="13" />
                {{ option.label }}
              </button>
            </div>
          </div>
        </section>

        <div class="settings-divider" />

        <section class="settings-section">
          <SectionLabel as="h3">Result tables</SectionLabel>
          <div class="setting-row">
            <label class="setting-text" for="setting-abbreviate-iris">
              <span class="setting-label">Abbreviate IRIs</span>
              <span class="setting-description">
                Show <code>schema:name</code> instead of the full IRI wherever a prefix matches.
              </span>
            </label>
            <Switch
              id="setting-abbreviate-iris"
              class="setting-switch"
              :model-value="settings.prefixAbbreviationEnabled"
              @update:model-value="setPrefixAbbreviationEnabled($event)"
            />
          </div>
          <button type="button" class="nav-row" @click="openPrefixMappingsEditor">
            <span class="setting-label">Prefix Manager</span>
            <span class="nav-row-value">
              {{ prefixSummary }}
              <ChevronRightIcon :size="13" />
            </span>
          </button>
        </section>

        <div class="settings-divider" />

        <section class="settings-section">
          <SectionLabel as="h3">Advanced</SectionLabel>
          <div class="setting-row">
            <label class="setting-text" for="setting-hofstadter-mode">
              <span class="setting-label">Hofstadter mode</span>
              <span class="setting-description">
                Show the System Library — the queries this app runs against its own store — in the
                switcher and tree.
                <template v-if="isReadOnly">Unavailable on a read-only deployment.</template>
              </span>
            </label>
            <Switch
              id="setting-hofstadter-mode"
              class="setting-switch"
              data-testid="setting-hofstadter-mode"
              :disabled="isReadOnly"
              :model-value="!isReadOnly && settings.hofstadterMode"
              @update:model-value="setHofstadterMode($event)"
            />
          </div>
        </section>
      </div>

      <DialogFooter class="settings-footer">
        <!--
          The version, where it is reachable from any screen. The splash
          carries the same line with the source and docs links beside it; this
          is the copy you can get to without closing what you are working on,
          which is when somebody is usually asking for it.
        -->
        <span class="build" data-testid="settings-version" :title="buildTitle">
          SQLIB {{ buildLabel }}
        </span>
        <button type="button" class="btn-done" @click="handleClose">Done</button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
/**
 * Settings, rebuilt against the design system.
 *
 * See `docs/reference/ui-design-tokens.md`. What changed: the hand-rolled
 * 44x24 toggle is gone in favour of the shadcn `Switch` the Prefix Manager
 * already used; sections are `SectionLabel`s rather than per-setting cards;
 * and the `open-prefix-manager` emit, which nothing called, is now a row under
 * the toggle that depends on it.
 */
import { computed, ref, watch } from 'vue';
import { Dialog, DialogContent, DialogFooter } from './ui/dialog';
import { Switch } from './ui/switch';
import SectionLabel from './shared/SectionLabel.vue';
import DialogTitleBar from './shared/DialogTitleBar.vue';
import { Monitor, Sun, Moon, ChevronRightIcon } from '@lucide/vue';
import { useSettings, type ThemePreference } from '../composables/useSettings';
import { useDeploymentMode } from '../composables/useDeploymentMode';
import { useBuildInfo } from '../composables/useBuildInfo';
import { useTheme } from '../composables/useTheme';
import { usePrefixManager } from '../composables/usePrefixManager';

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
  'open-prefix-manager': [];
}>();

const isOpen = ref(props.open);
const { settings, setHofstadterMode, setPrefixAbbreviationEnabled } = useSettings();
const { preference, setTheme } = useTheme();
const { prefixSettings } = usePrefixManager();
/*
 * A read-only deployment has no System Library worth looking at — nothing
 * writes it — so the toggle reads off and refuses the press rather than
 * offering a view of an empty store.
 */
const { isReadOnly, ensureLoaded: ensureDeploymentMode } = useDeploymentMode();
void ensureDeploymentMode();

const { label: buildLabel, commit, builtOn } = useBuildInfo();
const buildTitle = computed(() => {
  const parts = [commit.value ? `Commit ${commit.value}` : '', builtOn.value ? `built ${builtOn.value}` : ''];
  return parts.filter(Boolean).join(', ');
});

const themeOptions: { value: ThemePreference; label: string; icon: unknown }[] = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
];

const prefixSummary = computed(() => {
  const count = prefixSettings.value.mappings.length;
  return `${count} ${count === 1 ? 'prefix' : 'prefixes'}`;
});

function openPrefixMappingsEditor() {
  emit('open-prefix-manager');
  isOpen.value = false;
}

// Sync with prop
watch(() => props.open, (value) => {
  isOpen.value = value;
});

// Sync with parent
watch(isOpen, (value) => {
  emit('update:open', value);
});

function handleClose() {
  isOpen.value = false;
}
</script>

<style scoped>
.settings-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  padding: var(--space-5);
}

.settings-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.settings-divider {
  height: 1px;
  background: var(--border-subtle);
}

.setting-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-5);
}

.setting-text {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  max-width: 44ch;
  cursor: pointer;
}

.setting-label {
  font-size: var(--text-body);
  font-weight: var(--weight-medium);
  color: var(--ink);
}

.setting-description {
  font-size: var(--text-label);
  line-height: 1.45;
  color: var(--ink-muted);
}

.setting-description code {
  font-family: var(--font-mono);
  font-size: var(--text-label);
}

/* The switch is 18px tall; centre it against the first line of the label. */
.setting-switch {
  flex-shrink: 0;
  margin-top: var(--space-1);
}

.nav-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  width: 100%;
  height: var(--control-h);
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface);
  font-family: inherit;
  cursor: pointer;
  transition: background var(--duration), border-color var(--duration);
}

.nav-row:hover {
  background: var(--surface-subtle);
  border-color: var(--border-strong);
}

.nav-row:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring);
  outline-offset: -1px;
}

.nav-row-value {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  font-size: var(--text-body);
  color: var(--ink-muted);
}

.theme-options {
  display: flex;
  flex-shrink: 0;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  overflow: hidden;
}

.theme-option {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  height: var(--control-h);
  padding: 0 var(--space-5);
  border: none;
  border-right: 1px solid var(--border-strong);
  background: var(--surface);
  color: var(--ink-secondary);
  font-family: inherit;
  font-size: var(--text-body);
  font-weight: var(--weight-medium);
  cursor: pointer;
  transition: background var(--duration), color var(--duration);
}

.theme-option:last-child {
  border-right: none;
}

.theme-option:hover:not(.active) {
  background: var(--surface-subtle);
}

.theme-option.active {
  background: var(--action);
  color: var(--action-fg);
}

.theme-option:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring);
  outline-offset: -2px;
}

.settings-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-5);
  border-top: 1px solid var(--border-default);
  background: var(--surface-subtle);
}

.build {
  color: var(--ink-muted);
  font-size: var(--text-micro);
  font-variant-numeric: tabular-nums;
}

/* Settings apply on change, so this dismisses — it does not commit. */
.btn-done {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: var(--control-h);
  min-width: var(--grid-2);
  padding: 0 var(--space-5);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink);
  font-family: inherit;
  font-size: var(--text-body);
  font-weight: var(--weight-medium);
  cursor: pointer;
  transition: background var(--duration);
}

.btn-done:hover {
  background: var(--surface-subtle);
}

.btn-done:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring);
  outline-offset: -1px;
}
</style>
