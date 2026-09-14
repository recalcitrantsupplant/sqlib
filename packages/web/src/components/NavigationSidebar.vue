<template>
  <aside class="nav-sidebar" :class="{ collapsed }">
    <!-- Collapse/Expand Toggle -->
    <div class="sidebar-header">
      <h2 v-show="!collapsed" class="sidebar-title">SPARQL Query Library</h2>
      <button
        class="collapse-toggle"
        @click="toggleCollapsed"
        :title="collapsed ? 'Expand sidebar' : 'Collapse sidebar'"
      >
        <PanelLeftClose v-if="!collapsed" :size="18" />
        <PanelLeftOpen v-else :size="18" />
      </button>
    </div>

    <div class="sidebar-content" v-show="!collapsed">
      <!--
        There is no Playground section. Every playground was a screen you could
        reach with an unsaved body on it, and an unsaved body is a scratch item
        in its own section's list now — a second door to the same content is
        exactly what the nav redesign exists to end (nav doc §1).
      -->

      <!-- Libraries Section -->
      <section v-if="sectionVisibility.libraries" class="nav-section">
        <div class="section-header">
          <button class="section-toggle" @click="toggleSection('libraries')">
            <ChevronRight :size="14" class="arrow" :class="{ expanded: expandedSections.libraries }" />
            <SectionLabel as="span" size="lg" class="section-title">Libraries</SectionLabel>
          </button>
          <div class="section-actions">
            <button class="download-button" @click="handleDownloadAllLibraries" title="Download All Libraries RDF">
              <Download :size="16" />
            </button>
            <button class="filter-button" @click="toggleFilter('libraries')" title="Filter Libraries">
              <Search :size="16" />
            </button>
            <button class="add-button" @click="handleAddLibrary" title="Add Library">
              <Plus :size="16" />
            </button>
          </div>
        </div>

        <!-- Filter input row -->
        <div v-show="activeFilter === 'libraries'" class="filter-input-row">
          <input
            v-model="filterText.libraries"
            type="text"
            placeholder="Filter libraries..."
            class="filter-input"
            @keydown.escape="activeFilter = null"
          />
        </div>

        <div v-show="expandedSections.libraries" class="section-content">
          <div v-if="librariesLoading" class="section-message">Loading libraries…</div>
          <div v-else-if="librariesError" class="section-message error">{{ librariesError }}</div>
          <div v-else-if="!anyLibraries" class="section-message empty">No libraries available yet.</div>
          <template v-else>
            <div
              v-for="entry in filteredLibraryTree"
              :key="entry.library.id"
              class="library-item"
            >
              <div class="library-header">
                <button
                  class="library-toggle"
                  @click="toggleLibrary(entry.library.id)"
                  :class="{ selected: selectedLibraryId === entry.library.id }"
                >
                  <ChevronRight :size="14" class="arrow" :class="{ expanded: expandedLibraries[entry.library.id] }" />
                  <span class="item-name">{{ entry.library.name }}</span>
                  <div class="library-actions">
                    <button
                      class="edit-button-small"
                      @click.stop="handleEditLibrary(entry.library.id, entry.library.name)"
                      title="Edit Library"
                    >
                      <Pencil :size="14" />
                    </button>
                    <button
                      class="download-button-small"
                      @click.stop="handleDownloadLibraryRDF(entry.library.id)"
                      title="Download Library RDF"
                    >
                      <Download :size="14" />
                    </button>
                    <button
                      class="delete-button-small"
                      @click.stop="handleDeleteLibrary(entry.library.id, entry.library.name)"
                      title="Delete Library"
                    >
                      <Trash2 :size="14" />
                    </button>
                  </div>
                </button>
              </div>

              <div v-show="expandedLibraries[entry.library.id]" class="library-subitems">
                <template v-if="queriesEnabled && showCategory('queries')">
                  <div class="subitem-category">
                    <button class="category-header" @click="toggleCategory(entry.library.id, 'queries')">
                      <ChevronRight :size="12" class="arrow small" :class="{ expanded: expandedCategories[`${entry.library.id}-queries`] }" />
                      <span>Queries</span>
                    </button>
                    <div class="category-actions">
                      <div class="download-menu-container">
                        <button
                          class="download-button-small"
                          @click.stop="toggleDownloadMenu(`${entry.library.id}-queries`)"
                          title="Download"
                        >
                          <Download :size="14" />
                        </button>
                        <div v-if="openDownloadMenu === `${entry.library.id}-queries`" class="download-menu">
                          <button @click="handleDownloadRDF(entry.library.id, 'queries')" class="menu-item">
                            Query Library RDF
                          </button>
                          <button @click="handleDownloadAssets(entry.library.id, 'queries')" class="menu-item">
                            Queries gzip
                          </button>
                        </div>
                      </div>
                      <button
                        class="filter-button-small"
                        @click.stop="toggleFilter(`${entry.library.id}-queries`)"
                        title="Filter Queries"
                      >
                        <Search :size="12" />
                      </button>
                      <button class="add-button-small" @click="handleAddQuery(entry.library)" title="Add Query">
                        <Plus :size="14" />
                      </button>
                    </div>
                  </div>
                  <!-- Filter input row -->
                  <div v-show="activeFilter === `${entry.library.id}-queries`" class="filter-input-row-small">
                    <input
                      v-model="filterText[`${entry.library.id}-queries`]"
                      type="text"
                      placeholder="Filter queries..."
                      class="filter-input-small"
                      @keydown.escape="activeFilter = null"
                    />
                  </div>
                  <div v-show="expandedCategories[`${entry.library.id}-queries`]" class="category-items">
                    <div v-if="entry.queries.length === 0" class="category-empty">No queries yet.</div>
                    <div
                      v-for="query in entry.queries"
                      :key="query.id"
                      class="item-row"
                    >
                      <button
                        class="item-button"
                        :class="{ selected: selectedItemId === query.id }"
                        @click="handleSelectItem(query)"
                      >
                        {{ query.name }}
                      </button>
                      <div class="item-download">
                        <button
                          class="download-icon-button"
                          @click.stop="toggleDownloadMenu(`${query.id}`)"
                          title="Download"
                        >
                          <Download :size="12" />
                        </button>
                        <div v-if="openDownloadMenu === `${query.id}`" class="download-menu">
                          <button @click="handleDownloadItemRDF(query.id, 'query')" class="menu-item">
                            Query Library RDF
                          </button>
                          <button @click="handleDownloadQuery(query.id)" class="menu-item">
                            SPARQL Query
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </template>

                <template v-if="queryGroupsEnabled && showCategory('queryGroups')">
                  <div class="subitem-category">
                    <button class="category-header" @click="toggleCategory(entry.library.id, 'queryGroups')">
                      <ChevronRight :size="12" class="arrow small" :class="{ expanded: expandedCategories[`${entry.library.id}-queryGroups`] }" />
                      <span>Query Groups</span>
                    </button>
                    <div class="category-actions">
                      <div class="download-menu-container">
                        <button
                          class="download-button-small"
                          @click.stop="toggleDownloadMenu(`${entry.library.id}-queryGroups`)"
                          title="Download"
                        >
                          <Download :size="14" />
                        </button>
                        <div v-if="openDownloadMenu === `${entry.library.id}-queryGroups`" class="download-menu">
                          <button @click="handleDownloadRDF(entry.library.id, 'queryGroups')" class="menu-item">
                            Query Library RDF
                          </button>
                        </div>
                      </div>
                      <button
                        class="filter-button-small"
                        @click.stop="toggleFilter(`${entry.library.id}-queryGroups`)"
                        title="Filter Query Groups"
                      >
                        <Search :size="12" />
                      </button>
                      <button class="add-button-small" @click="handleAddQueryGroup(entry.library)" title="Add Query Group">
                        <Plus :size="14" />
                      </button>
                    </div>
                  </div>
                  <!-- Filter input row -->
                  <div v-show="activeFilter === `${entry.library.id}-queryGroups`" class="filter-input-row-small">
                    <input
                      v-model="filterText[`${entry.library.id}-queryGroups`]"
                      type="text"
                      placeholder="Filter query groups..."
                      class="filter-input-small"
                      @keydown.escape="activeFilter = null"
                    />
                  </div>
                  <div v-show="expandedCategories[`${entry.library.id}-queryGroups`]" class="category-items">
                    <div v-if="entry.queryGroups.length === 0" class="category-empty">No query groups yet.</div>
                    <div
                      v-for="queryGroup in entry.queryGroups"
                      :key="queryGroup.id"
                      class="item-row"
                    >
                      <button
                        class="item-button"
                        :class="{ selected: selectedItemId === queryGroup.id }"
                        @click="handleSelectItem(queryGroup)"
                      >
                        {{ queryGroup.name }}
                      </button>
                      <div class="item-download">
                        <button
                          class="download-icon-button"
                          @click.stop="handleDownloadItemRDF(queryGroup.id, 'queryGroup')"
                          title="Download Query Library RDF"
                        >
                          <Download :size="12" />
                        </button>
                      </div>
                    </div>
                  </div>
                </template>

                <template v-if="rulesSuiteEnabled">
                <div v-if="showCategory('ruleSets')" class="subitem-category">
                  <button class="category-header" @click="toggleCategory(entry.library.id, 'ruleSets')">
                    <ChevronRight :size="12" class="arrow small" :class="{ expanded: expandedCategories[`${entry.library.id}-ruleSets`] }" />
                    <span>Rule Sets</span>
                  </button>
                  <div class="category-actions">
                    <div class="download-menu-container">
                      <button
                        class="download-button-small"
                        @click.stop="toggleDownloadMenu(`${entry.library.id}-ruleSets`)"
                        title="Download"
                      >
                        <Download :size="14" />
                      </button>
                      <div v-if="openDownloadMenu === `${entry.library.id}-ruleSets`" class="download-menu">
                        <button @click="handleDownloadRDF(entry.library.id, 'ruleSets')" class="menu-item">
                          Query Library RDF
                        </button>
                      </div>
                    </div>
                    <button
                      class="filter-button-small"
                      @click.stop="toggleFilter(`${entry.library.id}-ruleSets`)"
                      title="Filter Rule Sets"
                    >
                      <Search :size="12" />
                    </button>
                    <button class="add-button-small" @click="handleAddRuleSet(entry.library)" title="Add Rule Set">
                      <Plus :size="14" />
                    </button>
                  </div>
                </div>
                <!-- Filter input row -->
                <div v-show="activeFilter === `${entry.library.id}-ruleSets`" class="filter-input-row-small">
                  <input
                    v-model="filterText[`${entry.library.id}-ruleSets`]"
                    type="text"
                    placeholder="Filter rule sets..."
                    class="filter-input-small"
                    @keydown.escape="activeFilter = null"
                  />
                </div>
                <div v-show="expandedCategories[`${entry.library.id}-ruleSets`]" class="category-items">
                  <div v-if="entry.ruleSets.length === 0" class="category-empty">No rule sets yet.</div>
                  <div
                    v-for="ruleSet in entry.ruleSets"
                    :key="ruleSet.id"
                    class="item-row"
                  >
                    <button
                      class="item-button"
                      :class="{ selected: selectedItemId === ruleSet.id }"
                      @click="handleSelectItem(ruleSet)"
                    >
                      {{ ruleSet.name }}
                    </button>
                    <div class="item-download">
                      <button
                        class="download-icon-button"
                        @click.stop="handleDownloadItemRDF(ruleSet.id, 'ruleSet')"
                        title="Download Query Library RDF"
                      >
                        <Download :size="12" />
                      </button>
                    </div>
                  </div>
                </div>
                </template>

                <!-- Benchmarks Category -->
                <div v-if="benchmarksEnabled && showCategory('benchmarks')" class="subitem-category">
                  <button class="category-header" @click="navigateToBenchmarks">
                    <span>Benchmarks</span>
                  </button>
                </div>

              </div>
            </div>
            </template>
        </div>
      </section>

      <!-- Backends Section -->
      <section v-if="sectionVisibility.backends && backendsEnabled" class="nav-section">
        <div class="section-header">
          <button class="section-toggle" @click="toggleSection('backends')">
            <ChevronRight :size="14" class="arrow" :class="{ expanded: expandedSections.backends }" />
            <SectionLabel as="span" size="lg" class="section-title">Backends</SectionLabel>
          </button>
          <div class="section-actions">
            <button class="download-button" @click="handleDownloadAllBackends" title="Download All Backends RDF">
              <Download :size="16" />
            </button>
            <button class="filter-button" @click="toggleFilter('backends')" title="Filter Backends">
              <Search :size="16" />
            </button>
            <button class="add-button" @click="handleAddBackend" title="Add Backend">
              <Plus :size="16" />
            </button>
          </div>
        </div>

        <!-- Filter input row -->
        <div v-show="activeFilter === 'backends'" class="filter-input-row">
          <input
            v-model="filterText.backends"
            type="text"
            placeholder="Filter backends..."
            class="filter-input"
            @keydown.escape="activeFilter = null"
          />
        </div>

        <div v-show="expandedSections.backends" class="section-content">
          <div v-if="backendsLoading" class="section-message">Loading backends…</div>
          <div v-else-if="backendsError" class="section-message error">{{ backendsError }}</div>
          <div v-else-if="!anyBackends" class="section-message empty">No backends available.</div>
          <div
            v-else
            v-for="backend in filteredBackendEntries"
            :key="backend.id"
            class="backend-item"
          >
            <button
              class="backend-button"
              @click="handleSelectBackend(backend)"
            >
              <span class="backend-name">{{ backend.name }}</span>
              <div class="backend-actions">
                <button
                  class="edit-button-small"
                  @click.stop="handleEditBackend(backend.id, backend.name)"
                  title="Edit Backend"
                >
                  <Pencil :size="14" />
                </button>
                <button
                  class="download-button-small"
                  @click.stop="handleDownloadBackendRDF(backend.id)"
                  title="Download Backend RDF"
                >
                  <Download :size="14" />
                </button>
                <button
                  class="delete-button-small"
                  @click.stop="handleDeleteBackend(backend.id, backend.name)"
                  title="Delete Backend"
                >
                  <Trash2 :size="14" />
                </button>
              </div>
            </button>
          </div>
        </div>
      </section>
    </div>

  </aside>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { ChevronRight, PanelLeftClose, PanelLeftOpen, Plus, Download, Trash2, Pencil, Search } from '@lucide/vue';
import { useLibrariesStore } from '../composables/useLibrariesStore';
import { useQueriesStore } from '../composables/useQueriesStore';
import { useQueryGroupsStore } from '../composables/useQueryGroupsStore';
import { useRuleSetsStore } from '../composables/useRuleSetsStore';
import { useBackendsStore } from '../composables/useBackendsStore';
import { useFeatureFlags } from '../composables/useFeatureFlags';
import { useApiClient } from '../composables/useApiClient';
import { useSidebarCollapse } from '../composables/useSidebarCollapse';
import SectionLabel from './shared/SectionLabel.vue';
import { SYSTEM_GET_QUERIES_ID, SYSTEM_GET_RULES_ID } from '../lib/constants';
import { fuzzyMatches } from '../lib/fuzzy';
import {
  treeVisibilityFor,
  treeCategoriesFor,
  type RailSection,
  type TreeCategory,
} from '../lib/railSections';
import { LIBRARY_STORAGE_BACKEND_ID, OUTPUT_MEDIA_TYPES } from '@sparql-query-lib/types';
import type {
  Library as ApiLibrary,
  Query as ApiQuery,
  QueryGroup as ApiQueryGroup,
  RuleSet as ApiRuleSet,
  Backend as ApiBackend,
  ExecutionRequest,
} from '@sparql-query-lib/contracts';

const props = defineProps<{
  activeQueryId?: string | null;
  activeQueryGroupId?: string | null;
  activeRuleSetId?: string | null;
  refreshKey?: number;
  /** The nav rail's scope. Null renders the whole tree, as before the rail. */
  section?: RailSection | null;
}>();

const sectionVisibility = computed(() => treeVisibilityFor(props.section));
const sectionCategories = computed(() => treeCategoriesFor(props.section));

/** A null category list means "unscoped" — show every category. */
function showCategory(category: TreeCategory): boolean {
  const allowed = sectionCategories.value;
  return allowed === null || allowed.includes(category);
}

type ItemType = 'query' | 'queryGroup' | 'ruleSet' | 'benchmark';

interface NavigationItem {
  id: string;
  name: string;
  type: ItemType;
}

interface LibraryTree {
  library: ApiLibrary;
  queries: NavigationItem[];
  queryGroups: NavigationItem[];
  ruleSets: NavigationItem[];
}

const librariesStore = useLibrariesStore();
const queriesStore = useQueriesStore();
const queryGroupsStore = useQueryGroupsStore();
const ruleSetsStore = useRuleSetsStore();
const backendsStore = useBackendsStore();
const apiClient = useApiClient();
const { isEnabled: isFeatureEnabled } = useFeatureFlags();
const queriesEnabled = computed(() => isFeatureEnabled('queries'));
const queryGroupsEnabled = computed(() => isFeatureEnabled('queryGroups'));
const rulesSuiteEnabled = computed(() => isFeatureEnabled('rulesSuite'));
const benchmarksEnabled = computed(() => isFeatureEnabled('benchmarks'));
const backendsEnabled = computed(() => isFeatureEnabled('backends'));

const DEFAULT_RDF_ACCEPT = OUTPUT_MEDIA_TYPES.TURTLE;

function sanitizeFilename(value: string, fallback: string): string {
  const slug = value.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
  return slug || fallback;
}

async function downloadQueriesRdf(options: { queryId?: string; filename: string }) {
  const payload: ExecutionRequest = {
    targetId: SYSTEM_GET_QUERIES_ID,
    backendId: LIBRARY_STORAGE_BACKEND_ID,
  };

  if (options.queryId) {
    payload.arguments = [
      {
        head: { vars: ['query'] },
        arguments: {
          bindings: [{ query: { type: 'uri', value: options.queryId } }],
        },
      },
    ];
  }

  try {
    const { body, contentType } = await apiClient.executeTarget(payload, DEFAULT_RDF_ACCEPT);
    const blob = new Blob([body], { type: contentType || DEFAULT_RDF_ACCEPT });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = options.filename;
    link.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('[NavigationSidebar] Failed to download queries RDF', error);
  }
}

async function downloadRulesRdf(options: { filename: string }) {
  const payload: ExecutionRequest = {
    targetId: SYSTEM_GET_RULES_ID,
    backendId: LIBRARY_STORAGE_BACKEND_ID,
  };

  try {
    const { body, contentType } = await apiClient.executeTarget(payload, DEFAULT_RDF_ACCEPT);
    const blob = new Blob([body], { type: contentType || DEFAULT_RDF_ACCEPT });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = options.filename;
    link.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('[NavigationSidebar] Failed to download rules RDF', error);
  }
}

// Emits
const emit = defineEmits<{
  'item-selected': [item: NavigationItem];
  'create-query': [payload: { libraryId: string; libraryName: string }];
  'create-query-group': [payload: { libraryId: string; libraryName: string }];
  'create-ruleset': [payload: { libraryId: string; libraryName: string }];
  'create-library': [];
  'create-backend': [];
  'select-backend': [payload: { backendId: string; backendName: string }];
  'delete-library': [payload: { libraryId: string; libraryName: string }];
  'delete-backend': [payload: { backendId: string; backendName: string }];
  'edit-library': [payload: { libraryId: string; libraryName: string }];
  'edit-backend': [payload: { backendId: string; backendName: string }];
}>();

// State
/*
 * The unscoped tree folds the same way the section sidebars do, and remembers
 * it in the same place — one hinge behaviour across the app rather than three.
 */
const { collapsed, toggle: toggleCollapsed } = useSidebarCollapse('tree');
const selectedLibraryId = ref<string | null>(null);
const selectedItemId = ref<string | null>(null);

const expandedSections = reactive({
  libraries: true,
  backends: true,
});

const expandedLibraries = reactive<Record<string, boolean>>({});
const expandedCategories = reactive<Record<string, boolean>>({});
const openDownloadMenu = ref<string | null>(null);

// Filter state
const activeFilter = ref<string | null>(null);
const filterText = reactive<Record<string, string>>({});

const libraryTree = computed<LibraryTree[]>(() => {
  // The system library is only among them when Hofstadter mode is on.
  let libs = [...librariesStore.visibleLibraries.value].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

  const queries = queriesEnabled.value ? queriesStore.queries.value : [];
  const groups = queryGroupsEnabled.value ? queryGroupsStore.queryGroups.value : [];
  const ruleSets = rulesSuiteEnabled.value ? ruleSetsStore.ruleSets.value : [];

  const queriesByLibrary = new Map<string, ApiQuery[]>();
  const groupsByLibrary = new Map<string, ApiQueryGroup[]>();
  const ruleSetsByLibrary = new Map<string, ApiRuleSet[]>();

  libs.forEach((lib) => {
    queriesByLibrary.set(lib.id, []);
    groupsByLibrary.set(lib.id, []);
    ruleSetsByLibrary.set(lib.id, []);
  });

  queries.forEach((query) => {
    const memberships = Array.isArray(query.isPartOf) ? query.isPartOf : [];
    memberships.forEach((libraryId) => {
      if (!queriesByLibrary.has(libraryId)) {
        queriesByLibrary.set(libraryId, []);
      }
      queriesByLibrary.get(libraryId)!.push(query);
    });
  });

  groups.forEach((group) => {
    const libraryId = group.isPartOf;
    if (!libraryId) {
      return;
    }
    if (!groupsByLibrary.has(libraryId)) {
      groupsByLibrary.set(libraryId, []);
    }
    groupsByLibrary.get(libraryId)!.push(group);
  });

  ruleSets.forEach((ruleSet) => {
    const memberships = Array.isArray(ruleSet.isPartOf) ? ruleSet.isPartOf : [];
    memberships.forEach((libraryId) => {
      if (!ruleSetsByLibrary.has(libraryId)) {
        ruleSetsByLibrary.set(libraryId, []);
      }
      ruleSetsByLibrary.get(libraryId)!.push(ruleSet);
    });
  });

  // Helper to sort items by name
  const sortByName = <T extends { name: string }>(items: T[]) => {
    return items.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  };

  return libs.map((lib) => ({
    library: lib,
    queries: queriesEnabled.value
      ? sortByName(queriesByLibrary.get(lib.id) ?? []).map((query) => ({
          id: query.id,
          name: query.name,
          type: 'query' as const,
        }))
      : [],
    queryGroups: queryGroupsEnabled.value
      ? sortByName(groupsByLibrary.get(lib.id) ?? []).map((group) => ({
          id: group.id,
          name: group.name,
          type: 'queryGroup' as const,
        }))
      : [],
    ruleSets: rulesSuiteEnabled.value
      ? sortByName(ruleSetsByLibrary.get(lib.id) ?? []).map((ruleSet) => ({
          id: ruleSet.id,
          name: ruleSet.name,
          type: 'ruleSet' as const,
        }))
      : [],
  }));
});

/*
 * Every filter box in this tree matches the way the choosers do (`lib/fuzzy`):
 * fuzzy on the name, so "qgrp" finds "query-group smoke". A predicate rather
 * than a ranked list — the tree's order is the library's, and a filter here
 * prunes it rather than re-sorting it.
 */
const filteredLibraryTree = computed<LibraryTree[]>(() => {
  const tree = libraryTree.value.filter((entry) =>
    fuzzyMatches(filterText.libraries ?? '', entry.library.name),
  );

  // Apply category-level filters for each library
  return tree.map((entry) => {
    const queriesFilter = filterText[`${entry.library.id}-queries`] ?? '';
    const queryGroupsFilter = filterText[`${entry.library.id}-queryGroups`] ?? '';
    const ruleSetsFilter = filterText[`${entry.library.id}-ruleSets`] ?? '';

    return {
      ...entry,
      queries: entry.queries.filter((q) => fuzzyMatches(queriesFilter, q.name)),
      queryGroups: entry.queryGroups.filter((qg) => fuzzyMatches(queryGroupsFilter, qg.name)),
      ruleSets: entry.ruleSets.filter((rs) => fuzzyMatches(ruleSetsFilter, rs.name)),
    };
  });
});

// Filtered backend entries with text search applied
const filteredBackendEntries = computed(() =>
  backendEntries.value.filter((backend) => fuzzyMatches(filterText.backends ?? '', backend.name)),
);

const librariesLoading = computed(() => {
  if (librariesStore.loading.value) {
    return true;
  }
  if (queriesEnabled.value && queriesStore.loading.value) {
    return true;
  }
  if (queryGroupsEnabled.value && queryGroupsStore.loading.value) {
    return true;
  }
  if (rulesSuiteEnabled.value && ruleSetsStore.loading.value) {
    return true;
  }
  return false;
});

const librariesError = computed(() => {
  return (
    librariesStore.error.value
    ?? (queriesEnabled.value ? queriesStore.error.value : null)
    ?? (queryGroupsEnabled.value ? queryGroupsStore.error.value : null)
    ?? (rulesSuiteEnabled.value ? ruleSetsStore.error.value : null)
  );
});

const backendEntries = computed(() => backendsStore.backends.value);
const backendsLoading = computed(() => backendsStore.loading.value);
const backendsError = computed(() => backendsStore.error.value);

const queryToLibrary = ref<Record<string, string>>({});
const queryGroupToLibrary = ref<Record<string, string>>({});
const ruleSetToLibrary = ref<Record<string, string>>({});

const anyLibraries = computed(() => libraryTree.value.length > 0);
const anyBackends = computed(() => backendEntries.value.length > 0);

// Methods
function toggleSection(section: keyof typeof expandedSections) {
  expandedSections[section] = !expandedSections[section];
}

function toggleLibrary(libraryId: string) {
  expandedLibraries[libraryId] = !expandedLibraries[libraryId];
  selectedLibraryId.value = libraryId;
  selectedItemId.value = null;
}

function toggleCategory(libraryId: string, category: string) {
  const key = `${libraryId}-${category}`;
  expandedCategories[key] = !expandedCategories[key];
}

function toggleFilter(key: string) {
  if (activeFilter.value === key) {
    activeFilter.value = null;
  } else {
    activeFilter.value = key;
    // Initialize filter text if not exists
    if (!(key in filterText)) {
      filterText[key] = '';
    }
  }
}

function isFeatureTypeEnabled(type: ItemType): boolean {
  if (type === 'query') {
    return queriesEnabled.value;
  }
  if (type === 'queryGroup') {
    return queryGroupsEnabled.value;
  }
  if (type === 'ruleSet') {
    return rulesSuiteEnabled.value;
  }
  return true;
}

function getLibraryForItem(type: ItemType, id: string): string | null {
  switch (type) {
    case 'query':
      return queryToLibrary.value[id] ?? null;
    case 'queryGroup':
      return queryGroupToLibrary.value[id] ?? null;
    case 'ruleSet':
      return ruleSetToLibrary.value[id] ?? null;
    default:
      return null;
  }
}

function ensureItemVisible(type: ItemType, id: string | null | undefined) {
  if (!id || !isFeatureTypeEnabled(type)) {
    return;
  }
  const libraryId = getLibraryForItem(type, id);
  if (!libraryId) {
    selectedLibraryId.value = null;
    return;
  }
  const categoryKeyMap: Record<ItemType, string | null> = {
    query: 'queries',
    queryGroup: 'queryGroups',
    ruleSet: 'ruleSets',
    // Experiments are account-level and have no library category to expand.
    benchmark: null,
  };
  expandedLibraries[libraryId] = true;
  const categoryKey = categoryKeyMap[type];
  if (categoryKey) {
    expandedCategories[`${libraryId}-${categoryKey}`] = true;
  }
  selectedLibraryId.value = libraryId;
}

function syncSelectionWithActiveItem(type: ItemType, id: string | null | undefined) {
  if (!id || !isFeatureTypeEnabled(type)) {
    return;
  }
  ensureItemVisible(type, id);
  selectedItemId.value = id;
}

function handleSelectItem(item: NavigationItem) {
  if (!isFeatureTypeEnabled(item.type)) {
    console.warn('Ignoring selection for disabled feature', item);
    return;
  }
  ensureItemVisible(item.type, item.id);
  selectedItemId.value = item.id;
  emit('item-selected', item);
}

/*
 * A backend row is a door out of the tree, not a selection inside it: the
 * record lives on the Backends section, which replaces this sidebar the moment
 * the rail is scoped to it. That is what the pencil beside the row already did
 * ("there is no separate edit mode to open, because the record is the editor"),
 * so the row itself now goes to the same place rather than highlighting itself
 * and telling nobody. The tree keeps no backend selection for the same reason:
 * it is unmounted before it could draw one.
 */
function handleSelectBackend(backend: ApiBackend) {
  selectedLibraryId.value = null;
  selectedItemId.value = null;
  emit('select-backend', { backendId: backend.id, backendName: backend.name });
}


// Add handlers
function handleAddLibrary() {
  emit('create-library');
}

function handleAddQuery(library: ApiLibrary) {
  if (!queriesEnabled.value) {
    console.warn('Queries feature disabled; ignoring add query action.');
    return;
  }
  expandedLibraries[library.id] = true;
  expandedCategories[`${library.id}-queries`] = true;
  selectedLibraryId.value = library.id;
  selectedItemId.value = null;
  emit('create-query', { libraryId: library.id, libraryName: library.name });
}

function handleAddQueryGroup(library: ApiLibrary) {
  if (!queryGroupsEnabled.value) {
    console.warn('Query Groups feature disabled; ignoring add query group action.');
    return;
  }
  selectedLibraryId.value = library.id;
  selectedItemId.value = null;
  emit('create-query-group', { libraryId: library.id, libraryName: library.name });
}

function handleAddRuleSet(library: ApiLibrary) {
  if (!rulesSuiteEnabled.value) {
    console.warn('Rule Sets feature disabled; ignoring add rule set action.');
    return;
  }
  selectedLibraryId.value = library.id;
  selectedItemId.value = null;
  emit('create-ruleset', { libraryId: library.id, libraryName: library.name });
}

function handleAddBackend() {
  emit('create-backend');
}

// The Bench entry opens the screen, not an experiment — hence the empty id.
function navigateToBenchmarks() {
  emit('item-selected', { type: 'benchmark', id: '', name: 'Benchmarks' });
}

const loadLibrariesData = async () => {
  const tasks: Array<Promise<unknown>> = [librariesStore.loadLibraries()];
  if (queriesEnabled.value) {
    tasks.push(queriesStore.loadQueries());
  }
  if (queryGroupsEnabled.value) {
    tasks.push(queryGroupsStore.loadQueryGroups());
  }
  if (rulesSuiteEnabled.value) {
    tasks.push(ruleSetsStore.fetchRuleSets());
  }

  await Promise.all(tasks);
  await nextTick();
  if (queriesEnabled.value && props.activeQueryId) {
    syncSelectionWithActiveItem('query', props.activeQueryId);
  }
  if (queryGroupsEnabled.value && props.activeQueryGroupId) {
    syncSelectionWithActiveItem('queryGroup', props.activeQueryGroupId);
  }
  if (rulesSuiteEnabled.value && props.activeRuleSetId) {
    syncSelectionWithActiveItem('ruleSet', props.activeRuleSetId);
  }
};

const loadBackendsData = async () => {
  if (!backendsEnabled.value) {
    return;
  }
  await backendsStore.loadBackends();
};

watch(
  libraryTree,
  (entries) => {
    const newQueryMap: Record<string, string> = {};
    const newQueryGroupMap: Record<string, string> = {};
    const newRuleSetMap: Record<string, string> = {};
    const existingIds = new Set<string>();

    for (const entry of entries) {
      existingIds.add(entry.library.id);
      for (const query of entry.queries) {
        newQueryMap[query.id] = entry.library.id;
      }
      for (const queryGroup of entry.queryGroups) {
        newQueryGroupMap[queryGroup.id] = entry.library.id;
      }
      for (const ruleSet of entry.ruleSets) {
        newRuleSetMap[ruleSet.id] = entry.library.id;
      }
    }

    queryToLibrary.value = newQueryMap;
    queryGroupToLibrary.value = newQueryGroupMap;
    ruleSetToLibrary.value = newRuleSetMap;

    Object.keys(expandedLibraries).forEach((key) => {
      if (!existingIds.has(key)) {
        delete expandedLibraries[key];
      }
    });
    Object.keys(expandedCategories).forEach((key) => {
      const [libraryId] = key.split('-');
      if (!existingIds.has(libraryId)) {
        delete expandedCategories[key];
      }
    });
  },
  { immediate: true },
);

onMounted(() => {
  loadLibrariesData();
  loadBackendsData();
  if (typeof window !== 'undefined') {
    window.addEventListener('click', handleClickOutside);
  }
});

watch(
  () => props.refreshKey,
  () => {
    loadLibrariesData();
  },
);

watch(
  () => props.activeQueryId,
  (id) => {
    if (id && queriesEnabled.value) {
      syncSelectionWithActiveItem('query', id);
    }
  },
  { immediate: true },
);

watch(
  () => props.activeQueryGroupId,
  (id) => {
    if (id && queryGroupsEnabled.value) {
      syncSelectionWithActiveItem('queryGroup', id);
    }
  },
  { immediate: true },
);

watch(
  () => props.activeRuleSetId,
  (id) => {
    if (id && rulesSuiteEnabled.value) {
      syncSelectionWithActiveItem('ruleSet', id);
    }
  },
  { immediate: true },
);

onUnmounted(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('click', handleClickOutside);
  }
});

// Download menu handlers
function toggleDownloadMenu(categoryKey: string) {
  if (openDownloadMenu.value === categoryKey) {
    openDownloadMenu.value = null;
  } else {
    openDownloadMenu.value = categoryKey;
  }
}

/*
 * Downloads with nothing behind them.
 *
 * Six of the sidebar's download controls, and the fallback arm of two more,
 * were written as a `console.log` and a `TODO`. That is not an implementation:
 * clicking one has always done nothing, and the trace was the only record of
 * it — visible to whoever wrote it and to nobody since. The trace goes with
 * the rest of the sweep and the record moves to
 * `test/components/navigationSidebarDownloads.test.ts`, which holds the
 * inventory: a seventh cannot be added quietly, and implementing one empties
 * an entry.
 *
 * The controls themselves stay. Whether a download this build cannot do should
 * be absent, disabled or built is a decision about the product rather than
 * about traces, and it is the same question the run bar answered one way for a
 * switched-off feature (`docs/reference/feature-flags.md`) — worth taking
 * deliberately rather than as a side effect of deleting a log line.
 */

// Top-level downloads
function handleDownloadAllLibraries() {
  // Unbuilt: no route writes a whole-library-set dump yet.
}

function handleDownloadAllBackends() {
  // Unbuilt: no route writes a whole-backend-set dump yet.
}

// Library-level downloads
function handleDownloadLibraryRDF(_libraryId: string) {
  // Unbuilt: `downloadQueriesRdf`/`downloadRulesRdf` cover categories, not a
  // whole library.
}

// Library edit
function handleEditLibrary(libraryId: string, libraryName: string) {
  emit('edit-library', { libraryId, libraryName });
}

// Library delete
function handleDeleteLibrary(libraryId: string, libraryName: string) {
  emit('delete-library', { libraryId, libraryName });
}

// Backend delete
function handleDeleteBackend(backendId: string, backendName: string) {
  emit('delete-backend', { backendId, backendName });
}

// Category-level downloads (gzip of multiple items)
function handleDownloadRDF(libraryId: string, category: string) {
  if (category === 'queries') {
    const filename = `queries-${sanitizeFilename(libraryId, 'library')}.ttl`;
    downloadQueriesRdf({ filename }).finally(() => {
      openDownloadMenu.value = null;
    });
    return;
  }
  if (category === 'ruleSets') {
    const filename = `rules-${sanitizeFilename(libraryId, 'library')}.ttl`;
    downloadRulesRdf({ filename }).finally(() => {
      openDownloadMenu.value = null;
    });
    return;
  }
  // Unbuilt for every other category; the menu closes and nothing is written.
  openDownloadMenu.value = null;
}

function handleDownloadAssets(_libraryId: string, _category: string) {
  // Unbuilt: no route bundles a category's assets.
  openDownloadMenu.value = null;
}

// Individual item downloads
function handleDownloadItemRDF(itemId: string, itemType: string) {
  if (itemType === 'query') {
    const filename = `query-${sanitizeFilename(itemId, 'query')}.ttl`;
    downloadQueriesRdf({ queryId: itemId, filename }).finally(() => {
      openDownloadMenu.value = null;
    });
    return;
  }
  // Unbuilt for every other item type; the menu closes and nothing is written.
  openDownloadMenu.value = null;
}

function handleDownloadQuery(_queryId: string) {
  // Unbuilt: nothing writes the query's own `.sparql` file.
  openDownloadMenu.value = null;
}

// Backend edit
function handleEditBackend(backendId: string, backendName: string) {
  emit('edit-backend', { backendId, backendName });
}

// Backend downloads
function handleDownloadBackendRDF(_backendId: string) {
  // Unbuilt: no route writes a backend's RDF.
}

// Close download menu when clicking outside
function handleClickOutside(event: MouseEvent) {
  const target = event.target as HTMLElement;
  if (!target.closest('.download-menu-container')) {
    openDownloadMenu.value = null;
  }
}
</script>

<style scoped>
.nav-sidebar {
  width: 280px;
  height: 100vh;
  background: var(--surface-subtle);
  border-right: 1px solid var(--border-default);
  display: flex;
  flex-direction: column;
  transition: width 0.3s ease;
  overflow: hidden;
}

.nav-sidebar.collapsed {
  width: 48px;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-5);
  border-bottom: 1px solid var(--border-default);
  background: var(--surface);
  min-height: 48px;
}

.nav-sidebar.collapsed .sidebar-header {
  justify-content: center;
}

.sidebar-title {
  font-size: var(--text-content);
  font-weight: 600;
  margin: 0;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.collapse-toggle {
  background: none;
  border: none;
  cursor: pointer;
  padding: var(--space-2) var(--space-4);
  font-size: var(--text-title);
  color: var(--ink-muted);
  border-radius: var(--radius);
  transition: background-color 0.2s;
  flex-shrink: 0;
}

.collapse-toggle:hover {
  background: var(--surface-raised);
  color: var(--ink);
}

.sidebar-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}

/* Sections */
.nav-section {
  border-bottom: 1px solid var(--border-default);
  padding: var(--space-4) 0;
}

.nav-section:first-of-type {
  padding-top: var(--space-1);
}

.section-header {
  display: flex;
  align-items: center;
  padding: var(--space-2) var(--space-4);
  gap: 4px;
}

.section-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.section-header:hover .download-button {
  opacity: 1;
}

.section-toggle {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: var(--space-3) var(--space-4);
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
  border-radius: var(--radius);
  transition: background-color 0.2s;
}

.section-toggle:hover {
  background: var(--surface-raised);
}

/*
 * Sizing comes from the ChevronRight :size prop (14, or 12 for .small). The
 * font-size/width/text-align here are left over from when this was a text
 * glyph; on an <svg> the hard width just squeezed the icon narrower than it is
 * tall (14px icon in a 12px box).
 */
.arrow {
  display: inline-block;
  transition: transform 0.2s;
  color: var(--ink-muted);
}

.arrow.expanded {
  transform: rotate(90deg);
}

.add-button {
  width: 24px;
  height: 24px;
  padding: 0;
  background: var(--surface-raised);
  border: none;
  border-radius: 50%;
  cursor: pointer;
  font-size: var(--text-title);
  font-weight: 600;
  color: var(--ink-secondary);
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  flex-shrink: 0;
}

.add-button:hover {
  background: var(--action);
  color: var(--action-fg);
  transform: scale(1.1);
}

.download-button {
  width: 24px;
  height: 24px;
  padding: 0;
  background: var(--surface-raised);
  border: none;
  border-radius: 50%;
  cursor: pointer;
  color: var(--ink-secondary);
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  flex-shrink: 0;
  opacity: 0;
}

.download-button:hover {
  background: var(--success);
  color: var(--success-fg);
  transform: scale(1.1);
}

.add-button-small {
  width: 18px;
  height: 18px;
  padding: 0;
  background: var(--surface-raised);
  border: none;
  border-radius: 50%;
  cursor: pointer;
  font-size: var(--text-body);
  font-weight: 600;
  color: var(--ink-secondary);
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  flex-shrink: 0;
}

.add-button-small:hover {
  background: var(--action);
  color: var(--action-fg);
  transform: scale(1.1);
}

.download-button-small {
  width: 18px;
  height: 18px;
  padding: 0;
  background: var(--surface-raised);
  border: none;
  border-radius: 50%;
  cursor: pointer;
  color: var(--ink-secondary);
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  flex-shrink: 0;
  opacity: 0;
}

.download-button-small:hover {
  background: var(--success);
  color: var(--success-fg);
  transform: scale(1.1);
}

.edit-button-small {
  width: 18px;
  height: 18px;
  padding: 0;
  background: var(--surface-raised);
  border: none;
  border-radius: 50%;
  cursor: pointer;
  color: var(--ink-secondary);
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  flex-shrink: 0;
  opacity: 0;
}

.edit-button-small:hover {
  background: var(--warning);
  color: var(--ink);
  transform: scale(1.1);
}

.delete-button-small {
  width: 18px;
  height: 18px;
  padding: 0;
  background: var(--surface-raised);
  border: none;
  border-radius: 50%;
  cursor: pointer;
  color: var(--ink-secondary);
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  flex-shrink: 0;
  opacity: 0;
}

.delete-button-small:hover {
  background: var(--danger);
  color: var(--danger-fg);
  transform: scale(1.1);
}

.download-menu-container {
  position: relative;
}

.download-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  background: var(--surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  z-index: 1000;
  min-width: 180px;
  overflow: hidden;
}

.download-menu .menu-item {
  width: 100%;
  padding: var(--space-4) var(--space-5);
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
  font-size: var(--text-body);
  color: var(--ink);
  transition: background-color 0.15s;
  display: block;
}

.download-menu .menu-item:hover {
  background: var(--surface-subtle);
}

.download-menu .menu-item:active {
  background: var(--surface-raised);
}

.section-content {
  padding: var(--space-1) 0;
}

.section-message {
  padding: var(--space-5) var(--space-6);
  font-size: var(--text-body-lg);
  color: var(--ink-muted);
}

.section-message.error {
  color: var(--danger-ink);
}

.section-message.empty {
  color: var(--ink-muted);
  font-style: italic;
}

/* Library Items */
.library-item {
  margin-bottom: var(--space-2);
}

.library-header {
  position: relative;
  padding-right: var(--space-4);
}

.library-toggle {
  width: 100%;
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: var(--space-3) var(--space-5) var(--space-3) var(--space-7);
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
  border-radius: var(--radius);
  transition: background-color 0.2s;
}

.library-actions {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  gap: 4px;
  background: linear-gradient(to right, transparent 0%, var(--surface-subtle) 20%, var(--surface-subtle) 100%);
  padding-left: var(--space-6);
  pointer-events: none;
}

.library-actions button {
  pointer-events: auto;
}

.library-toggle:hover .library-actions {
  background: linear-gradient(to right, transparent 0%, var(--surface-raised) 20%, var(--surface-raised) 100%);
}

.library-toggle.selected .library-actions {
  background: linear-gradient(to right, transparent 0%, var(--action-surface) 20%, var(--action-surface) 100%);
}

.library-toggle.selected:hover .library-actions {
  background: linear-gradient(to right, transparent 0%, var(--action-surface) 20%, var(--action-surface) 100%);
}

.library-toggle:hover .edit-button-small,
.library-toggle:hover .download-button-small,
.library-toggle:hover .delete-button-small {
  opacity: 1;
}

.library-toggle:hover {
  background: var(--surface-raised);
}

.library-toggle.selected {
  background: var(--action-surface);
  font-weight: 600;
}

.item-name {
  font-size: var(--text-body-lg);
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Library Subitems */
.library-subitems {
  padding-left: var(--space-7);
  margin-top: var(--space-2);
}

.subitem-category {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: var(--space-3);
}

.category-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.subitem-category:hover .download-button-small {
  opacity: 1;
}

.category-header {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: var(--space-2) var(--space-4);
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
  border-radius: var(--radius-sm);
  transition: background-color 0.2s;
  font-size: var(--text-body);
  color: var(--ink-muted);
  font-weight: 500;
}

.category-header:hover {
  background: var(--surface-raised);
  color: var(--ink-secondary);
}

.category-items {
  padding-left: var(--space-6);
  margin-top: var(--space-1);
}

.category-empty {
  padding: var(--space-3) 0;
  font-size: var(--text-body);
  color: var(--ink-muted);
}

.item-row {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: var(--space-1);
}

.item-row:hover .item-download {
  opacity: 1;
}

.item-button {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: var(--space-2) var(--space-4);
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
  border-radius: var(--radius-sm);
  transition: background-color 0.2s;
  font-size: var(--text-body);
  color: var(--ink-secondary);
  overflow: hidden;
}

.item-button:hover {
  background: var(--surface-raised);
}

.item-button.selected {
  background: var(--action-surface);
  color: var(--action-ink);
  font-weight: 500;
}

.item-download {
  position: relative;
  opacity: 0;
  transition: opacity 0.2s;
}

.download-icon-button {
  width: 16px;
  height: 16px;
  padding: 0;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--ink-muted);
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
}

.download-icon-button:hover {
  color: var(--success);
  background: var(--surface-subtle);
}

/* Backend Buttons */
.backend-item {
  position: relative;
  margin-bottom: var(--space-1);
  padding-right: var(--space-4);
}

.backend-button {
  width: 100%;
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: var(--space-2) var(--space-4);
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
  border-radius: var(--radius-sm);
  transition: background-color 0.2s;
  font-size: var(--text-body);
  color: var(--ink-secondary);
}

.backend-button:hover {
  background: var(--surface-raised);
}

.backend-actions {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  gap: 4px;
  background: linear-gradient(to right, transparent 0%, var(--surface-subtle) 20%, var(--surface-subtle) 100%);
  padding-left: var(--space-6);
  pointer-events: none;
}

.backend-actions button {
  pointer-events: auto;
}

.backend-button:hover .backend-actions {
  background: linear-gradient(to right, transparent 0%, var(--surface-raised) 20%, var(--surface-raised) 100%);
}

.backend-button:hover .edit-button-small,
.backend-button:hover .download-button-small,
.backend-button:hover .delete-button-small {
  opacity: 1;
}

.backend-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Scrollbar styling */
.sidebar-content::-webkit-scrollbar {
  width: 6px;
}

.sidebar-content::-webkit-scrollbar-track {
  background: transparent;
}

.sidebar-content::-webkit-scrollbar-thumb {
  background: var(--surface-raised);
  border-radius: var(--radius-sm);
}

.sidebar-content::-webkit-scrollbar-thumb:hover {
  background: var(--gray-500);
}

/* Filter Buttons */
.filter-button {
  width: 24px;
  height: 24px;
  padding: 0;
  background: var(--surface-raised);
  border: none;
  border-radius: 50%;
  cursor: pointer;
  color: var(--ink-secondary);
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  flex-shrink: 0;
  opacity: 0;
}

.section-header:hover .filter-button {
  opacity: 1;
}

.filter-button:hover {
  background: var(--action);
  color: var(--action-fg);
  transform: scale(1.1);
}

.filter-button-small {
  width: 18px;
  height: 18px;
  padding: 0;
  background: var(--surface-raised);
  border: none;
  border-radius: 50%;
  cursor: pointer;
  color: var(--ink-secondary);
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  flex-shrink: 0;
  opacity: 0;
}

.subitem-category:hover .filter-button-small {
  opacity: 1;
}

.filter-button-small:hover {
  background: var(--action);
  color: var(--action-fg);
  transform: scale(1.1);
}

/* Filter Input Rows */
.filter-input-row {
  padding: var(--space-4);
  border-top: 1px solid var(--border-subtle);
  background: var(--surface-subtle);
  animation: slideDown 0.2s ease-out;
}

.filter-input-row-small {
  padding: var(--space-3) var(--space-4);
  margin-left: var(--space-7);
  border-top: 1px solid var(--border-subtle);
  background: var(--surface-subtle);
  animation: slideDown 0.2s ease-out;
}

@keyframes slideDown {
  from {
    max-height: 0;
    opacity: 0;
    padding-top: 0;
    padding-bottom: 0;
  }
  to {
    max-height: 50px;
    opacity: 1;
  }
}

.filter-input,
.filter-input-small {
  width: 100%;
  padding: var(--space-3) var(--space-4);
  font-size: var(--text-body);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink);
  transition: border-color 0.2s;
  font-family: inherit;
}

.filter-input:focus,
.filter-input-small:focus {
  outline: none;
  border-color: var(--action);
  box-shadow: 0 0 0 2px rgba(13, 110, 253, 0.15);
}

.filter-input::placeholder,
.filter-input-small::placeholder {
  color: var(--ink-muted);
  opacity: 0.7;
}
</style>
