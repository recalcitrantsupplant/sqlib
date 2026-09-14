<template>
  <label v-if="tags.length" class="inherit-tags" data-testid="inherit-tags-toggle">
    <input
      type="checkbox"
      data-testid="inherit-tags-checkbox"
      :checked="modelValue"
      :disabled="disabled"
      @change="emit('update:modelValue', ($event.target as HTMLInputElement).checked)"
    />
    <span class="inherit-tags-body">
      <span class="inherit-tags-label">
        Copy {{ tags.length }} {{ tags.length === 1 ? 'tag' : 'tags' }} from the {{ sourceLabel }}
      </span>
      <!--
        The chips, not just the count. "Copy 3 tags" asks for trust; the names
        beside it are what let someone see a tag they did not mean to carry
        into a suite that runs on it.
      -->
      <span class="inherit-tags-chips">
        <span
          v-for="tag in tags"
          :key="tag.id"
          class="inherit-tag-chip"
          :class="{ 'inherit-tag-chip--off': !modelValue }"
          :style="modelValue ? { background: tag.color, color: tag.ink } : undefined"
          :data-testid="`inherit-tag-chip-${tag.id}`"
        >{{ tag.name }}</span>
      </span>
      <InlineNote as="span" class="inherit-tags-hint">
        A copy, not a link — retagging the {{ sourceLabel }} later leaves this alone.
      </InlineNote>
    </span>
  </label>
</template>

<script setup lang="ts">
/**
 * "Copy tags from the thing this is about", on the two screens that create a
 * test through a form.
 *
 * Default on, because the common case is that a test belongs to whatever suite
 * its subject belongs to — that is what makes `POST /tests/run` with a tag a
 * suite rather than a list somebody maintains twice. Off is the exception, and
 * the exception is what the checkbox is for.
 *
 * It does not *do* the copying. Ticked means the create body omits `tags` and
 * the server applies its default; unticked means the body sends `[]`, which is
 * the one way to say "none" to a server that would otherwise seed. Keeping the
 * copy server-side is what makes the one-click "make a test from this" buttons,
 * the REST API and MCP behave the same as this form.
 *
 * Renders nothing when the subject carries no tags: a checkbox offering to copy
 * zero tags is a question with one answer.
 */
import InlineNote from '../shared/InlineNote.vue';
import type { InheritedTag } from '../../composables/useInheritedTags';

withDefaults(defineProps<{
  modelValue: boolean;
  tags: InheritedTag[];
  /** What the subject is called here — "query", "rule set". Lower case; it sits mid-sentence. */
  sourceLabel: string;
  disabled?: boolean;
}>(), { disabled: false });

const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>();
</script>

<style scoped>
.inherit-tags {
  display: flex;
  gap: var(--space-4);
  align-items: flex-start;
  cursor: pointer;
}

.inherit-tags-body {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-4);
  align-items: center;
}

.inherit-tags-label {
  font-size: var(--text-body);
}

.inherit-tags-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.inherit-tag-chip {
  padding: 0 var(--space-3);
  border-radius: var(--radius-full);
  font-size: var(--text-label);
  line-height: 1.6;
  white-space: nowrap;
}

/*
  Unticked, the chips stay on screen rather than vanishing: what you are
  declining is the point, and a control whose explanation disappears when you
  use it cannot be reconsidered without toggling it back.
*/
.inherit-tag-chip--off {
  background: var(--surface-raised);
  color: var(--ink-muted);
  text-decoration: line-through;
}

/* Its own line under the chips — the row's fact, not the note's. */
.inherit-tags-hint {
  flex-basis: 100%;
}
</style>
