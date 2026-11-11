<template>
  <span v-if="available" class="copy-token" data-testid="copy-token">
    <span
      v-if="expiresLabel"
      class="expiry"
      :title="`The copied token expires at ${expiresLabel}`"
      data-testid="copy-token-expiry"
    >
      <Clock :size="12" aria-hidden="true" />{{ expiresLabel }}
    </span>
    <button
      type="button"
      class="copy-token-button"
      :class="{ done: justCopied }"
      :title="`Copies export ${TOKEN_ENV}=… for your terminal`"
      data-testid="copy-token-button"
      @click="copyToken"
    >
      <Check v-if="justCopied" :size="12" aria-hidden="true" />
      <KeyRound v-else :size="12" aria-hidden="true" />
      {{ justCopied ? 'Token copied' : 'Copy token' }}
    </button>
  </span>
</template>

<script setup lang="ts">
/**
 * Beside a snippet's Copy button: copies the signed-in person's token as an
 * `export` line, so the snippet runs as pasted. Absent when nobody is signed
 * in, because there is then no token to copy.
 */
import { Check, Clock, KeyRound } from '@lucide/vue';
import { TOKEN_ENV } from '@/lib/codeSnippets';
import { useApiTokenCopy } from '@/composables/useApiTokenCopy';

const { available, justCopied, expiresLabel, copyToken } = useApiTokenCopy();
</script>

<style scoped>
.copy-token {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
}

.expiry {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0 var(--space-3);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-full);
  background: var(--surface-subtle);
  font-size: var(--text-micro);
  color: var(--ink-secondary);
  white-space: nowrap;
}

.copy-token-button {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface);
  font-family: inherit;
  font-size: var(--text-label);
  color: var(--ink-secondary);
  cursor: pointer;
  white-space: nowrap;
}

.copy-token-button.done {
  border-color: var(--success-border);
  background: var(--success-surface);
  color: var(--success-ink);
}
</style>
