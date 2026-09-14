<template>
  <section class="connect-section" data-testid="connect-assistant">
    <header class="section-head">
      <span class="section-title">Connect your own assistant</span>
      <span class="rule" />
    </header>

    <!--
      Door B, which is most of the value at none of the build cost: the user
      already has Claude Desktop and a subscription, and the same 79 tools are
      already served over MCP. All this panel does is tell them so.
    -->
    <p class="lede">
      This library is already an MCP server. Point Claude Desktop, Cursor or any MCP client at it
      and it gets the same tools the assistant here uses — on your own subscription.
    </p>

    <div class="endpoint-row">
      <span class="endpoint-label">Endpoint</span>
      <code class="endpoint" data-testid="mcp-endpoint">{{ endpoint }}</code>
      <button type="button" class="copy-button" :title="copyTitle" data-testid="copy-endpoint" @click="copy(endpoint, 'endpoint')">
        <Check v-if="copied === 'endpoint'" :size="12" />
        <Copy v-else :size="12" />
      </button>
    </div>

    <div class="client-tabs" role="tablist">
      <button
        v-for="client in clients"
        :key="client.id"
        type="button"
        class="client-tab"
        :class="{ active: activeClient === client.id }"
        role="tab"
        :aria-selected="activeClient === client.id"
        :data-testid="`client-${client.id}`"
        @click="activeClient = client.id"
      >
        {{ client.label }}
      </button>
    </div>

    <div class="config-block">
      <InlineNote>{{ active.note }}</InlineNote>
      <pre class="config-snippet" data-testid="client-config">{{ active.config(endpoint) }}</pre>
      <button
        type="button"
        class="copy-config"
        data-testid="copy-config"
        @click="copy(active.config(endpoint), 'config')"
      >
        <Check v-if="copied === 'config'" :size="12" />
        <Copy v-else :size="12" />
        {{ copied === 'config' ? 'Copied' : 'Copy config' }}
      </button>
    </div>

    <!--
      Said plainly rather than left to be discovered. The endpoint has no auth
      of any kind — it is blocked on the same caller-authorization model door A
      is (plan §7) — so anyone who can reach the host can read and write the
      library through it.
    -->
    <p class="warning" data-testid="connect-warning">
      <ShieldAlert :size="12" />
      This endpoint is unauthenticated. Anyone who can reach it can read and change this library, so
      keep it on a trusted network until access control lands.
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { Copy, Check, ShieldAlert } from '@lucide/vue';
import InlineNote from '../shared/InlineNote.vue';
// @ts-ignore - Nuxt auto-import
import { useRuntimeConfig } from '#imports';

const config = useRuntimeConfig();

/** `/mcp` is served beside the API, on the same origin, in every deployment mode. */
const endpoint = computed(() => `${String(config.public.apiBaseUrl ?? '').replace(/\/$/, '')}/mcp`);

type Client = {
  id: string;
  label: string;
  note: string;
  config: (endpoint: string) => string;
};

const clients: Client[] = [
  {
    id: 'claude-desktop',
    label: 'Claude Desktop',
    note: 'Settings → Developer → Edit Config, then restart Claude.',
    config: (url) =>
      JSON.stringify(
        { mcpServers: { sqlib: { type: 'http', url } } },
        null,
        2
      ),
  },
  {
    id: 'cursor',
    label: 'Cursor',
    note: 'Add to .cursor/mcp.json in your project, or the global one in ~/.cursor.',
    config: (url) => JSON.stringify({ mcpServers: { sqlib: { url } } }, null, 2),
  },
  {
    id: 'cli',
    label: 'Claude Code',
    note: 'Run this once; it is stored per project.',
    config: (url) => `claude mcp add --transport http sqlib ${url}`,
  },
];

const activeClient = ref(clients[0]!.id);
const active = computed(() => clients.find((client) => client.id === activeClient.value) ?? clients[0]!);

const copied = ref<'endpoint' | 'config' | null>(null);
const copyTitle = computed(() => (copied.value === 'endpoint' ? 'Copied' : 'Copy endpoint'));

async function copy(text: string, what: 'endpoint' | 'config') {
  try {
    await navigator.clipboard.writeText(text);
    copied.value = what;
    // Long enough to notice, short enough not to look stuck.
    setTimeout(() => {
      if (copied.value === what) copied.value = null;
    }, 1500);
  } catch {
    // A clipboard the browser refuses is not worth an error state — the text
    // is on screen and selectable either way.
  }
}
</script>

<style scoped>
.connect-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-6) 0 0;
}

.section-head {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.section-title {
  font-size: var(--text-body-lg);
  font-weight: var(--weight-semibold);
  color: var(--ink);
  white-space: nowrap;
}

.rule {
  flex: 1;
  height: 1px;
  background: var(--border-subtle);
}

.lede {
  max-width: 70ch;
  margin: 0;
  font-size: var(--text-body);
  line-height: var(--leading-normal);
  color: var(--ink-secondary);
}

.endpoint-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.endpoint-label {
  font-size: var(--text-label);
  color: var(--ink-muted);
}

.endpoint {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface-subtle);
  font-family: var(--font-mono);
  font-size: var(--text-label);
  color: var(--ink);
}

.copy-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink-secondary);
  cursor: pointer;
}

.client-tabs {
  display: flex;
  gap: var(--space-2);
}

.client-tab {
  height: 26px;
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface);
  font-family: inherit;
  font-size: var(--text-label);
  color: var(--ink-secondary);
  cursor: pointer;
}

.client-tab.active {
  border-color: var(--action-border);
  background: var(--action-surface);
  color: var(--action-ink);
  font-weight: var(--weight-semibold);
}

.config-block {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  align-items: flex-start;
}

.config-snippet {
  width: 100%;
  box-sizing: border-box;
  margin: 0;
  padding: var(--space-4);
  overflow-x: auto;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-panel);
  background: var(--code-surface);
  font-family: var(--font-mono);
  font-size: var(--text-label);
  line-height: var(--leading-normal);
  color: var(--code-ink);
}

.copy-config {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  height: 26px;
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface);
  font-family: inherit;
  font-size: var(--text-label);
  color: var(--ink-secondary);
  cursor: pointer;
}

.warning {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  max-width: 70ch;
  margin: 0;
  font-size: var(--text-label);
  line-height: var(--leading-normal);
  color: var(--warning-ink);
}
</style>
