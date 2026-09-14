<template>
  <section class="chat-rail">
    <header class="pane-header">
      <span class="session-name">{{ session.name }}</span>
      <StatusBadge
        size="xs"
        :dot="false"
        :tone="connected ? 'success' : 'neutral'"
        data-testid="assistant-status"
      >
        <Plug :size="10" />{{ connected ? modelLabel : 'Not configured' }}
      </StatusBadge>
      <div class="header-actions">
        <button
          type="button"
          class="icon-button"
          :class="{ active: showSettings }"
          title="Model provider"
          aria-label="Model provider"
          data-testid="provider-toggle"
          @click="showSettings = !showSettings"
        >
          <Settings :size="13" />
        </button>
        <button type="button" class="icon-button" title="New session" @click="newSession">
          <Plus :size="13" />
        </button>
      </div>
    </header>

    <!--
      BYO key, held in this browser. The server deliberately does not hold one
      — there is no account to attach it to until auth lands — so the panel
      says where the key lives rather than leaving it to be guessed.
    -->
    <div v-if="showSettings" class="provider-panel" data-testid="provider-panel">
      <label class="field">
        <span class="field-label">Provider</span>
        <select
          class="field-input"
          data-testid="provider-select"
          :value="settings.provider"
          @change="setProvider(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="entry in providers" :key="entry.id" :value="entry.id">{{ entry.label }}</option>
        </select>
      </label>

      <div class="field-group">
        <label class="field">
          <span class="field-label">Model</span>
          <!--
            A list, not a closed set. The catalogue is fetched live because a
            hardcoded one is stale within a month, and the input stays typeable
            because a model saved this morning is in no list yet.
          -->
          <input
            v-model="settings.model"
            class="field-input"
            data-testid="provider-model"
            placeholder="Model id"
            list="assistant-model-options"
            autocomplete="off"
          />
          <datalist id="assistant-model-options">
            <option v-for="model in models" :key="model.id" :value="model.id">{{ modelSummary(model) }}</option>
          </datalist>
        </label>

        <InlineNote size="xs" class="field-hint" data-testid="provider-models-hint">
          <span v-if="modelsLoading">Loading models…</span>
          <span v-else-if="modelsError" class="field-hint-error">{{ modelsError }}</span>
          <template v-else-if="models.length">
            <span v-if="selectedModel">{{ modelSummary(selectedModel) }} · </span>
            <button
              type="button"
              class="field-hint-button"
              data-testid="provider-models-refresh"
              @click="refreshModels"
            >
              {{ models.length }} models
            </button>
          </template>
        </InlineNote>
      </div>

      <label v-if="settings.provider === 'openai-compatible'" class="field">
        <span class="field-label">Base URL</span>
        <input v-model="settings.baseUrl" class="field-input" data-testid="provider-base-url" placeholder="http://localhost:11434/v1" />
      </label>

      <label v-else class="field">
        <span class="field-label">API key</span>
        <input
          v-model="settings.apiKey"
          type="password"
          class="field-input"
          data-testid="provider-key"
          :placeholder="keyPlaceholder"
          autocomplete="off"
        />
      </label>

      <InlineNote size="xs">
        Kept in this browser and sent to your own sqlib server with each turn. It is never stored
        server-side.
      </InlineNote>
    </div>

    <div class="chat-body">
      <div v-if="session.turns.length === 0" class="chat-empty">
        <p class="chat-empty-title">Describe what your app needs to read.</p>
        <p class="chat-empty-body">
          It reads your library, writes queries as drafts beside you, and runs them to check they
          work. It cannot save — that stays your click.
        </p>
      </div>

      <template v-for="(turn, index) in session.turns" :key="index">
        <div v-if="turn.role === 'user'" class="user-turn">
          <div class="bubble">{{ turn.text }}</div>
        </div>

        <!--
          Assistant turns are plain text on the panel background rather than a
          bubble, so a longer explanation reads as prose instead of as a very
          large speech balloon.
        -->
        <div v-else class="assistant-turn">
          <p v-if="turn.text" class="assistant-text">{{ turn.text }}</p>
          <AssistantToolReceipt
            v-for="(receipt, receiptIndex) in turn.receipts ?? []"
            :key="receiptIndex"
            :receipt="receipt"
          />
        </div>
      </template>
    </div>

    <div class="composer">
      <div class="composer-box">
        <textarea
          v-model="draftMessage"
          class="composer-input"
          rows="2"
          :placeholder="placeholder"
          :disabled="!connected || sending"
          aria-label="Message the assistant"
          data-testid="composer-input"
          @keydown.enter.exact.prevent="submit"
        />
        <div class="composer-actions">
          <span class="backend-chip">
            <Database :size="11" />{{ libraryName ?? 'No library' }}
          </span>
          <button type="button" class="attach" disabled title="Attach schema or ontology context">
            <Paperclip :size="11" />Schema
          </button>
          <button
            v-if="sending"
            type="button"
            class="send stop"
            title="Stop"
            aria-label="Stop"
            data-testid="assistant-stop"
            @click="interrupt"
          >
            <Square :size="12" />
          </button>
          <button
            v-else
            type="button"
            class="send"
            :disabled="!connected || draftMessage.trim().length === 0"
            title="Send"
            aria-label="Send"
            data-testid="assistant-send"
            @click="submit"
          >
            <ArrowUp :size="14" />
          </button>
        </div>
      </div>
      <!--
        Saying it plainly beats a composer that looks live and silently does
        nothing.
      -->
      <p v-if="!connected" class="not-connected" data-testid="assistant-unconfigured">
        Choose a model provider to start — the assistant calls it with your own key.
      </p>
      <p v-if="lastError" class="assistant-error" data-testid="assistant-error">{{ lastError }}</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
// @ts-ignore - Nuxt auto-import
import { useRuntimeConfig } from '#imports';
import { Plug, Settings, Plus, Database, Paperclip, ArrowUp, Square } from '@lucide/vue';
import AssistantToolReceipt from './AssistantToolReceipt.vue';
import InlineNote from '../shared/InlineNote.vue';
import StatusBadge from '../shared/StatusBadge.vue';
import { useAssistantSession } from '../../composables/useAssistantSession';
import { useAssistantProvider, ASSISTANT_PROVIDERS } from '../../composables/useAssistantProvider';
import { useLibraryRefresh } from '../../composables/useLibraryRefresh';
import { useAssistantTools } from '../../composables/useAssistantTools';
import type { ScreenContext } from '../../lib/assistantScreenContext';

const props = defineProps<{
  libraryName: string | null;
  libraryId?: string | null;
  /**
   * What the screen behind this rail is showing, sent with each turn so the
   * assistant does not have to spend calls finding it out (#128 item 2). The
   * parent owns it because the parent is what knows; a rail that guessed would
   * be describing itself.
   */
  screenContext?: ScreenContext | null;
}>();

const { session, connected, sending, lastError, newSession, send, interrupt } = useAssistantSession();

// Once per page: receipts arrive mid-turn and should already have their wording.
const assistantTools = useAssistantTools();
onMounted(() => assistantTools.load());
const { settings, setProvider, isConfigured, models, modelsLoading, modelsError, loadModels } =
  useAssistantProvider();
const { refreshEntities } = useLibraryRefresh();

const providers = ASSISTANT_PROVIDERS;
const draftMessage = ref('');
// Open by default until a provider is set, because a composer you cannot use
// with no visible reason is the worst of the available first impressions.
const showSettings = ref(!isConfigured.value);

const modelLabel = computed(() => settings.value.model || settings.value.provider);

// Providers prefix their keys differently, and a field that shows the wrong
// prefix reads as "you pasted the wrong key" when nothing is wrong.
const keyPlaceholder = computed(() => (settings.value.provider === 'groq' ? 'gsk_…' : 'sk-…'));

const selectedModel = computed(() => models.value.find((entry) => entry.id === settings.value.model.trim()));

/**
 * What is worth saying about a model beside its id.
 *
 * Not price: no provider's model endpoint returns one. Context window is what
 * they do offer, and it is the number that decides whether a long session
 * survives.
 */
function modelSummary(model: { id: string; displayName?: string; contextWindow?: number }) {
  const parts: string[] = [];
  if (model.displayName && model.displayName !== model.id) parts.push(model.displayName);
  if (model.contextWindow) parts.push(`${Math.round(model.contextWindow / 1000)}k context`);
  return parts.join(' · ') || model.id;
}

const apiBaseUrl = String(useRuntimeConfig().public.apiBaseUrl ?? '');
const refreshModels = () => loadModels(apiBaseUrl, { force: true });

// Fetch when the panel opens with a usable key, and whenever the key or
// endpoint changes — those are exactly the things that change the answer.
watch(
  [showSettings, () => settings.value.provider, () => settings.value.apiKey, () => settings.value.baseUrl],
  ([open]) => {
    if (open) void loadModels(apiBaseUrl);
  },
  { immediate: true }
);

const placeholder = computed(() =>
  connected.value
    ? 'Describe what the app needs to read or write…'
    : 'Choose a model provider to start'
);

async function submit() {
  const prompt = draftMessage.value.trim();
  if (!prompt || !connected.value || sending.value) return;
  draftMessage.value = '';

  const { accepted, changedIds } = await send(
    prompt,
    props.libraryId ?? null,
    props.screenContext ?? null
  );
  if (!accepted) {
    // The composer is already empty, so a refusal has to hand the text back or
    // the message is simply gone. `lastError` says why.
    draftMessage.value = prompt;
    return;
  }

  // Once, at the end of the turn — not after every tool call.
  await refreshEntities({ changedIds });
}
</script>

<style scoped>
.chat-rail {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  min-width: 0;
  background: var(--surface);
  border-right: 1px solid var(--border-default);
}

.pane-header {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: var(--space-4);
  height: 40px;
  flex-shrink: 0;
  padding: 0 var(--space-5);
  background: var(--surface-subtle);
  border-bottom: 1px solid var(--border-default);
}

.session-name {
  font-size: var(--text-body-lg);
  font-weight: var(--weight-semibold);
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.header-actions {
  display: flex;
  gap: var(--space-2);
  margin-left: auto;
  flex-shrink: 0;
}

.icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink-secondary);
  cursor: pointer;
}

.icon-button:disabled {
  color: var(--ink-disabled);
  cursor: not-allowed;
}

.icon-button.active {
  border-color: var(--action-border);
  background: var(--action-surface);
  color: var(--action-ink);
}

.provider-panel {
  /*
   * The label column's width, named because two rules depend on it being the
   * same number: the label sets it, and the hint indents past it. Not a
   * spacing step — it is whatever fits "Provider" and "API key".
   */
  --field-label-w: 72px;

  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  flex-shrink: 0;
  padding: var(--space-5);
  background: var(--surface-subtle);
  border-bottom: 1px solid var(--border-default);
}

.field {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.field-label {
  width: var(--field-label-w);
  flex-shrink: 0;
  font-size: var(--text-label);
  color: var(--ink-muted);
}

.field-input {
  box-sizing: border-box;
  flex: 1;
  min-width: 0;
  height: 26px;
  padding: 0 var(--space-3);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface);
  font-family: inherit;
  font-size: var(--text-label);
  color: var(--ink);
}

/* The field plus whatever the provider had to say about it. */
.field-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.field-hint {
  /* Aligned under the input rather than the label, so it reads as a note on
     the value and not as a second label. */
  margin: 0 0 0 calc(var(--field-label-w) + var(--space-3));
}

.field-hint:empty {
  display: none;
}

.field-hint-error {
  color: var(--danger-ink);
}

.field-hint-button {
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  color: var(--ink-muted);
  text-decoration: underline;
  cursor: pointer;
}

.field-hint-button:hover {
  color: var(--ink);
}

.assistant-error {
  margin: var(--space-4) 0 0;
  font-size: var(--text-label);
  color: var(--danger-ink);
}

.send.stop {
  border-color: var(--border-strong);
  background: var(--surface);
  color: var(--ink);
}

.chat-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: var(--space-6) var(--space-5);
}

/*
 * The chat's opening address, not the primitive's panel: left-aligned with the
 * turns that replace it, and stated at full ink because it is the first thing
 * said rather than a report that there is nothing to say.
 */
.chat-empty {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.chat-empty-title {
  margin: 0;
  font-size: var(--text-body-lg);
  font-weight: var(--weight-semibold);
  color: var(--ink);
}

.chat-empty-body {
  margin: 0;
  font-size: var(--text-body);
  line-height: var(--leading-normal);
  color: var(--ink-muted);
}

.user-turn {
  display: flex;
  justify-content: flex-end;
}

.bubble {
  max-width: 88%;
  padding: var(--space-4) var(--space-5);
  border: 1px solid var(--action-border);
  border-radius: var(--radius-lg) var(--radius-lg) var(--radius-sm) var(--radius-lg);
  background: var(--action-surface);
  font-size: var(--text-body);
  line-height: var(--leading-normal);
  color: var(--action-ink);
}

.assistant-turn {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.assistant-text {
  max-width: 92%;
  margin: 0;
  font-size: var(--text-body);
  line-height: var(--leading-normal);
  color: var(--ink-secondary);
}

.composer {
  flex-shrink: 0;
  padding: var(--space-5);
  background: var(--surface-subtle);
  border-top: 1px solid var(--border-default);
}

.composer-box {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-5);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-panel);
  background: var(--surface);
}

.composer-input {
  border: none;
  background: none;
  font-family: inherit;
  font-size: var(--text-body);
  color: var(--ink);
  resize: none;
}

.composer-input:focus {
  outline: none;
}

.composer-actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.backend-chip,
.attach {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  height: 24px;
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface);
  font-family: inherit;
  font-size: var(--text-label);
  color: var(--ink-muted);
  white-space: nowrap;
}

.attach {
  cursor: pointer;
}

.attach:disabled {
  color: var(--ink-disabled);
  cursor: not-allowed;
}

.send {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  margin-left: auto;
  border: 1px solid var(--action);
  border-radius: var(--radius);
  background: var(--action);
  color: var(--action-fg);
  cursor: pointer;
}

.send:disabled {
  border-color: var(--border-default);
  background: var(--surface-raised);
  color: var(--ink-disabled);
  cursor: not-allowed;
}

.not-connected {
  margin: var(--space-4) 0 0;
  font-size: var(--text-label);
  color: var(--ink-muted);
}
</style>
