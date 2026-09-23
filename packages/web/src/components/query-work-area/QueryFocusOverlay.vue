<template>
  <div class="focus-overlay" @click.self="$emit('update:show', false)">
    <div class="focus-container">
      <PanelHeader title="SPARQL Query Editor" size="lg" sunken>
        <template #actions>
          <button
            v-if="canDiff"
            class="btn-compact btn-icon btn-diff"
            :class="{ 'btn-active': showDiff }"
            title="Compare Versions"
            @click="$emit('toggle-diff')"
          >
            <GitCompare :size="16" />
          </button>
          <button class="btn-icon" title="Close Focus Mode" @click="$emit('update:show', false)">
            <X :size="20" />
          </button>
        </template>
      </PanelHeader>

      <div v-if="showDiff" class="focus-diff-controls">
        <div class="diff-version-selector">
          <SectionLabel for="focus-diff-left-version" as="label" size="md">Left:</SectionLabel>
          <Select
            :model-value="diffLeftVersion ?? undefined"
            @update:model-value="(value) => $emit('update-diff-left-version', value as string)"
          >
            <SelectTrigger id="focus-diff-left-version" class="diff-version-trigger">
              <SelectValue placeholder="Select version" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-if="hasDraftEdits" :value="DRAFT_SIDE">Draft</SelectItem>
              <SelectItem
                v-for="option in versionOptions"
                :key="option.value"
                :value="option.value"
              >
                v{{ option.label }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <button
          class="btn-compact btn-icon"
          title="Swap versions"
          @click="$emit('swap-diff-versions')"
        >
          <ArrowLeftRight :size="16" />
        </button>

        <div class="diff-version-selector">
          <SectionLabel for="focus-diff-right-version" as="label" size="md">Right:</SectionLabel>
          <Select
            :model-value="diffRightVersion ?? undefined"
            @update:model-value="(value) => $emit('update-diff-right-version', value as string)"
          >
            <SelectTrigger id="focus-diff-right-version" class="diff-version-trigger">
              <SelectValue placeholder="Select version" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-if="hasDraftEdits" :value="DRAFT_SIDE">Draft</SelectItem>
              <SelectItem
                v-for="option in versionOptions"
                :key="option.value"
                :value="option.value"
              >
                v{{ option.label }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div class="focus-content focus-content-editor">
        <!--
          Keyed for the same reason the panel's editor is: a different query or
          version arriving in this instance would otherwise be one more
          undoable change on top of the last one's text. See
          `useEditorDocumentKey`. The swap is cross-faded here too — the
          pop-out is the editor at full size, so a hard cut in it is the whole
          screen changing at once.

          The same fade carries the move between the editor and the diff, which
          is the other way the contents of this box are replaced.
        -->
        <CodeSwapTransition>
          <Codemirror
            v-if="!showDiff"
            :key="documentKey ?? undefined"
            :model-value="queryCode"
            placeholder="Enter SPARQL query..."
            :style="{ height: '100%', width: '100%' }"
            :autofocus="true"
            :indent-with-tab="true"
            :tab-size="2"
            :extensions="extensions"
            @update:model-value="(value) => $emit('update:queryCode', value)"
          />

          <SparqlDiffViewer
            v-else-if="diffLeftQuery && diffRightQuery"
            :left-query="diffLeftQuery"
            :right-query="diffRightQuery"
            :left-label="diffLeftLabel"
            :right-label="diffRightLabel"
            height="100%"
          />

          <div v-else class="diff-loading">
            <Loader2 :size="32" class="spin-icon" />
            <span>Loading versions...</span>
          </div>
        </CodeSwapTransition>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ArrowLeftRight, GitCompare, Loader2, X } from '@lucide/vue';
import { Codemirror } from 'vue-codemirror';
import Select from '../ui/select/Select.vue';
import SelectContent from '../ui/select/SelectContent.vue';
import SelectItem from '../ui/select/SelectItem.vue';
import SelectTrigger from '../ui/select/SelectTrigger.vue';
import SelectValue from '../ui/select/SelectValue.vue';
import PanelHeader from '../shared/PanelHeader.vue';
import SectionLabel from '../shared/SectionLabel.vue';
import SparqlDiffViewer from '../shared/SparqlDiffViewer.vue';
import { DRAFT_SIDE } from '@/lib/versionDiff';
import CodeSwapTransition from '../shared/CodeSwapTransition.vue';

interface VersionOption {
  value: string;
  label: string;
  dateModified?: string | null;
}

withDefaults(defineProps<{
  show: boolean;
  queryCode: string;
  /** Names the document in the editor; see `useEditorDocumentKey`. */
  documentKey?: string | null;
  extensions: any[];
  showDiff: boolean;
  versionOptions: VersionOption[];
  /** Whether there is anything to diff — see `planVersionDiff`. */
  canDiff: boolean;
  /** Offer the draft as a side when the editor holds unsaved edits. */
  hasDraftEdits?: boolean;
  diffLeftVersion: string | null;
  diffRightVersion: string | null;
  diffLeftQuery: string | null;
  diffRightQuery: string | null;
  diffLeftLabel: string;
  diffRightLabel: string;
}>(), {
  documentKey: undefined,
  hasDraftEdits: false,
});

defineEmits<{
  (e: 'update:show', value: boolean): void;
  (e: 'update:queryCode', value: string): void;
  (e: 'toggle-diff'): void;
  (e: 'update-diff-left-version', value: string): void;
  (e: 'update-diff-right-version', value: string): void;
  (e: 'swap-diff-versions'): void;
}>();
</script>

<style scoped>
.focus-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  /*
   * Deliberately no backdrop-filter. Blurring the full viewport makes the
   * compositor re-blur the whole page on every frame of the open animation,
   * which halved the frame rate: 9 dropped frames per open with it, 1
   * without. The dim is raised to keep the same separation from the content
   * behind. Measured by tests/e2e/perf/ablation.spec.ts.
   */
  background: rgba(0, 0, 0, 0.72);
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 5vh 5vw;
  animation: fadeIn 0.12s ease-out;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.focus-container {
  width: 100%;
  height: 100%;
  background: var(--surface);
  border-radius: var(--radius-xl);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: slideUp 0.15s ease-out;
}

@keyframes slideUp {
  from {
    transform: translateY(20px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

.btn-diff:hover:not(:disabled) {
  background: var(--action);
  color: var(--action-fg);
  border-color: var(--action);
}

.btn-diff.btn-active {
  background: var(--action);
  color: var(--action-fg);
  border-color: var(--action);
}

.focus-diff-controls {
  flex-shrink: 0;
  padding: var(--space-6) var(--space-7);
  border-bottom: 1px solid var(--border-default);
  background: var(--surface-subtle);
  display: flex;
  align-items: center;
  gap: 16px;
  justify-content: center;
}

.diff-version-selector {
  display: flex;
  align-items: center;
  gap: 8px;
}

.diff-version-trigger {
  min-width: 140px;
  height: 32px;
  font-size: var(--text-body-lg);
}

.focus-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.focus-content-editor {
  padding: var(--space-6);
  /* The outgoing editor of a swap is laid over the incoming one from here;
     see `CodeSwapTransition`. */
  position: relative;
}

.diff-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  height: 100%;
  color: var(--ink-muted);
  font-size: var(--text-content);
}

.spin-icon {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
