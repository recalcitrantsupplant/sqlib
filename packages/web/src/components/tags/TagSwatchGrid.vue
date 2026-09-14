<template>
  <div class="swatch-grid" role="group" :aria-label="`Colour for ${tagName}`" data-testid="tag-swatch-grid">
    <button
      v-for="swatch in swatches"
      :key="swatch.hex"
      type="button"
      class="swatch"
      :class="{ current: swatch.current, taken: swatch.taken }"
      :style="{ background: swatch.hex, boxShadow: swatch.current ? `0 0 0 2px var(--surface), 0 0 0 4px ${swatch.hex}` : undefined }"
      :title="swatch.title"
      :aria-label="swatch.title"
      :aria-pressed="swatch.current"
      :data-testid="`tag-swatch-${swatch.hex.slice(1)}`"
      @click="emit('select', swatch.hex)"
    />
    <!--
      The escape hatch the design leaves open (tags doc §4.2): colour is stored
      as a literal hex, so a colour outside the eight is expressible and there
      is no reason to refuse it. A native input rather than a picker library —
      eight values plus this is not worth a bundle.
    -->
    <label class="swatch custom" title="Custom colour" data-testid="tag-swatch-custom">
      <Pipette :size="12" />
      <input type="color" class="custom-input" :value="current" @input="onCustom" />
    </label>
  </div>
</template>

<script setup lang="ts">
/**
 * The eight, plus custom.
 *
 * Dimmed swatches are the ones another tag in this library already holds. They
 * stay clickable: two tags sharing a colour is legal and occasionally wanted
 * (a "deprecated" pair, say), so this reports the collision rather than
 * preventing it.
 */
import { computed } from 'vue';
import { Pipette } from '@lucide/vue';
import { TAG_PALETTE, normalizeTagColor } from '../../lib/tagPalette';

const props = withDefaults(defineProps<{
  /** The colour this tag has now. */
  current?: string | null;
  /** Colours held by the *other* tags in the library. */
  taken?: string[];
  tagName?: string;
}>(), { current: null, taken: () => [], tagName: 'tag' });

const emit = defineEmits<{ (e: 'select', color: string): void }>();

const current = computed(() => normalizeTagColor(props.current));

const swatches = computed(() => {
  const taken = new Set(props.taken.map((color) => normalizeTagColor(color)));
  return TAG_PALETTE.map((swatch) => {
    const isCurrent = swatch.hex === current.value;
    const isTaken = !isCurrent && taken.has(swatch.hex);
    return {
      hex: swatch.hex,
      current: isCurrent,
      taken: isTaken,
      title: isCurrent ? `${swatch.label} — current` : isTaken ? `${swatch.label} — in use` : `${swatch.label} — free`,
    };
  });
});

function onCustom(event: Event) {
  emit('select', normalizeTagColor((event.target as HTMLInputElement).value));
}
</script>

<style scoped>
.swatch-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.swatch {
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.swatch.taken {
  opacity: 0.35;
}

.swatch.custom {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed var(--border-default);
  background: var(--surface);
  color: var(--ink-muted);
  position: relative;
  overflow: hidden;
}

/* The native input is the control; the pipette is what it looks like. */
.custom-input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}
</style>
