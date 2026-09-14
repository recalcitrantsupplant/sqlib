<template>
  <span
    class="status-badge"
    :class="[`status-badge--${tone}`, `status-badge--${size}`, { 'status-badge--running': status === 'running' }]"
    :title="title"
  >
    <span v-if="dot" class="status-badge__dot" aria-hidden="true" />
    <slot>{{ defaultLabel }}</slot>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';

/**
 * The state pill, rendered against the --state-* tokens so every surface says
 * "invalid" in the same red.
 *
 * Two ways in, and they are not alternatives to each other:
 *
 * - `status` is the app's own five-word state vocabulary. It carries a default
 *   label and, for `running`, the pulsing dot.
 * - `tone` is the paint alone, named after the token family it uses, for a
 *   screen whose words are its own — a backend is "Unreachable", not
 *   "Invalid". It says nothing about what the badge means, which is the point:
 *   the shared thing across those screens is the triple, not the word.
 */
const props = withDefaults(
  defineProps<{
    status?: 'valid' | 'invalid' | 'stale' | 'running' | 'idle';
    tone?: 'success' | 'warning' | 'danger' | 'action' | 'neutral';
    /** `xs` is the dense step: a badge inside a table row or a header line. */
    size?: 'sm' | 'xs';
    /** Show the leading status dot. */
    dot?: boolean;
    title?: string;
  }>(),
  { status: undefined, tone: undefined, size: 'sm', dot: true, title: undefined },
);

const LABELS: Record<string, string> = {
  valid: 'Valid',
  invalid: 'Invalid',
  stale: 'Stale',
  running: 'Running',
  idle: 'Idle',
};

/**
 * The five states are five of the tones under the app's own names, so the
 * paint is keyed on the tone and a status resolves to one. `running` keeps its
 * pulse through a class of its own rather than through `--action`: a version
 * number tinted from the action family is the interesting value, not a thing
 * that is running, and it must not throb.
 */
const TONE_OF: Record<string, string> = {
  valid: 'success',
  invalid: 'danger',
  stale: 'warning',
  running: 'action',
  idle: 'neutral',
};

const tone = computed(() => props.tone ?? (props.status ? TONE_OF[props.status] : 'neutral'));

const defaultLabel = computed(() => (props.status ? (LABELS[props.status] ?? props.status) : ''));
</script>

<style scoped>
.status-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  border: 1px solid transparent;
  border-radius: var(--radius-full);
  font-weight: var(--weight-semibold);
  white-space: nowrap;
  flex-shrink: 0;
}

.status-badge--sm {
  height: var(--control-h-sm);
  padding: var(--space-1) var(--space-4);
  font-size: var(--text-label);
}

/*
 * The dense step. 18px is where the four hand-written pills this size exists
 * for already sat (18, 18, 19 and 20px), and it is the height a badge can take
 * inside a 28px table row or a header line without setting the row's height
 * itself.
 */
.status-badge--xs {
  height: 18px;
  padding: 0 var(--space-3);
  font-size: var(--text-micro);
}

.status-badge__dot {
  width: var(--space-3);
  height: var(--space-3);
  border-radius: var(--radius-full);
  background: currentcolor;
  flex-shrink: 0;
}

.status-badge--success {
  background: var(--success-surface);
  border-color: var(--success-border);
  color: var(--success-ink);
}

.status-badge--danger {
  background: var(--danger-surface);
  border-color: var(--danger-border);
  color: var(--danger-ink);
}

.status-badge--warning {
  background: var(--warning-surface);
  border-color: var(--warning-border);
  color: var(--warning-ink);
}

.status-badge--action {
  background: var(--action-surface);
  border-color: var(--action-border);
  color: var(--action-ink);
}

.status-badge--running .status-badge__dot {
  animation: status-pulse 1.2s ease-in-out infinite;
}

.status-badge--neutral {
  background: var(--surface-raised);
  border-color: var(--border-subtle);
  color: var(--ink-muted);
}

@keyframes status-pulse {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.3;
  }
}

@media (prefers-reduced-motion: reduce) {
  .status-badge--running .status-badge__dot {
    animation: none;
  }
}
</style>
