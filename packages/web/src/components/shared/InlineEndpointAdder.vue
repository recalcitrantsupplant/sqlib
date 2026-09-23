<script setup lang="ts">
/**
 * Paste a SPARQL endpoint into the picker and run against it.
 *
 * The shortest path from "I have an endpoint URL" to "I have results" used to
 * be: leave the query, open Backends, start a draft, name it, paste, create,
 * come back, pick it. Every step but the paste is ceremony — and on a
 * read-only deployment the whole detour exists only because the picker had no
 * way to take a URL. This is that way: one row at the foot of the dropdown,
 * which opens into a field, and Enter both registers and selects the endpoint.
 *
 * What it registers is a **browser backend** (`useBrowserBackends`): stored in
 * this browser, never posted to the server, and so available whatever the
 * deployment's mode. Its name is the URL it was pasted from, because asking
 * for one is the ceremony this removes. Naming it properly is a second,
 * optional edit from the row itself (`BrowserBackendName`).
 *
 * Not a `SelectItem`. It is a plain row inside the menu, and it stops its own
 * keyboard and pointer events, because a Select's typeahead treats keystrokes
 * as a jump-to-item search: unstopped, typing a URL here would send the
 * highlight wandering and the first space would choose whatever it landed on.
 */
import { computed, nextTick, ref } from 'vue';
import { Plus } from '@lucide/vue';
import { useBackendsStore } from '@/composables/useBackendsStore';
import { useBrowserBackends } from '@/composables/useBrowserBackends';
import { endpointDisplayName, validateEndpoint } from '@/lib/endpointUrl';

const emit = defineEmits<{
  /** A backend now exists for this URL, and the caller should select it. */
  (e: 'added', backendId: string): void;
}>();

const browserBackends = useBrowserBackends();
const backendsStore = useBackendsStore();

const open = ref(false);
const draft = ref('');
const inputEl = ref<HTMLInputElement | null>(null);

/** Silent until there is something to complain about. */
const error = computed(() => (draft.value.trim() ? validateEndpoint(draft.value) : null));
const canSubmit = computed(() => draft.value.trim().length > 0 && error.value === null);

async function start() {
  open.value = true;
  draft.value = '';
  await nextTick();
  inputEl.value?.focus();
}

function cancel() {
  open.value = false;
  draft.value = '';
}

function submit() {
  if (!canSubmit.value) return;
  /*
   * The name is the URL without its scheme — see `endpointDisplayName`. The
   * list refresh is what puts the new row in the picker the caller is about to
   * select from.
   */
  const endpoint = draft.value.trim();
  const record = browserBackends.save({
    name: endpointDisplayName(endpoint),
    description: null,
    endpoint,
    queryMethod: null,
    headers: {},
  });
  void backendsStore.loadBackends();
  open.value = false;
  draft.value = '';
  emit('added', record.id);
}
</script>

<template>
  <div class="endpoint-adder" @keydown.stop @pointerdown.stop>
    <button
      v-if="!open"
      type="button"
      class="adder-trigger"
      data-testid="run-bar-add-endpoint"
      @click="start"
    >
      <Plus :size="12" />SPARQL endpoint…
    </button>

    <div v-else class="adder-field">
      <input
        ref="inputEl"
        v-model="draft"
        type="url"
        class="adder-input"
        placeholder="https://query.wikidata.org/sparql"
        spellcheck="false"
        autocomplete="off"
        data-testid="run-bar-endpoint-input"
        :aria-invalid="error !== null"
        aria-label="SPARQL endpoint URL"
        @keydown.enter.prevent="submit"
        @keydown.esc.prevent="cancel"
        @blur="draft.trim() ? undefined : cancel()"
      >
      <p v-if="error" class="adder-error" data-testid="run-bar-endpoint-error">{{ error }}</p>
    </div>
  </div>
</template>

<style scoped>
.endpoint-adder {
  padding: var(--space-1) var(--space-2);
  border-top: 1px solid var(--border-default);
  margin-top: var(--space-1);
}

.adder-trigger {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-2) var(--space-3);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--action);
  font-family: inherit;
  font-size: var(--text-body);
  text-align: left;
  cursor: pointer;
}

.adder-trigger:hover {
  background: var(--surface-subtle);
}

.adder-field {
  padding: var(--space-1) var(--space-2);
}

.adder-input {
  width: 100%;
  height: 28px;
  padding: 0 var(--space-3);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: transparent;
  font-family: var(--font-mono);
  font-size: var(--text-micro);
  color: inherit;
}

.adder-input:focus-visible {
  outline: 2px solid var(--action);
  outline-offset: -1px;
}

.adder-input[aria-invalid="true"] {
  border-color: var(--danger);
}

.adder-error {
  margin: var(--space-1) 0 0;
  font-size: var(--text-micro);
  color: var(--danger);
}
</style>
