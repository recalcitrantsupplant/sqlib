<template>
  <div class="editor-header">
    <div class="editor-header-row">
      <div class="title-format-group">
        <SectionLabel v-if="title" as="h4" size="lg">{{ title }}</SectionLabel>
        <div v-if="showFormatButton" class="format-slot">
          <slot name="format-button" />
        </div>
        <!--
          Document-wide actions that sit beside Format because they are the
          same kind of thing: one press, whole document rewritten. Their own
          slot rather than the format one so a panel that hides Format still
          gets them.
        -->
        <div v-if="$slots['editor-actions']" class="editor-actions-slot">
          <slot name="editor-actions" />
        </div>
      </div>

      <div class="editor-actions-row-1">
        <div v-if="!isNewEntity && !hideVersionSelector" class="version-selector-group">
          <SectionLabel :for="versionSelectId" as="label">{{ versionLabel }}</SectionLabel>
          <Select
            :model-value="selectedVersion ?? undefined"
            :disabled="isLoading || versionOptions.length === 0"
            @update:model-value="$emit('update:selectedVersion', $event as string)"
          >
            <SelectTrigger
              :id="versionSelectId"
              class="version-trigger-compact"
              :disabled="isLoading || versionOptions.length === 0"
            >
              <SelectValue :placeholder="versionPlaceholder" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="option in versionOptions"
                :key="option.value"
                :value="option.value"
                class="version-select-item"
              >
                {{ option.label }}
                <template #aside>
                  <span v-if="option.dateModified" class="version-timestamp">
                    {{ formatRelativeTime(option.dateModified) }}
                  </span>
                </template>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div v-if="!isNewEntity && versionId" class="version-id-display">
          <SectionLabel as="label">Version ID:</SectionLabel>
          <div class="id-display">
            <span class="id-text" :title="versionId">…{{ versionIdShort }}</span>
            <button
              class="btn-icon-copy"
              title="Copy Version ID"
              @click="$emit('copy-version-id')"
            >
              <Copy :size="12" />
            </button>
          </div>
        </div>

        <div v-if="!hideSaveButtons" class="button-group-compact">
          <button
            class="btn-compact btn-save"
            :title="saveTitle"
            :disabled="isNewEntity || isSaving"
            @click="$emit('save')"
          >
            <Save :size="12" />
            {{ saveLabel }}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <button
                class="btn-compact btn-save btn-dropdown-toggle"
                :title="saveOptionsTitle"
                :disabled="isNewEntity || isSaving"
              >
                <ChevronDown :size="12" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem :disabled="isSaving" @click="$emit('save-new-version')">
                {{ saveNewVersionLabel }}
              </DropdownMenuItem>
              <DropdownMenuItem
                v-if="showInvalidSaveOption"
                :disabled="isSaving"
                @click="$emit('save-invalid')"
              >
                {{ saveInvalidLabel }}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <button
          v-if="showDiffButton"
          class="btn-compact btn-icon btn-diff"
          :title="diffTitle"
          :disabled="isDiffDisabled"
          @click="$emit('toggle-diff')"
        >
          <GitCompare :size="12" />
        </button>

        <DropdownMenu v-if="!isNewEntity && !hideMoreActions">
          <DropdownMenuTrigger as-child>
            <button
              class="btn-compact btn-menu"
              :title="moreActionsTitle"
              :disabled="isSaving"
            >
              <EllipsisVertical :size="12" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem @click="$emit('delete')">
              {{ deleteLabel }}
            </DropdownMenuItem>
            <DropdownMenuItem @click="$emit('clone')">
              {{ cloneLabel }}
            </DropdownMenuItem>
            <DropdownMenuItem @click="$emit('move')">
              {{ moveLabel }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <div
          v-if="showExecutionRow && executionPlacement === 'inline'"
          class="execution-inline-slot"
        >
          <slot name="execution-row" />
        </div>

        <button
          v-if="!hideFocusButton"
          class="btn-compact btn-icon btn-focus"
          :title="focusTitle"
          :disabled="isSaving"
          @click="$emit('request-focus')"
        >
          <Expand :size="12" />
        </button>
      </div>
    </div>

    <div v-if="showExecutionRow && executionPlacement === 'row'" class="editor-header-row">
      <div class="editor-actions-row-2">
        <slot name="execution-row" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { ChevronDown, Copy, EllipsisVertical, Expand, GitCompare, Save } from '@lucide/vue';
import DropdownMenu from '../ui/dropdown-menu/DropdownMenu.vue';
import DropdownMenuContent from '../ui/dropdown-menu/DropdownMenuContent.vue';
import DropdownMenuItem from '../ui/dropdown-menu/DropdownMenuItem.vue';
import DropdownMenuTrigger from '../ui/dropdown-menu/DropdownMenuTrigger.vue';
import Select from '../ui/select/Select.vue';
import SelectContent from '../ui/select/SelectContent.vue';
import SelectItem from '../ui/select/SelectItem.vue';
import SelectTrigger from '../ui/select/SelectTrigger.vue';
import SelectValue from '../ui/select/SelectValue.vue';
import SectionLabel from './SectionLabel.vue';
import { formatRelativeTime } from '@/lib/time';

export type VersionOption = { value: string; label: string; dateModified?: string | null };

const props = withDefaults(
  defineProps<{
    title: string;
    versionOptions: VersionOption[];
    selectedVersion: string | null;
    versionId?: string | null;
    isNewEntity: boolean;
    isSaving: boolean;
    isLoading: boolean;
    showExecutionRow?: boolean;
    hideFocusButton?: boolean;
    hideVersionSelector?: boolean;
    hideSaveButtons?: boolean;
    hideMoreActions?: boolean;
    versionLabel?: string;
    versionPlaceholder?: string;
    saveLabel?: string;
    saveTitle?: string;
    saveOptionsTitle?: string;
    saveNewVersionLabel?: string;
    saveInvalidLabel?: string;
    focusTitle?: string;
    moreActionsTitle?: string;
    deleteLabel?: string;
    cloneLabel?: string;
    moveLabel?: string;
    showInvalidSaveOption?: boolean;
    showFormatButton?: boolean;
    showDiffButton?: boolean;
    diffTitle?: string;
    diffActive?: boolean;
    executionPlacement?: 'row' | 'inline';
  }>(),
  {
    versionId: null,
    showExecutionRow: false,
    hideFocusButton: false,
    hideVersionSelector: false,
    hideSaveButtons: false,
    hideMoreActions: false,
    versionLabel: 'Version:',
    versionPlaceholder: 'Select version',
    saveLabel: 'Save',
    saveTitle: 'Save',
    saveOptionsTitle: 'Save Options',
    saveNewVersionLabel: 'Save New Version',
    saveInvalidLabel: 'Save my sins',
    focusTitle: 'Focus Mode',
    moreActionsTitle: 'More actions',
    deleteLabel: 'Delete',
    cloneLabel: 'Clone',
    moveLabel: 'Move',
    showInvalidSaveOption: false,
    showFormatButton: true,
    showDiffButton: false,
    diffTitle: 'Compare Versions',
    diffActive: false,
    executionPlacement: 'row',
  },
);

defineEmits<{
  (e: 'save'): void;
  (e: 'save-new-version'): void;
  (e: 'save-invalid'): void;
  (e: 'request-focus'): void;
  (e: 'delete'): void;
  (e: 'clone'): void;
  (e: 'move'): void;
  (e: 'update:selectedVersion', value: string): void;
  (e: 'copy-version-id'): void;
  (e: 'toggle-diff'): void;
}>();

const versionSelectId = computed(() => `${props.title.replace(/\s+/g, '-').toLowerCase()}-version-selector`);

const versionIdShort = computed(() => {
  if (!props.versionId) {
    return '';
  }
  const parts = props.versionId.split(':');
  const lastPart = parts[parts.length - 1];
  return lastPart.slice(-6);
});

const isDiffDisabled = computed(
  () => props.isNewEntity || props.isLoading || props.isSaving || props.versionOptions.length <= 1,
);
</script>

<style scoped>
.editor-header {
  display: flex;
  flex-direction: column;
  border-bottom: 1px solid var(--border-default);
  background: var(--surface-subtle);
}

.editor-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) var(--space-5);
}

.title-format-group {
  display: flex;
  align-items: center;
  gap: var(--grid-gap);
}

.format-slot {
  display: flex;
  align-items: center;
}

.format-slot .btn-compact {
  width: var(--grid-3);
}

/*
 * No grid width here. These buttons carry an icon and a label whose lengths
 * differ, and the grid steps are an alignment floor rather than a cap — a hard
 * width squashes the icon when the label needs the room (see the note on
 * .btn-compact in compact-buttons.css).
 */
.editor-actions-slot {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.editor-actions-row-1 {
  display: flex;
  align-items: center;
  gap: var(--grid-gap);
}

.editor-actions-row-2 {
  display: flex;
  align-items: center;
  /*
   * Wraps rather than overflowing. The row holds a backend picker, a media
   * type picker, an argument-set picker and two buttons; once a 288px section
   * sidebar sits beside the editor there is no longer room for all of them on
   * one line, and overflowing put the backend picker off the left edge where
   * it could not be clicked at all.
   */
  flex-wrap: wrap;
  gap: var(--grid-gap);
  justify-content: flex-end;
  width: 100%;
}

.execution-inline-slot {
  display: flex;
  align-items: center;
  gap: var(--grid-gap);
}






.version-selector-group {
  display: flex;
  align-items: center;
  gap: var(--grid-gap);
}

.version-trigger-compact {
  width: var(--grid-5);
  height: var(--grid-unit);
  font-size: var(--text-body);
}

.version-select-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}

.version-timestamp {
  margin-left: 1em;
  font-size: var(--text-content);
  color: var(--ink-muted);
  white-space: nowrap;
}

.btn-menu {
  min-width: auto;
  width: var(--grid-unit);
  height: var(--grid-unit);
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.btn-icon {
  min-width: auto;
  width: var(--grid-unit);
  height: var(--grid-unit);
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.btn-focus:hover:not(:disabled) {
  background: var(--action);
  color: var(--action-fg);
  border-color: var(--action);
}

.btn-diff:hover:not(:disabled) {
  background: var(--action);
  color: var(--action-fg);
  border-color: var(--action);
}

.btn-diff:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.version-id-display {
  display: flex;
  align-items: center;
  gap: var(--grid-gap);
}

.id-display {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: var(--space-2) var(--space-4);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--surface-subtle);
  height: var(--grid-unit);
  width: var(--grid-3);
}

.id-text {
  font-size: var(--text-label);
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  color: var(--ink-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.btn-icon-copy {
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--ink-muted);
  border-radius: var(--radius-sm);
  transition: background-color 0.2s, color 0.2s;
  flex-shrink: 0;
}

.btn-icon-copy:hover:not(:disabled) {
  background: var(--surface-raised);
  color: var(--action-hover);
}

.btn-icon-copy:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

</style>
