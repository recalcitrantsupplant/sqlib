<template>
  <!--
    One line under a picker. The label says what the default is; the actions
    change it. Absent when there is nothing to say and nothing to do.
  -->
  <div v-if="isDefault || hasDefault || canSet" class="browser-default" data-testid="browser-default">
    <span
      v-if="isDefault"
      class="badge"
      :title="BROWSER_DEFAULT_HINT"
      data-testid="browser-default-badge"
    >Browser default</span>
    <span
      v-else-if="hasDefault"
      class="note"
      :title="BROWSER_DEFAULT_HINT"
      data-testid="browser-default-differs"
    >Not the browser default</span>

    <template v-if="canWrite">
      <button
        v-if="!isDefault && canSet"
        type="button"
        class="link-button"
        :title="BROWSER_DEFAULT_HINT"
        :disabled="busy"
        data-testid="browser-default-set"
        @click="emit('set')"
      >Set as browser default</button>
      <button
        v-if="hasDefault"
        type="button"
        class="link-button"
        :disabled="busy"
        data-testid="browser-default-clear"
        @click="emit('clear')"
      >Clear browser default</button>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * The "Browser default" label and its two actions, for any picker.
 *
 * Stateless: the screen says whether the current pick is the default, whether
 * there is one at all, and whether the current pick could be saved as one (a
 * scratch argument set cannot: it has no server id). The actions need write
 * access, so a read-only deployment shows the label and nothing else.
 */
import { computed } from 'vue';
import { useDeploymentMode } from '../../composables/useDeploymentMode';
import { BROWSER_DEFAULT_HINT } from '../../composables/useBrowserDefaults';

defineProps<{
  /** The current pick is the default. */
  isDefault: boolean;
  /** The entity has a default, whatever is picked now. */
  hasDefault: boolean;
  /** The current pick can be saved as the default. */
  canSet: boolean;
  busy?: boolean;
}>();

const emit = defineEmits<{
  (e: 'set'): void;
  (e: 'clear'): void;
}>();

const deployment = useDeploymentMode();
const canWrite = computed(() => !deployment.isReadOnly.value);
</script>

<style scoped>
.browser-default {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  font-size: var(--text-label);
}

.badge {
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-full);
  color: var(--ink-secondary);
}

.note {
  color: var(--ink-muted);
}

.link-button {
  padding: 0;
  border: none;
  background: none;
  color: var(--action);
  font-family: inherit;
  font-size: var(--text-label);
  cursor: pointer;
}

.link-button:hover:not(:disabled) {
  text-decoration: underline;
}

.link-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
