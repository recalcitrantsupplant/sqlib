<template>
  <section class="cell" :data-testid="`notebook-md-${cell.id}`">
    <div class="cell__gutter">
      <span class="cell__index">{{ index }}</span>
    </div>

    <div class="cell__body">
      <!--
        A prose cell is the rendered prose until someone asks to edit it. The
        alternative — a permanent textarea — turns a document into a form, and
        the reason to have markdown cells at all is that the notebook reads as
        something written rather than as something configured.
      -->
      <div
        v-if="!editing"
        class="prose"
        :data-testid="`notebook-md-rendered-${cell.id}`"
        @dblclick="editing = true"
        v-html="html"
      ></div>
      <!--
        The same editor every other document in the app is typed into, asked
        for by media type. Markdown has headings to weight, code spans to tint
        and links to close — a textarea renders all of it as one grey block,
        which is the difference between seeing a heading and counting hashes.
      -->
      <CodeEditor
        v-else
        :model-value="cell.source"
        content-type="text/markdown"
        placeholder="Write about what the cells below do…"
        :test-id="`notebook-md-editor-${cell.id}`"
        :show-line-numbers="false"
        min-height="96px"
        max-height="60vh"
        @update:model-value="$emit('update', $event)"
      />

      <div class="cell__actions">
        <button type="button" class="action" @click="toggleEdit">
          {{ editing ? 'Done' : 'Edit' }}
        </button>
        <button type="button" class="action" aria-label="Move cell up" @click="$emit('move', -1)">Up</button>
        <button type="button" class="action" aria-label="Move cell down" @click="$emit('move', 1)">Down</button>
        <button type="button" class="action action--danger" @click="$emit('remove')">Remove</button>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import CodeEditor from '../shared/CodeEditor.vue';
import { renderMarkdown } from '../../lib/markdown';
import type { MarkdownCell } from '../../lib/notebookFormat';

/**
 * Prose, between the runs.
 *
 * The cell kind the old library page had no room for, and the one that makes a
 * sequence of queries legible as work rather than as a catalogue.
 *
 * `v-html` is safe here for one reason, and it is worth stating where it is
 * used rather than only where it is implemented: `renderMarkdown` escapes the
 * whole source before it emits a single tag, so no cell source can produce an
 * element the renderer did not write (`lib/markdown.ts`).
 */
const props = defineProps<{ cell: MarkdownCell; index: number }>();

defineEmits<{
  (e: 'update', source: string): void;
  (e: 'remove'): void;
  (e: 'move', delta: -1 | 1): void;
}>();

const editing = ref(props.cell.source.length === 0);

const html = computed(() =>
  props.cell.source.trim().length > 0
    ? renderMarkdown(props.cell.source)
    : '<p class="empty">Empty note — Edit to write something.</p>',
);

function toggleEdit() {
  editing.value = !editing.value;
}
</script>

<style scoped>
.cell {
  display: flex;
  gap: var(--space-4);
}

.cell__gutter {
  width: var(--space-7);
  flex-shrink: 0;
  text-align: right;
  padding-top: var(--space-1);
}

.cell__index {
  font-size: var(--text-micro);
  color: var(--ink-muted);
}

.cell__body {
  flex-grow: 1;
  min-width: 0;
}

.cell__actions {
  display: flex;
  gap: var(--space-3);
  margin-top: var(--space-2);
  opacity: 0;
  transition: opacity var(--duration-fast);
}

.cell:hover .cell__actions,
.cell:focus-within .cell__actions {
  opacity: 1;
}

.action {
  border: none;
  background: transparent;
  padding: 0;
  font-size: var(--text-micro);
  color: var(--ink-muted);
  cursor: pointer;
}

.action:hover {
  color: var(--ink);
  text-decoration: underline;
}

.action--danger:hover {
  color: var(--danger);
}


.prose {
  font-size: var(--text-content);
  line-height: var(--leading-normal);
  color: var(--ink-secondary);
}

.prose :deep(h1),
.prose :deep(h2),
.prose :deep(h3),
.prose :deep(h4) {
  margin: 0 0 var(--space-3);
  color: var(--ink);
  line-height: var(--leading-tight);
}

.prose :deep(h1) { font-size: var(--text-heading); }
.prose :deep(h2) { font-size: var(--text-heading); }
.prose :deep(h3) { font-size: var(--text-title); }
.prose :deep(h4) { font-size: var(--text-content); }

.prose :deep(p) {
  margin: 0 0 var(--space-4);
}

.prose :deep(ul),
.prose :deep(ol) {
  margin: 0 0 var(--space-4);
  padding-left: var(--space-7);
}

.prose :deep(code) {
  font-family: var(--font-mono);
  font-size: var(--text-body);
  background: var(--surface-sunken);
  border-radius: var(--radius-sm);
  padding: 0 var(--space-2);
}

.prose :deep(pre) {
  margin: 0 0 var(--space-4);
  padding: var(--space-4);
  background: var(--surface-sunken);
  border-radius: var(--radius);
  overflow-x: auto;
}

.prose :deep(blockquote) {
  margin: 0 0 var(--space-4);
  padding-left: var(--space-4);
  border-left: 2px solid var(--border-default);
  color: var(--ink-muted);
}

.prose :deep(.empty) {
  color: var(--ink-muted);
}
</style>
