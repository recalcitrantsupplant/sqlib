<template>
  <div class="diff-pane" data-testid="query-diff-pane">
    <!--
      The row the run strip is not drawing while this is up: same height, same
      chrome, so moving between the editor and the diff does not move the code
      under them. The pair being compared is centred — it is the subject of
      this view, not an action on it — and the way back sits where actions sit.
    -->
    <div class="diff-controls">
      <div class="diff-versions">
        <div class="diff-version-selector">
          <SectionLabel for="query-diff-left-version" as="label" size="md">Left:</SectionLabel>
          <Select
            :model-value="leftVersion ?? undefined"
            @update:model-value="(value) => $emit('update-left-version', value as string)"
          >
            <SelectTrigger id="query-diff-left-version" class="diff-version-trigger">
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

        <!--
          `btn-icon` alone: with `btn-compact` as well, its hover rule is the
          more specific of the two and repaints the button --surface-subtle,
          lighter than the --surface-raised it rests on.
        -->
        <button
          class="btn-icon"
          title="Swap versions"
          @click="$emit('swap-versions')"
        >
          <ArrowLeftRight :size="16" />
        </button>

        <div class="diff-version-selector">
          <SectionLabel for="query-diff-right-version" as="label" size="md">Right:</SectionLabel>
          <Select
            :model-value="rightVersion ?? undefined"
            @update:model-value="(value) => $emit('update-right-version', value as string)"
          >
            <SelectTrigger id="query-diff-right-version" class="diff-version-trigger">
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

      <!--
        The way back. The editor's own Diff button is underneath this pane, so
        the toggle has to be reachable from on top of it.
      -->
      <button
        class="btn-compact diff-close"
        data-testid="close-query-diff"
        title="Back to the editor"
        @click="$emit('close')"
      >
        Editor
      </button>
    </div>

    <div class="diff-body">
      <SparqlDiffViewer
        v-if="leftQuery && rightQuery"
        :left-query="leftQuery"
        :right-query="rightQuery"
        :left-label="leftLabel"
        :right-label="rightLabel"
        height="100%"
      />

      <div v-else class="diff-loading">
        <Loader2 :size="32" class="spin-icon" />
        <span>Loading versions…</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * The query editor's Diff: two versions side by side, with the pair being
 * compared chosen above them.
 *
 * It is a pane rather than an overlay of its own because it opens over the
 * editor pop-out and replaces what that box is showing — see
 * `ExpandableEditor`'s `layer` slot. The editor underneath keeps its instance,
 * so coming back lands on the same text, selection and undo history.
 */
import { ArrowLeftRight, Loader2 } from '@lucide/vue';
import Select from '../ui/select/Select.vue';
import SelectContent from '../ui/select/SelectContent.vue';
import SelectItem from '../ui/select/SelectItem.vue';
import SelectTrigger from '../ui/select/SelectTrigger.vue';
import SelectValue from '../ui/select/SelectValue.vue';
import SectionLabel from '../shared/SectionLabel.vue';
import SparqlDiffViewer from '../shared/SparqlDiffViewer.vue';
import { DRAFT_SIDE } from '@/lib/versionDiff';

interface VersionOption {
  value: string;
  label: string;
  dateModified?: string | null;
}

withDefaults(defineProps<{
  versionOptions: VersionOption[];
  /** Offer the draft as a side when the editor holds unsaved edits. */
  hasDraftEdits?: boolean;
  leftVersion: string | null;
  rightVersion: string | null;
  /** Null until that side has been fetched. */
  leftQuery: string | null;
  rightQuery: string | null;
  leftLabel: string;
  rightLabel: string;
}>(), {
  hasDraftEdits: false,
});

defineEmits<{
  (e: 'update-left-version', value: string): void;
  (e: 'update-right-version', value: string): void;
  (e: 'swap-versions'): void;
  (e: 'close'): void;
}>();
</script>

<style scoped>
.diff-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

/*
 * The run row's own chrome and height (`RunBar`): --panel-bar-h with the same
 * padding, and controls at --control-h so nothing inside makes it taller.
 */
.diff-controls {
  /* Three tracks, so the pair is centred on the row rather than on what is
     left of it once the button beside it has taken its width. */
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  flex-shrink: 0;
  box-sizing: border-box;
  min-height: var(--panel-bar-h);
  padding: var(--space-2) var(--space-5);
  background: var(--surface-subtle);
  border-bottom: 1px solid var(--border-default);
}

.diff-versions {
  display: flex;
  grid-column: 2;
  align-items: center;
  gap: var(--space-6);
}

.diff-version-selector {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.diff-version-trigger {
  min-width: 140px;
  height: var(--control-h);
  font-size: var(--text-body);
}

.diff-close {
  grid-column: 3;
  justify-self: end;
}

.diff-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.diff-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-6);
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
