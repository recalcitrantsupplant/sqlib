<template>
  <Dialog v-model:open="isOpen">
    <DialogContent class="env-dialog p-0 gap-0" :show-close-button="false">
      <DialogTitleBar :title="editing ? `Edit ${editing.name}` : 'Add environment'" @close="isOpen = false" />
      <form class="env-form" data-testid="environment-form" @submit.prevent="submit">
        <label class="field">
          <span class="field-label">Name</span>
          <input
            v-model="name"
            class="field-input"
            :class="{ invalid: !!nameProblem }"
            data-testid="environment-name"
            autocomplete="off"
            required
          />
          <span v-if="nameProblem" class="field-error">{{ nameProblem }}</span>
        </label>

        <label v-if="!editing && environments.length > 0" class="field">
          <span class="field-label">After</span>
          <select v-model="after" class="field-input" data-testid="environment-after">
            <option value="">latest</option>
            <option v-for="env in environments" :key="env.id" :value="env.id">{{ env.name }}</option>
          </select>
        </label>

        <label class="field">
          <span class="field-label">Backend</span>
          <select v-model="backend" class="field-input" data-testid="environment-backend" title="Suggested to the run bar in this environment">
            <option value="">None</option>
            <option v-for="b in backends" :key="b.id" :value="b.id">{{ b.name }}</option>
          </select>
        </label>

        <div v-if="!editing" class="field">
          <span class="field-label">Start with</span>
          <SegmentedToggle
            v-model="startFrom"
            :options="startOptions"
            group-label="Start with"
            size="default"
          />
        </div>

        <p v-if="error" class="form-error" data-testid="environment-error">{{ error }}</p>

        <div class="form-actions">
          <button type="button" class="btn-compact" @click="isOpen = false">Cancel</button>
          <button type="submit" class="btn-compact btn-primary" :disabled="busy || !!nameProblem || !name.trim()" data-testid="environment-submit">
            {{ editing ? 'Save' : 'Add environment' }}
          </button>
        </div>
      </form>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
/**
 * Add an environment to the chain, or edit one: name, backend, and for a new
 * one where it goes and which pointers it starts with.
 */
import { computed, ref, watch } from 'vue';
import type { Backend, Environment } from '@sparql-query-lib/contracts';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import DialogTitleBar from '@/components/shared/DialogTitleBar.vue';
import SegmentedToggle from '@/components/shared/SegmentedToggle.vue';
import { LATEST_ENVIRONMENT } from '@/composables/useActiveEnvironment';

const props = defineProps<{
  open: boolean;
  environments: readonly Environment[];
  backends: readonly Backend[];
  /** The environment to edit; null adds one. */
  editing: Environment | null;
  busy?: boolean;
  error?: string | null;
}>();

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
  (e: 'submit', value: { name: string; defaultBackend: string | null; after: string | null; startFrom: string }): void;
}>();

const isOpen = computed({
  get: () => props.open,
  set: (value) => emit('update:open', value),
});

const name = ref('');
const backend = ref('');
const after = ref('');
const startFrom = ref('latest');

watch(() => props.open, (open) => {
  if (!open) return;
  name.value = props.editing?.name ?? '';
  backend.value = props.editing?.defaultBackend ?? '';
  after.value = props.environments[props.environments.length - 1]?.id ?? '';
  startFrom.value = 'latest';
}, { immediate: true });

const startOptions = computed(() => {
  const source = props.environments.find((env) => env.id === after.value);
  return [
    { value: 'latest', label: 'Current versions', title: 'The current version of everything', testId: 'environment-start-latest' },
    ...(source ? [{ value: source.id, label: `Copy ${source.name}`, testId: 'environment-start-copy' }] : []),
    { value: 'empty', label: 'Empty', testId: 'environment-start-empty' },
  ];
});

watch(after, () => {
  if (startFrom.value !== 'latest' && startFrom.value !== 'empty') startFrom.value = after.value || 'latest';
});

const nameProblem = computed(() => {
  const value = name.value.trim();
  if (!value) return null;
  if (value === LATEST_ENVIRONMENT) return `"${LATEST_ENVIRONMENT}" is reserved. Choose another name.`;
  const clash = props.environments.some((env) => env.name === value && env.id !== props.editing?.id);
  return clash ? `${value} already exists. Choose another name.` : null;
});

function submit() {
  if (nameProblem.value || !name.value.trim()) return;
  emit('submit', {
    name: name.value.trim(),
    defaultBackend: backend.value || null,
    after: after.value || null,
    startFrom: startFrom.value,
  });
}
</script>

<style scoped>
.env-dialog {
  max-width: 420px;
}

.env-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  padding: var(--space-6);
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.field-label {
  color: var(--ink-secondary);
  font-size: var(--text-label);
  font-weight: var(--weight-semibold);
}

.field-input {
  height: var(--control-h);
  padding: 0 var(--space-3);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink);
  font: inherit;
  font-size: var(--text-body);
}

.field-input.invalid {
  border-color: var(--danger-border);
}

.field-error,
.form-error {
  margin: 0;
  color: var(--danger-ink);
  font-size: var(--text-label);
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-3);
}
</style>
