<template>
  <div class="inline-field" :class="{ 'inline-field--multiline': multiline }">
    <!--
      Resting is text with no box. The button is the whole row so the hit target
      matches what hover draws, rather than a pencil you have to aim at.
    -->
    <button
      v-if="!editing"
      type="button"
      class="inline-field__rest"
      :class="{ 'inline-field__rest--readonly': readonly, 'inline-field__rest--mono': mono, 'inline-field__rest--empty': isEmpty }"
      :disabled="readonly"
      :aria-label="readonly ? label : `Edit ${label}`"
      :data-testid="testId"
      @click="startEditing"
    >
      <span class="inline-field__value">{{ displayValue }}</span>
      <Pencil v-if="!readonly" :size="12" class="inline-field__pencil" aria-hidden="true" />
    </button>

    <template v-else>
      <textarea
        v-if="multiline"
        ref="textareaRef"
        v-model="draft"
        class="inline-field__input inline-field__input--multiline"
        :class="{ 'inline-field__input--invalid': errorMessage }"
        :placeholder="placeholder"
        :aria-label="label"
        :aria-invalid="errorMessage ? 'true' : undefined"
        :data-testid="testId ? `${testId}-input` : undefined"
        rows="3"
        @keydown.esc.prevent="cancel"
      />
      <input
        v-else
        ref="inputRef"
        v-model="draft"
        type="text"
        class="inline-field__input"
        :class="{ 'inline-field__input--invalid': errorMessage, 'inline-field__input--mono': mono }"
        :placeholder="placeholder"
        :aria-label="label"
        :aria-invalid="errorMessage ? 'true' : undefined"
        :data-testid="testId ? `${testId}-input` : undefined"
        @keydown.enter.prevent="commit"
        @keydown.esc.prevent="cancel"
        @blur="commitOnBlur"
      />

      <!--
        Only the multiline field shows buttons. Enter is a newline there, so it
        cannot also be "done", and blur-to-commit in a box you scroll inside is
        how people lose a paragraph.
      -->
      <div v-if="multiline" class="inline-field__actions">
        <button type="button" class="inline-field__action" :disabled="saving" @mousedown.prevent @click="commit">Save</button>
        <button type="button" class="inline-field__action" :disabled="saving" @mousedown.prevent @click="cancel">Cancel</button>
      </div>
    </template>

    <InlineNote
      v-if="errorMessage"
      tone="danger"
      role="alert"
      :data-testid="testId ? `${testId}-error` : undefined"
    >
      {{ errorMessage }}
    </InlineNote>
    <InlineNote v-else-if="hint">{{ hint }}</InlineNote>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { Pencil } from '@lucide/vue';

import InlineNote from '../shared/InlineNote.vue';

/**
 * One field of a record, text at rest and an input on click, committing on its
 * own (backends UI doc §Field interaction).
 *
 * The commit handler is a prop rather than an event because it is asynchronous
 * and its answer matters: it returns an error message, or null for accepted.
 * That is what keeps the previously saved value live until the edit resolves —
 * an event would close the field before the server had said anything.
 */
const props = withDefaults(
  defineProps<{
    modelValue: string | null;
    /** Used for the accessible name; the visible label lives in the parent's grid. */
    label: string;
    commit: (value: string) => Promise<string | null> | string | null;
    placeholder?: string;
    /** Shown when the field is empty and at rest. */
    emptyText?: string;
    hint?: string;
    multiline?: boolean;
    mono?: boolean;
    readonly?: boolean;
    testId?: string;
  }>(),
  { placeholder: '', emptyText: 'Not set', multiline: false, mono: false, readonly: false },
);

const editing = ref(false);
const saving = ref(false);
const draft = ref('');
const errorMessage = ref<string | null>(null);
const inputRef = ref<HTMLInputElement | null>(null);
const textareaRef = ref<HTMLTextAreaElement | null>(null);

const isEmpty = computed(() => !props.modelValue || props.modelValue.trim().length === 0);
const displayValue = computed(() => (isEmpty.value ? props.emptyText : props.modelValue));

async function startEditing() {
  if (props.readonly) return;
  draft.value = props.modelValue ?? '';
  errorMessage.value = null;
  editing.value = true;
  await nextTick();
  const element = props.multiline ? textareaRef.value : inputRef.value;
  element?.focus();
  element?.select?.();
}

function cancel() {
  editing.value = false;
  errorMessage.value = null;
}

async function commit() {
  if (saving.value) return;
  const next = draft.value;
  if (next === (props.modelValue ?? '')) {
    cancel();
    return;
  }
  saving.value = true;
  try {
    const result = await props.commit(next);
    if (result) {
      // Rejected. Stay open with the typed value so it can be fixed, and leave
      // the saved value untouched behind the error.
      errorMessage.value = result;
      await nextTick();
      (props.multiline ? textareaRef.value : inputRef.value)?.focus();
      return;
    }
    editing.value = false;
    errorMessage.value = null;
  } finally {
    saving.value = false;
  }
}

function commitOnBlur() {
  /*
   * Esc closes the field, which unmounts a focused input — and the browser
   * fires blur on the way out. Committing there would save the very edit the
   * user just abandoned, so a blur only commits while the field is still open.
   */
  if (!editing.value) return;
  // A blur while the field is already rejecting would commit nothing and close
  // over the error, so an invalid field holds focus until it resolves.
  if (errorMessage.value) return;
  void commit();
}
</script>

<style scoped>
.inline-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
}

.inline-field__rest {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  width: 100%;
  padding: var(--space-3) var(--space-4);
  border: 1px solid transparent;
  border-radius: var(--radius-panel);
  background: transparent;
  color: var(--ink);
  font-family: inherit;
  font-size: var(--text-body-lg);
  text-align: left;
  cursor: pointer;
}

.inline-field--multiline .inline-field__rest {
  align-items: flex-start;
}

.inline-field__rest:hover:not(:disabled) {
  background: var(--surface-subtle);
  border-color: var(--border-subtle);
}

.inline-field__rest:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring);
  outline-offset: 1px;
}

.inline-field__rest--readonly {
  cursor: default;
}

.inline-field__rest--mono .inline-field__value {
  font-family: var(--font-mono);
  font-size: var(--text-body);
}

.inline-field__rest--empty .inline-field__value {
  color: var(--ink-muted);
}

.inline-field__value {
  flex: 1;
  min-width: 0;
  line-height: var(--leading-normal);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.inline-field__pencil {
  flex-shrink: 0;
  color: transparent;
}

.inline-field__rest:hover .inline-field__pencil,
.inline-field__rest:focus-visible .inline-field__pencil {
  color: var(--border-strong);
}

.inline-field__input {
  width: 100%;
  height: var(--control-h);
  padding: 0 var(--space-4);
  border: 1px solid var(--action);
  border-radius: var(--radius-panel);
  background: var(--surface);
  color: var(--ink);
  font-family: inherit;
  font-size: var(--text-body-lg);
  box-shadow: 0 0 0 3px var(--action-surface);
}

.inline-field__input--mono {
  font-family: var(--font-mono);
  font-size: var(--text-body);
}

.inline-field__input--multiline {
  height: auto;
  padding: var(--space-3) var(--space-4);
  line-height: var(--leading-normal);
  resize: vertical;
}

.inline-field__input:focus {
  outline: none;
}

.inline-field__input--invalid {
  border-color: var(--danger);
  box-shadow: 0 0 0 3px var(--danger-surface);
}

.inline-field__actions {
  display: flex;
  gap: var(--space-3);
}

.inline-field__action {
  height: var(--control-h-sm);
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink-secondary);
  font-family: inherit;
  font-size: var(--text-body);
  cursor: pointer;
}

.inline-field__action:hover:not(:disabled) {
  background: var(--surface-subtle);
}

</style>
