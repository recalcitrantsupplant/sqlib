<template>
  <div class="segmented" :class="`is-${size}`" role="group" :aria-label="groupLabel">
    <button
      v-for="option in options"
      :key="String(option.value)"
      type="button"
      class="segment"
      :class="{ on: option.value === modelValue }"
      :disabled="disabled || option.disabled"
      :title="option.title"
      :data-testid="option.testId"
      :aria-pressed="option.value === modelValue"
      @click="$emit('update:modelValue', option.value)"
    >
      {{ option.label }}
    </button>
  </div>
</template>

<script setup lang="ts">
/**
 * A small set of mutually exclusive choices, shown as one control.
 *
 * There were four of these, hand-drawn in four files, and they had already
 * drifted: 24px in `BackendWorkArea`, 26px in `build.vue`, `--control-h-sm`
 * elsewhere; `--radius` against `--radius-sm`; `--text-body` against
 * `--text-label`. All four referenced tokens, so no *value* was wrong — which
 * is the point worth recording, because token discipline stops colours drifting
 * and does nothing about specs drifting. That is what a shared definition is
 * for. See docs/reference/ui-design-tokens.md §5.
 *
 * The canonical spec here is the 28px-grid one: `--control-h-sm`,
 * `--radius-sm`, `--text-label`.
 *
 * `size` is the one thing a caller may vary, and it is a step on that grid
 * rather than a new spec: `sm` (22px) for a control among in-table chrome,
 * `default` (28px) for one standing in a toolbar with full-height controls
 * beside it, where 22px reads as a mistake. Everything else — radius, type,
 * the selected fill — is the same control at both sizes.
 *
 * Use it where the options are few, fixed, and worth reading at a glance — a
 * `<select>` is right as soon as they are many or open-ended.
 */
export interface SegmentedOption {
  value: string;
  label: string;
  /** Greyed rather than absent: the choice exists but is unavailable *now*. */
  disabled?: boolean;
  title?: string;
  testId?: string;
}

withDefaults(defineProps<{
  modelValue: string;
  /** `readonly` so a caller can declare its options `as const` and keep the literal types. */
  options: readonly SegmentedOption[];
  /**
   * Names the group for a screen reader.
   *
   * Not `ariaLabel`: a prop by that name is shadowed by the native `aria-label`
   * attribute, which a template binds as a fallthrough attr instead — it
   * renders correctly and type-checks as a missing required prop, which is a
   * confusing half-hour for whoever hits it next.
   */
  groupLabel: string;
  /** Locks the whole control — a choice that is settled rather than unavailable. */
  disabled?: boolean;
  /** Which step of the control grid this sits on. See the note above. */
  size?: 'sm' | 'default';
}>(), { size: 'sm' });

defineEmits<{ (e: 'update:modelValue', value: string): void }>();
</script>

<style scoped>
.segmented {
  display: inline-flex;
  flex-shrink: 0;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.segment {
  height: var(--control-h-sm);
  padding: 0 var(--space-4);
  border: none;
  background: var(--surface);
  color: var(--ink-muted);
  font-family: inherit;
  font-size: var(--text-label);
  white-space: nowrap;
  cursor: pointer;
}

.is-default .segment {
  height: var(--control-h);
}

.segment + .segment {
  border-left: 1px solid var(--border-default);
}

.segment.on {
  /* The named role, not raw ink — see tokens.css `--segment-selected`. */
  background: var(--segment-selected);
  color: var(--segment-selected-ink);
  font-weight: var(--weight-semibold);
}

.segment:disabled {
  cursor: default;
  opacity: 0.5;
}
</style>
