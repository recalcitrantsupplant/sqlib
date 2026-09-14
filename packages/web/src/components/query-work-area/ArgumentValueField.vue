<template>
  <div class="value-field" :class="{ 'value-field--blank': isBlank }">
    <input
      type="text"
      class="value-input"
      data-testid="argument-value"
      :value="value.value"
      :placeholder="placeholder"
      :disabled="disabled"
      @input="setLexical(($event.target as HTMLInputElement).value)"
    />

    <!--
      Term type moves inside the field it types, rather than sitting beside it
      as two more selects per cell. A cell is one control again, and the type
      is on the button that shows it (design §4).
    -->
    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <button
          type="button"
          class="type-button"
          :class="{ 'type-button--literal': value.type === 'literal' }"
          :disabled="disabled"
          :title="`Term type · ?${variable}`"
        >
          {{ typeLabel }}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" class="type-menu">
        <TermTypeMenuItems :value="value" :variable="variable" @update="emit('update', $event)" />
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '../ui/dropdown-menu';
import TermTypeMenuItems from './TermTypeMenuItems.vue';
import type { SparqlValue } from '@/types/argument-sets';
import { isUndef, termPlaceholder, termTypeLabel } from '@/lib/argumentTerms';

/**
 * One cell of a VALUES row: its lexical form and the term type that reads it.
 *
 * Blank is a real value here — it binds UNDEF — so the field renders empty
 * rather than refusing to be empty, and the export drops it (see `pruneUndef`).
 */
const props = defineProps<{
  value: SparqlValue;
  variable: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  update: [value: SparqlValue];
}>();

const isBlank = computed(() => isUndef(props.value));
const typeLabel = computed(() => termTypeLabel(props.value));
const placeholder = computed(() => termPlaceholder(props.value));

function setLexical(next: string) {
  emit('update', { ...props.value, value: next });
}
</script>

<style scoped>
.value-field {
  display: flex;
  align-items: stretch;
  min-width: 0;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  overflow: hidden;
}

.value-field:focus-within {
  border-color: var(--action);
}

.value-input {
  flex: 1;
  min-width: 0;
  height: 24px;
  padding: var(--space-1) var(--space-3);
  border: none;
  background: transparent;
  color: var(--ink-secondary);
  font-family: var(--font-mono);
  font-size: var(--text-body);
}

.value-input:focus {
  outline: none;
}

.value-input:disabled {
  cursor: not-allowed;
}

/* Blank means UNDEF, and UNDEF should look deliberate rather than unfinished. */
.value-field--blank {
  border-style: dashed;
}

.type-button {
  flex-shrink: 0;
  min-width: 34px;
  padding: 0 var(--space-3);
  border: none;
  border-left: 1px solid var(--border-subtle);
  background: var(--surface-subtle);
  color: var(--ink-muted);
  font-family: inherit;
  font-size: var(--text-micro);
  cursor: pointer;
}

.type-button:hover:not(:disabled) {
  background: var(--surface-raised);
  color: var(--ink);
}

.type-button--literal {
  color: var(--violet-500);
}

.type-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.type-menu {
  min-width: 190px;
}
</style>
