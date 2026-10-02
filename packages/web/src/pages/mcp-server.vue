<template>
  <div class="mcp-layout">
    <AppNavRail active-section="mcp" @select="handleRailSelect" />

    <main class="page">
      <div class="page-measure">
        <header class="hero">
          <h1 class="title">MCP</h1>
          <p class="lede">
            sqlib provides an MCP server. Connect it to Claude or ChatGPT and your libraries become
            tools they can use.
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

        <section class="cards">
          <article class="card">
            <Play :size="16" class="card-icon" />
            <h2 class="card-title">Run saved queries</h2>
            <p class="card-body">Queries and query groups by name, with their parameters filled in from the chat.</p>
          </article>
          <article class="card">
            <Code2 :size="16" class="card-icon" />
            <h2 class="card-title">Ad-hoc SPARQL</h2>
            <p class="card-body">Write and run a query against a registered backend without saving it.</p>
          </article>
          <article class="card">
            <LayoutGrid :size="16" class="card-icon" />
            <h2 class="card-title">Query bench in chat</h2>
            <p class="card-body">Edit, run and see results as a table, where the client supports MCP Apps.</p>
          </article>
        </section>

        <!--
          The one-click path first: it is the only one a non-technical user
          finishes. Everything under it is the same URL delivered by hand for the
          clients with no such link.
        -->
        <section class="block">
          <div class="add-row">
            <a class="deeplink" :href="claudeDeeplink" target="_blank" rel="noopener" data-testid="claude-deeplink">
              <Plug :size="14" /> Add to Claude
            </a>
            <span class="muted">Opens Claude's Add custom connector dialog with this server filled in. Press Add.</span>
          </div>

          <div class="client-tabs" role="tablist">
            <button
              v-for="client in MCP_CLIENTS"
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

        <footer class="footnotes">
          <p class="links">
            <a :href="docUrl('guides/mcp-app.md')" target="_blank" rel="noopener">MCP guide</a>
            <a :href="docUrl('guides/mcp-clients.md')" target="_blank" rel="noopener">Client configuration</a>
            <a :href="docUrl('explanation/security-model.md')" target="_blank" rel="noopener">Security model</a>
          </p>
        </footer>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
/**
 * How to use this sqlib from a chat client.
 *
 * Nobody works here. They arrive, copy a URL or press one button, and leave for
 * Claude or ChatGPT, so the page is a product page rather than a screen: the
 * URL, the install paths, three cards saying what they get, and links to the
 * documentation for anything longer. Prose that explains rather than directs
 * belongs in `docs/guides/mcp-app.md`, which is linked at the bottom.
 *
 * This replaced the Build screen, which paired a callable list with an in-app
 * assistant. That assistant needed an API key per user to be useful, and the
 * audience that matters first already pays for one, in Claude or ChatGPT.
 *
 * The route is `/mcp-server`, not `/mcp`, because `/mcp` is the API's own path.
 * Nothing this repository ships serves the app and the API from one origin, but
 * a reverse proxy in front of both is an ordinary thing to build, and a route
 * that only collides in somebody else's deployment is the worst kind.
 */
import { computed, ref } from 'vue';
import { useRouter } from '#imports';
import { Check, Code2, Copy, LayoutGrid, Play, Plug } from '@lucide/vue';
import AppNavRail from '@/components/AppNavRail.vue';
import { useActiveLibrary } from '@/composables/useActiveLibrary';
import { docUrl } from '@/lib/docs';
import { isScreenSection, SCREEN_SECTION_PATHS, type RailSection } from '@/lib/railSections';
import { MCP_CLIENTS, claudeConnectorLink, mcpEndpoint } from '@/lib/mcpClients';
// @ts-ignore - Nuxt auto-import
import { useRuntimeConfig } from '#imports';

const config = useRuntimeConfig();
const router = useRouter();
const { activeLibraryId: libraryId } = useActiveLibrary();

const mcpUrl = computed(() => mcpEndpoint(config.public));
const claudeDeeplink = computed(() => claudeConnectorLink(mcpUrl.value));

const activeClient = ref(MCP_CLIENTS[0]!.id);
const active = computed(
  () => MCP_CLIENTS.find((client) => client.id === activeClient.value) ?? MCP_CLIENTS[0]!
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

function handleRailSelect(section: RailSection) {
  if (section === 'mcp') return;
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
.mcp-layout {
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
  gap: var(--space-7);
  max-width: 68rem;
  padding: var(--space-9) var(--space-8) var(--space-9);
  margin: 0 auto;
}

.hero {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.title {
  margin: 0;
  font-size: var(--text-display);
  line-height: 1.15;
  font-weight: var(--weight-semibold);
  letter-spacing: -0.01em;
  color: var(--ink);
}

.lede {
  max-width: 56ch;
  margin: 0;
  font-size: var(--text-body-lg);
  line-height: var(--leading-normal);
  color: var(--ink-secondary);
}

.endpoint-card {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-5);
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
  font-size: var(--text-body);
  color: var(--ink);
}

/* Three across on a desktop, stacking on anything narrow. */
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
  gap: var(--space-4);
}

.card {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-5);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-panel);
  background: var(--surface);
}

.card-icon {
  color: var(--ink-muted);
}

.card-title {
  margin: 0;
  font-size: var(--text-body);
  font-weight: var(--weight-semibold);
  color: var(--ink);
}

.card-body {
  margin: 0;
  font-size: var(--text-label);
  line-height: var(--leading-normal);
  color: var(--ink-secondary);
}

.block {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  align-items: flex-start;
}

.add-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-4);
}

.deeplink {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  height: 34px;
  padding: 0 var(--space-6);
  border: 1px solid var(--action-border);
  border-radius: var(--radius);
  background: var(--action-surface);
  font-size: var(--text-body);
  font-weight: var(--weight-semibold);
  color: var(--action-ink);
  text-decoration: none;
}

.muted {
  max-width: 62ch;
  font-size: var(--text-label);
  line-height: var(--leading-normal);
  color: var(--ink-muted);
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
 * here: these are numbered steps somebody follows with one hand on a settings
 * page, and an unnumbered step is a step you lose your place in.
 */
.steps {
  max-width: 70ch;
  margin: 0;
  padding-left: var(--space-7);
  list-style: decimal outside;
  font-size: var(--text-body);
  line-height: var(--leading-normal);
  color: var(--ink-secondary);
}

.steps li {
  margin-bottom: var(--space-2);
  padding-left: var(--space-1);
}

.steps li::marker {
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

.footnotes {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding-top: var(--space-6);
  border-top: 1px solid var(--border-subtle);
}

.links {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-5);
  margin: 0;
  font-size: var(--text-label);
}

.links a {
  color: var(--action-ink);
}
</style>
