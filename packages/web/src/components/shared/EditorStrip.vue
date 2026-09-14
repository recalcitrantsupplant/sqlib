<template>
  <!--
    A collapsible strip above an editor, for authored text that is *not* part
    of the document below it.

    Both of its users are that shape and neither is the document: initial
    tuples are seed rows for the tuple store, and the data graph is the input
    the rules run against. Putting either inside the editor would say they were
    part of the rule set, which is exactly what they are not.
  -->
  <section class="editor-strip" :data-testid="testid">
    <button class="strip-header" type="button" :data-testid="testid ? `${testid}-toggle` : undefined" @click="expanded = !expanded">
      <ChevronDown v-if="expanded" :size="13" />
      <ChevronRight v-else :size="13" />
      <SectionLabel>{{ title }}</SectionLabel>
      <span class="strip-summary" :data-testid="testid ? `${testid}-summary` : undefined">{{ summary }}</span>
      <span v-if="hint" class="strip-hint" :title="hintTitle">{{ hint }}</span>
      <span class="strip-spacer" />
      <slot name="header-end" />
    </button>

    <div v-if="expanded" class="strip-body" :style="bodyStyle">
      <slot />
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { ChevronDown, ChevronRight } from '@lucide/vue';
import SectionLabel from './SectionLabel.vue';

const props = withDefaults(defineProps<{
  /** The uppercase heading, rendered through SectionLabel like every other. */
  title: string;
  /** What is set, readable with the strip closed — so collapsed is never hidden. */
  summary: string;
  /** Short pill after the summary; the sentence itself goes in `hintTitle`. */
  hint?: string;
  hintTitle?: string;
  /**
   * Whether the strip starts open. A strip that only renders when a feature was
   * deliberately turned on should; one that is always present should not.
   */
  defaultExpanded?: boolean;
  /** Caps the body height where the slot can grow without bound. */
  maxBodyHeight?: string;
  testid?: string;
}>(), {
  hint: '',
  hintTitle: '',
  defaultExpanded: false,
  maxBodyHeight: '',
  testid: '',
});

const expanded = ref(props.defaultExpanded);

const bodyStyle = props.maxBodyHeight
  ? { maxHeight: props.maxBodyHeight, overflow: 'auto' }
  : undefined;
</script>

<style scoped>
.editor-strip {
  flex-shrink: 0;
  background: var(--surface);
  border-bottom: 1px solid var(--border-default);
}

.strip-header {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  width: 100%;
  min-height: var(--control-h);
  padding: 0 var(--space-5);
  border: none;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--surface-subtle);
  color: var(--ink-secondary);
  font-family: inherit;
  cursor: pointer;
}

.strip-summary,
.strip-hint {
  color: var(--ink-muted);
  font-size: var(--text-label);
}

.strip-hint {
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-full);
  background: var(--surface);
}

.strip-spacer {
  flex: 1;
}
</style>
