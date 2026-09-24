<template>
  <div class="connect-layout">
    <AppNavRail active-section="connect" @select="handleRailSelect" />

    <main class="page">
      <div class="page-measure">
        <header class="page-header">
          <h1 class="title">Connect</h1>
          <p class="lede">
            This sqlib is an MCP server. Point Claude or ChatGPT at it and your libraries become
            tools they can use — list queries, fill in their parameters, run them against your
            backends — on your own subscription, with no key to manage here.
          </p>
        </header>

        <!-- The URL everything else on this page is a way of delivering. -->
        <section class="endpoint-card">
          <span class="endpoint-label">Server URL</span>
          <code class="endpoint" data-testid="mcp-endpoint">{{ mcpUrl }}</code>
          <button type="button" class="icon-button" :title="copied === 'url' ? 'Copied' : 'Copy URL'" data-testid="copy-endpoint" @click="copy(mcpUrl, 'url')">
            <Check v-if="copied === 'url'" :size="13" />
            <Copy v-else :size="13" />
          </button>
        </section>

        <!--
          The one-click path, first, because it is the only one a non-technical
          user will complete. Everything below it is the same URL delivered by
          hand for the clients that have no such link.
        -->
        <section class="block">
          <header class="block-head">
            <h2 class="block-title">One click</h2>
            <span class="rule" />
          </header>
          <a class="deeplink" :href="claudeDeeplink" target="_blank" rel="noopener" data-testid="claude-deeplink">
            <Plug :size="14" /> Add to Claude
          </a>
          <InlineNote>
            Opens Claude's connector settings with the name and URL filled in; you press Add.
            Custom connectors need a paid Claude plan, and if the form opens empty, paste the URL
            above — the link is not part of Claude's documented interface and the app may change it.
          </InlineNote>
        </section>

        <section class="block">
          <header class="block-head">
            <h2 class="block-title">By hand</h2>
            <span class="rule" />
          </header>

          <div class="client-tabs" role="tablist">
            <button
              v-for="client in CONNECT_CLIENTS"
              :key="client.id"
              type="button"
              class="client-tab"
              role="tab"
              :aria-selected="activeClient === client.id"
              :class="{ active: activeClient === client.id }"
              :data-testid="`client-${client.id}`"
              @click="activeClient = client.id"
            >
              {{ client.label }}
            </button>
          </div>

          <ol class="steps" data-testid="client-steps">
            <li v-for="(step, index) in active.steps" :key="index">{{ step }}</li>
          </ol>

          <div v-if="active.snippet" class="config-block">
            <pre class="config-snippet" data-testid="client-config">{{ active.snippet(mcpUrl) }}</pre>
            <button type="button" class="ghost-button" data-testid="copy-config" @click="copy(active.snippet!(mcpUrl), 'config')">
              <Check v-if="copied === 'config'" :size="12" />
              <Copy v-else :size="12" />
              {{ copied === 'config' ? 'Copied' : 'Copy' }}
            </button>
          </div>
        </section>

        <!--
          A check the user can run themselves, because every failure on this
          page looks identical from the chat side: the client says it cannot
          reach the connector and names no reason. This speaks MCP to the URL
          above and reports what came back.
        -->
        <section class="block">
          <header class="block-head">
            <h2 class="block-title">Check it</h2>
            <span class="rule" />
          </header>
          <div class="check-row">
            <button type="button" class="ghost-button" :disabled="probing" data-testid="test-connection" @click="testConnection">
              <RefreshCw :size="12" :class="{ spin: probing }" />
              {{ probing ? 'Checking…' : 'Test connection' }}
            </button>
            <span v-if="probe" class="probe" :class="probe.ok ? 'ok' : 'bad'" data-testid="test-result">
              <Check v-if="probe.ok" :size="12" />
              <TriangleAlert v-else :size="12" />
              {{ probe.message }}
            </span>
          </div>
          <InlineNote v-if="probe && !probe.ok">
            A check that fails from this browser does not prove a chat client will fail: the two
            reach the server from different places. It does prove the URL is wrong, the server is
            down, or it refuses cross-origin requests.
          </InlineNote>
        </section>

        <section class="block">
          <header class="block-head">
            <h2 class="block-title">What you get</h2>
            <span class="rule" />
          </header>
          <ul class="facts">
            <li>
              Your libraries, queries and query groups, listed and readable by name — and runnable,
              with the parameters a query declares filled in from the conversation.
            </li>
            <li>
              Ad-hoc SPARQL against a registered backend, without saving anything.
            </li>
            <li>
              A <strong>query bench</strong> rendered in the chat where the client supports MCP
              Apps: edit the query, fill its arguments, run it and see the rows as a table rather
              than as JSON in the transcript.
            </li>
          </ul>
          <!--
            The assumption someone who used the web app first will otherwise
            make, and be wrong about for a confusing half hour.
          -->
          <InlineNote>
            A chat client talks to this server, not to your browser — so backends and drafts kept
            in this browser's local storage are invisible to it. What it can see is what the server
            holds.
          </InlineNote>
        </section>

        <p class="warning" data-testid="connect-warning">
          <ShieldAlert :size="13" />
          <span>
            This endpoint has no authentication of its own: anyone who can reach the URL gets the
            tools it publishes. A server started with <code>MCP_READ_ONLY=1</code> publishes only
            the tools that read — running queries included — and nothing that creates, changes or
            deletes. Anything else should stay on a network you trust.
          </span>
        </p>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
/**
 * How to use this sqlib from a chat client.
 *
 * This replaced the Build screen, which paired a callable list with an in-app
 * assistant. The assistant needed an API key per user to be useful, and the
 * audience that matters first already pays for one — in Claude or ChatGPT. So
 * the page stopped being a second place to chat and became the shortest path to
 * chatting where they already are: one URL, one link that installs it, and a
 * check for when it does not work.
 */
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Check, Copy, Plug, RefreshCw, ShieldAlert, TriangleAlert } from '@lucide/vue';
import AppNavRail from '@/components/AppNavRail.vue';
import InlineNote from '@/components/shared/InlineNote.vue';
import { useActiveLibrary } from '@/composables/useActiveLibrary';
import { isScreenSection, SCREEN_SECTION_PATHS, type RailSection } from '@/lib/railSections';
import {
  CONNECT_CLIENTS,
  claudeConnectorLink,
  describeCatalogue,
  mcpEndpoint,
  parseRpcMessage,
} from '@/lib/connectTargets';
// @ts-ignore - Nuxt auto-import
import { useRuntimeConfig } from '#imports';

const config = useRuntimeConfig();
const router = useRouter();
const { activeLibraryId: libraryId } = useActiveLibrary();

const mcpUrl = computed(() => mcpEndpoint(config.public));
const claudeDeeplink = computed(() => claudeConnectorLink(mcpUrl.value));

const activeClient = ref(CONNECT_CLIENTS[0]!.id);
const active = computed(
  () => CONNECT_CLIENTS.find((client) => client.id === activeClient.value) ?? CONNECT_CLIENTS[0]!
);

const copied = ref<'url' | 'config' | null>(null);

async function copy(text: string, what: 'url' | 'config') {
  try {
    await navigator.clipboard.writeText(text);
    copied.value = what;
    setTimeout(() => {
      if (copied.value === what) copied.value = null;
    }, 1500);
  } catch {
    // The text is on screen and selectable; a refused clipboard is not an error
    // state worth showing.
  }
}

// --- the connection check ------------------------------------------------

const probing = ref(false);
const probe = ref<{ ok: boolean; message: string } | null>(null);

async function rpc(method: string, params: unknown, sessionId: string | null) {
  const response = await fetch(mcpUrl.value, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return {
    sessionId: response.headers.get('mcp-session-id'),
    message: parseRpcMessage(await response.text()),
  };
}

async function notify(method: string, sessionId: string | null) {
  await fetch(mcpUrl.value, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', method, params: {} }),
  });
}

/**
 * Speak MCP to the URL and say what answered.
 *
 * A full handshake rather than a ping, because a reachable port proves nothing
 * about a connector: `initialize`, the notification the specification requires
 * before anything else, then `tools/list`. What comes back is worth reporting
 * in words — the server's own name, how many tools it publishes, and whether
 * any of them writes — since "is this the read-only one I meant to deploy?" is
 * the question this page is most often opened to settle.
 */
async function testConnection() {
  probing.value = true;
  probe.value = null;
  try {
    const init = await rpc(
      'initialize',
      {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'sqlib-connect-page', version: '1' },
      },
      null
    );
    if (!init.message?.result) throw new Error('the server did not answer initialize');
    const info = (init.message.result as { serverInfo?: { name?: string } }).serverInfo;
    const session = init.sessionId;

    // Required by the specification before any other request, and refused by
    // servers that enforce it. A notification, so nothing comes back.
    await notify('notifications/initialized', session);

    const listed = await rpc('tools/list', {}, session);
    const tools = (listed.message?.result as { tools?: { name: string }[] } | undefined)?.tools ?? [];
    const { mode } = describeCatalogue(tools.map((tool) => tool.name));

    probe.value = {
      ok: true,
      message: `Reachable — ${info?.name ?? 'the server'}, ${tools.length} tools, ${mode}.`,
    };
  } catch (error) {
    probe.value = {
      ok: false,
      message: `No answer from ${mcpUrl.value} (${(error as Error).message}).`,
    };
  } finally {
    probing.value = false;
  }
}

function handleRailSelect(section: RailSection) {
  if (section === 'connect') return;
  if (isScreenSection(section)) {
    router.push({
      path: SCREEN_SECTION_PATHS[section],
      query: libraryId.value ? { library: libraryId.value } : {},
    });
    return;
  }
  router.push({ path: '/', query: { section, ...(libraryId.value ? { library: libraryId.value } : {}) } });
}
</script>

<style scoped>
.connect-layout {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

.page {
  flex: 1;
  overflow-y: auto;
  background: var(--surface);
}

.page-measure {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  max-width: 78ch;
  padding: var(--space-8) var(--space-8) var(--space-9);
  margin: 0 auto;
}

.page-header {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.title {
  margin: 0;
  font-size: var(--text-title);
  font-weight: var(--weight-semibold);
  color: var(--ink);
}

.lede {
  max-width: 70ch;
  margin: 0;
  font-size: var(--text-body);
  line-height: var(--leading-normal);
  color: var(--ink-secondary);
}

.endpoint-card {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-panel);
  background: var(--surface-subtle);
}

.endpoint-label {
  font-size: var(--text-label);
  color: var(--ink-muted);
  white-space: nowrap;
}

.endpoint {
  flex: 1;
  overflow-x: auto;
  font-family: var(--font-mono);
  font-size: var(--text-label);
  color: var(--ink);
}

.block {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  align-items: flex-start;
}

.block-head {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  width: 100%;
}

.block-title {
  margin: 0;
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

.deeplink {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  height: 32px;
  padding: 0 var(--space-5);
  border: 1px solid var(--action-border);
  border-radius: var(--radius);
  background: var(--action-surface);
  font-size: var(--text-body);
  font-weight: var(--weight-semibold);
  color: var(--action-ink);
  text-decoration: none;
}

.client-tabs {
  display: flex;
  flex-wrap: wrap;
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

/*
 * Markers restored explicitly. The app's reset strips them from every list,
 * which is right for the menus and trees that make up most of it and wrong
 * here: these are the numbered steps somebody follows with one hand on a
 * settings page, and an unnumbered step is a step you lose your place in.
 */
.steps,
.facts {
  max-width: 70ch;
  margin: 0;
  padding-left: var(--space-7);
  font-size: var(--text-body);
  line-height: var(--leading-normal);
  color: var(--ink-secondary);
}

.steps {
  list-style: decimal outside;
}

.facts {
  list-style: disc outside;
}

.steps li,
.facts li {
  margin-bottom: var(--space-2);
  padding-left: var(--space-1);
}

.steps li::marker,
.facts li::marker {
  color: var(--ink-muted);
}

.config-block {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  align-items: flex-start;
  width: 100%;
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

.icon-button,
.ghost-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  height: 26px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface);
  font-family: inherit;
  font-size: var(--text-label);
  color: var(--ink-secondary);
  cursor: pointer;
}

.icon-button {
  width: 26px;
}

.ghost-button {
  padding: 0 var(--space-4);
}

.ghost-button:disabled {
  cursor: default;
  opacity: 0.6;
}

.check-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.probe {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-label);
}

.probe.ok {
  color: var(--success-ink);
}

.probe.bad {
  color: var(--warning-ink);
}

.spin {
  animation: spin 900ms linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
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

.warning code {
  font-family: var(--font-mono);
}
</style>
