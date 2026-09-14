<template>
  <span
    class="tag-dot"
    :class="`tag-dot-${size}`"
    :style="{ background: fill }"
    :title="title || undefined"
    :aria-hidden="title ? undefined : 'true'"
    :role="title ? 'img' : undefined"
    :aria-label="title || undefined"
    data-testid="tag-dot"
  />
</template>

<script setup lang="ts">
/**
 * A tag's colour, as a dot.
 *
 * The one mark tags render as anywhere but a chip: on a group heading it says
 * which tag the heading is, and on a row it says which *other* tags that row
 * carries — the census read the sidebar is built around (tags mockup 1a).
 * Small because it repeats: 5px on a row, 8px on a heading.
 */
import { computed } from 'vue';
import { normalizeTagColor } from '../../lib/tagPalette';

const props = withDefaults(defineProps<{
  color?: string | null;
  size?: 'row' | 'heading';
  /** Given a title the dot becomes an image with a label; without one it is decoration. */
  title?: string | null;
}>(), { color: null, size: 'row', title: null });

const fill = computed(() => normalizeTagColor(props.color));
</script>

<style scoped>
.tag-dot {
  display: inline-block;
  flex-shrink: 0;
  border-radius: var(--radius-full);
}

.tag-dot-row {
  width: 5px;
  height: 5px;
}

.tag-dot-heading {
  width: 8px;
  height: 8px;
}
</style>
