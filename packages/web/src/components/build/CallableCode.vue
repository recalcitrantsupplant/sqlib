<template>
  <div class="code">
    <div class="toolbar">
      <div class="language-tabs">
        <button
          v-for="language in SNIPPET_LANGUAGES"
          :key="language.id"
          type="button"
          class="language-tab"
          :class="{ active: language.id === active }"
          @click="active = language.id"
        >
          {{ language.label }}
        </button>
      </div>

      <!--
        The snippet is correct; the endpoint is not live yet. Saying so is the
        difference between a caller copying a working call and copying one that
        404s until someone saves.
      -->
      <StatusBadge
        v-if="callable.state === 'draft'"
        status="stale"
        :dot="false"
        data-testid="callable-draft-warning"
      >
        draft — save to call this
      </StatusBadge>

      <button type="button" class="copy-button" @click="copy">
        <Check v-if="copied" :size="11" />
        <Copy v-else :size="11" />
        {{ copied ? 'Copied' : 'Copy' }}
      </button>
    </div>

    <pre class="snippet">{{ snippet }}</pre>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { Copy, Check } from '@lucide/vue';
import {
  SNIPPET_LANGUAGES,
  renderSnippet,
  type SnippetLanguage,
} from '@/lib/codeSnippets';
import { inputVariableNames, type Callable } from '../../lib/callables';
import StatusBadge from '../shared/StatusBadge.vue';

const props = defineProps<{
  callable: Callable;
  endpoint: string;
}>();

const active = ref<SnippetLanguage>('curl');
const copied = ref(false);

/*
 * The example body carries the callable's real input variables, so the snippet
 * is something a caller can run rather than something they have to translate.
 * Values are placeholders — there is nowhere to get real ones from.
 */
const argumentEntries = computed(() =>
  inputVariableNames(props.callable).map((name) => [name, `<${name}>`] as const)
);

const bodyObject = computed(() => ({
  targetId: props.callable.id,
  ...(argumentEntries.value.length
    ? { arguments: Object.fromEntries(argumentEntries.value) }
    : {}),
}));

const snippet = computed(() =>
  renderSnippet(active.value, {
    method: 'POST',
    url: props.endpoint,
    body: bodyObject.value,
  }),
);

async function copy() {
  try {
    await navigator.clipboard.writeText(snippet.value);
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 1500);
  } catch {
    // Clipboard access can be denied; the snippet is on screen and selectable,
    // so failing quietly beats an error toast for something the user can see.
  }
}
</script>

<style scoped>
.code {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.language-tabs {
  display: inline-flex;
  overflow: hidden;
  height: 25px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
}

.language-tab {
  padding: 0 var(--space-4);
  border: none;
  border-left: 1px solid var(--border-default);
  background: var(--surface);
  font-family: inherit;
  font-size: var(--text-label);
  color: var(--ink-muted);
  cursor: pointer;
}

.language-tab:first-child {
  border-left: none;
}

.language-tab.active {
  background: var(--segment-selected);
  font-weight: var(--weight-semibold);
  color: var(--segment-selected-ink);
}

.copy-button {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  height: 25px;
  margin-left: auto;
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface);
  font-family: inherit;
  font-size: var(--text-label);
  color: var(--ink-secondary);
  cursor: pointer;
}

.snippet {
  margin: 0;
  overflow: auto;
  padding: var(--space-5);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-panel);
  background: var(--surface);
  font-family: var(--font-mono);
  font-size: var(--text-label);
  line-height: var(--leading-normal);
  color: var(--ink);
}
</style>
