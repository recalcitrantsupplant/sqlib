<template>
  <component :is="as" class="section-label" :class="`section-label--${size}`">
    <slot />
    <span v-if="count !== undefined" class="section-label__count">{{ count }}</span>
  </component>
</template>

<script setup lang="ts">
/**
 * The uppercase label that heads a group of controls or a panel section.
 *
 * Consolidates eight independent `.section-title` definitions that had drifted
 * to three different font sizes (11px, 13px, 14px) and two weights.
 * See docs/reference/ui-design-tokens.md.
 */
withDefaults(
  defineProps<{
    /** Element to render as. Use a heading tag where it genuinely heads a section. */
    as?: string;
    /**
     * Canonical label specs. These match the three clusters the codemod
     * collapsed 54 drifted combinations onto — see
     * scripts/codemod-section-labels.mjs.
     */
    size?: 'sm' | 'md' | 'lg';
    /** Optional trailing count, e.g. the number of items in the section. */
    count?: number;
  }>(),
  { as: 'div', size: 'sm' },
);
</script>

<style scoped>
.section-label {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  font-weight: var(--weight-semibold);
  text-transform: uppercase;
  color: var(--ink-muted);
  white-space: nowrap;
  margin: 0;
}

.section-label--sm {
  font-size: var(--text-label);
  letter-spacing: 0.02em;
}

.section-label--md {
  font-size: var(--text-body);
  letter-spacing: 0.03em;
}

.section-label--lg {
  font-size: var(--text-body-lg);
  letter-spacing: 0.025em;
  color: var(--ink-secondary);
}

.section-label__count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: var(--space-6);
  padding: 0 var(--space-2);
  border-radius: var(--radius-full);
  background: var(--surface-raised);
  color: var(--ink-muted);
  font-size: var(--text-micro);
  font-weight: var(--weight-semibold);
  letter-spacing: 0;
}
</style>
