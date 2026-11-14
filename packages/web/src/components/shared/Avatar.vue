<template>
  <span class="avatar" :class="[`avatar--${size}`, `avatar--${tone}`]" aria-hidden="true">
    <User v-if="tone === 'guest' || !initials" :size="size === 'lg' ? 18 : size === 'sm' ? 12 : 14" />
    <template v-else>{{ initials }}</template>
  </span>
</template>

<script setup lang="ts">
/**
 * A person's initials in a circle, or a person glyph when there are none.
 *
 * Decorative: whatever names the person — the button it sits in, the text
 * beside it — carries the accessible name, so the circle is hidden from
 * assistive technology.
 */
import { User } from '@lucide/vue';

withDefaults(
  defineProps<{
    initials?: string;
    /** `sm` sits in a line of text or a list row; `md` is a control's height; `lg` heads a menu or a page. */
    size?: 'sm' | 'md' | 'lg';
    /**
     * `warning` rings a lapsed session; `guest` is a visitor with no account;
     * `unknown` is a person this server has no name for.
     */
    tone?: 'default' | 'warning' | 'guest' | 'unknown';
  }>(),
  { initials: '', size: 'md', tone: 'default' },
);
</script>

<style scoped>
.avatar {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-full);
  background: var(--action-surface);
  color: var(--action-ink);
  font-weight: var(--weight-semibold);
  line-height: 1;
  user-select: none;
}

.avatar--sm {
  width: var(--control-h-sm);
  height: var(--control-h-sm);
  font-size: var(--text-micro);
}

.avatar--md {
  width: var(--control-h);
  height: var(--control-h);
  font-size: var(--text-label);
}

.avatar--lg {
  width: calc(var(--control-h-lg) + var(--space-3));
  height: calc(var(--control-h-lg) + var(--space-3));
  font-size: var(--text-body-lg);
}

.avatar--warning {
  background: var(--warning-surface);
  color: var(--warning-ink);
  box-shadow: 0 0 0 var(--focus-ring-width) var(--warning);
}

.avatar--unknown {
  background: var(--surface-subtle);
  color: var(--ink-muted);
  box-shadow: inset 0 0 0 1px var(--border-default);
}

.avatar--guest {
  background: var(--surface-raised);
  color: var(--ink-secondary);
}
</style>
