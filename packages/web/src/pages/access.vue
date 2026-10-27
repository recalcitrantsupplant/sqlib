<template>
  <div class="access-layout">
    <AppNavRail active-section="access" @select="handleRailSelect" />

    <main class="page">
      <div class="page-measure">
        <header class="hero">
          <h1 class="title">Access</h1>
          <p class="lede">
            Grants say who may use each library and backend. A backend's graph policy then narrows which of its
            graphs each person may read.
          </p>
        </header>

        <div class="tabs" role="tablist">
          <button
            v-for="tab in TABS"
            :key="tab.id"
            type="button"
            role="tab"
            :aria-selected="activeTab === tab.id"
            :class="['tab', { active: activeTab === tab.id }]"
            :data-testid="`access-tab-${tab.id}`"
            @click="activeTab = tab.id"
          >
            {{ tab.label }}
          </button>
        </div>

        <p v-if="!auth.isAdmin.value" class="notice">Only administrators can manage access.</p>
        <AccessGrantsPanel v-else-if="activeTab === 'grants'" />
        <GraphPolicyPanel v-else />
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
/**
 * The Access screen: grants, and graph policies with `Test as`.
 *
 * Account level, like Backends, and for administrators only. The rail shows
 * it only to them; the page says so to anyone who reaches it by URL, and the
 * API refuses the calls either way.
 */
import { ref } from 'vue';
import { useRouter } from '#imports';
import AppNavRail from '@/components/AppNavRail.vue';
import AccessGrantsPanel from '@/components/access/AccessGrantsPanel.vue';
import GraphPolicyPanel from '@/components/access/GraphPolicyPanel.vue';
import { useActiveLibrary } from '@/composables/useActiveLibrary';
import { useAuth } from '@/composables/useAuth';
import { isScreenSection, SCREEN_SECTION_PATHS, type RailSection } from '@/lib/railSections';

const TABS = [
  { id: 'grants', label: 'Grants' },
  { id: 'policies', label: 'Graph policies' },
] as const;

const router = useRouter();
const auth = useAuth();
const { activeLibraryId: libraryId } = useActiveLibrary();
const activeTab = ref<(typeof TABS)[number]['id']>('grants');

function handleRailSelect(section: RailSection) {
  if (section === 'access') return;
  const query = libraryId.value ? { library: libraryId.value } : {};
  if (isScreenSection(section)) {
    router.push({ path: SCREEN_SECTION_PATHS[section], query });
    return;
  }
  router.push({ path: `/${section}`, query });
}
</script>

<style scoped>
.access-layout {
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
  gap: var(--space-6);
  max-width: 72rem;
  padding: var(--space-9) var(--space-8);
  margin: 0 auto;
}

.hero {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.title {
  margin: 0;
  color: var(--ink);
  font-size: var(--text-display);
  font-weight: var(--weight-semibold);
}

.lede {
  max-width: 60ch;
  margin: 0;
  color: var(--ink-secondary);
  font-size: var(--text-body-lg);
  line-height: var(--leading-normal);
}

.tabs {
  display: flex;
  gap: var(--space-2);
  border-bottom: 1px solid var(--border-default);
}

.tab {
  padding: var(--space-2) var(--space-4);
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--ink-secondary);
  font-size: var(--text-body);
  cursor: pointer;
}

.tab.active {
  border-bottom-color: var(--action);
  color: var(--ink);
  font-weight: var(--weight-semibold);
}

.notice {
  margin: 0;
  color: var(--ink-muted);
  font-size: var(--text-body);
}

@media (max-width: 720px) {
  .page-measure {
    padding: var(--space-6) var(--space-4);
  }
}
</style>
