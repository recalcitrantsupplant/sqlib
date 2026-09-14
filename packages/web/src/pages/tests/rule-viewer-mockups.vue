<template>
  <div class="page-shell">
    <header class="page-header">
      <div>
        <h1>Rule & Data Block Viewer Mockups</h1>
        <p>
          Visual design variations for the collapsible rule and data block viewer component.
          Toggle between different design options to find the best UX.
        </p>
      </div>
      <span class="active-style" aria-live="polite">
        <strong>Active Style:</strong>
        <code>{{ activeStyle.label }}</code>
      </span>
    </header>

    <section>
      <div class="toolbar" role="toolbar" aria-label="Design variations">
        <button
          v-for="style in styles"
          :key="style.id"
          type="button"
          class="toolbar-button"
          :class="{ 'is-active': style.id === activeStyle.id }"
          :title="style.description"
          :aria-pressed="style.id === activeStyle.id"
          @click="setStyle(style)"
        >
          {{ style.label }}
        </button>
      </div>

      <div class="viewer-wrapper" :class="`style-${activeStyle.id}`">
        <div class="viewer-section">
          <h3 class="section-title">Data Blocks</h3>
          <div
            v-for="dataBlock in mockDataBlocks"
            :key="dataBlock.id"
            class="viewer-item"
            :class="{ 'is-expanded': expandedItems[dataBlock.id] }"
          >
            <!-- Collapsed state: show name and code preview -->
            <div
              v-if="!expandedItems[dataBlock.id]"
              class="item-collapsed"
            >
              <div
                class="collapsed-header"
                @click="toggleItem(dataBlock.id)"
                role="button"
                :aria-expanded="false"
                tabindex="0"
                @keydown.enter="toggleItem(dataBlock.id)"
                @keydown.space.prevent="toggleItem(dataBlock.id)"
              >
                <component :is="activeStyle.icon" class="toggle-icon" />
                <span class="item-name">{{ dataBlock.name }}</span>
              </div>
              <div class="collapsed-preview">
                <div class="preview-content">
                  <Codemirror
                    :model-value="getPreviewCode(dataBlock.code)"
                    :style="{ height: 'auto', width: '100%' }"
                    :extensions="previewExtensions"
                  />
                  <div class="preview-fade"></div>
                </div>
              </div>
              <div class="item-actions-right">
                <button
                  class="btn-remove"
                  title="Remove data block"
                  @click.stop="removeItem(dataBlock.id)"
                >
                  <X :size="16" />
                </button>
              </div>
            </div>

            <!-- Expanded state: title on left, codemirror fills middle, remove on right -->
            <div v-else class="item-expanded">
              <div class="item-header-left">
                <div
                  class="header-toggle"
                  @click="toggleItem(dataBlock.id)"
                  role="button"
                  :aria-expanded="true"
                  tabindex="0"
                  @keydown.enter="toggleItem(dataBlock.id)"
                  @keydown.space.prevent="toggleItem(dataBlock.id)"
                >
                  <component :is="activeStyle.icon" class="toggle-icon" />
                  <span class="item-name">{{ dataBlock.name }}</span>
                </div>
              </div>
              <div class="item-content">
                <Codemirror
                  :model-value="dataBlock.code"
                  :style="{ height: '200px', width: '100%' }"
                  :extensions="extensions"
                  :read-only="true"
                />
              </div>
              <div class="item-actions-right">
                <button
                  class="btn-remove"
                  title="Remove data block"
                  @click.stop="removeItem(dataBlock.id)"
                >
                  <X :size="16" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="viewer-section">
          <h3 class="section-title">Rules</h3>
          <div
            v-for="rule in mockRules"
            :key="rule.id"
            class="viewer-item"
            :class="{ 'is-expanded': expandedItems[rule.id] }"
          >
            <!-- Collapsed state: show name and code preview -->
            <div
              v-if="!expandedItems[rule.id]"
              class="item-collapsed"
            >
              <div
                class="collapsed-header"
                @click="toggleItem(rule.id)"
                role="button"
                :aria-expanded="false"
                tabindex="0"
                @keydown.enter="toggleItem(rule.id)"
                @keydown.space.prevent="toggleItem(rule.id)"
              >
                <component :is="activeStyle.icon" class="toggle-icon" />
                <span class="item-name">{{ rule.name }}</span>
              </div>
              <div class="collapsed-preview">
                <div class="preview-content">
                  <Codemirror
                    :model-value="getPreviewCode(rule.code)"
                    :style="{ height: 'auto', width: '100%' }"
                    :extensions="previewExtensions"
                  />
                  <div class="preview-fade"></div>
                </div>
              </div>
              <div class="item-actions-right">
                <button
                  class="btn-remove"
                  title="Remove rule"
                  @click.stop="removeItem(rule.id)"
                >
                  <X :size="16" />
                </button>
              </div>
            </div>

            <!-- Expanded state: title on left, codemirror fills middle, remove on right -->
            <div v-else class="item-expanded">
              <div class="item-header-left">
                <div
                  class="header-toggle"
                  @click="toggleItem(rule.id)"
                  role="button"
                  :aria-expanded="true"
                  tabindex="0"
                  @keydown.enter="toggleItem(rule.id)"
                  @keydown.space.prevent="toggleItem(rule.id)"
                >
                  <component :is="activeStyle.icon" class="toggle-icon" />
                  <span class="item-name">{{ rule.name }}</span>
                </div>
              </div>
              <div class="item-content">
                <Codemirror
                  :model-value="rule.code"
                  :style="{ height: '200px', width: '100%' }"
                  :extensions="extensions"
                  :read-only="true"
                />
              </div>
              <div class="item-actions-right">
                <button
                  class="btn-remove"
                  title="Remove rule"
                  @click.stop="removeItem(rule.id)"
                >
                  <X :size="16" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <footer class="page-footer">
      <div class="description-card">
        <h4>{{ activeStyle.label }}</h4>
        <p>{{ activeStyle.description }}</p>
        <ul>
          <li v-for="feature in activeStyle.features" :key="feature">{{ feature }}</li>
        </ul>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, shallowRef, computed } from 'vue';
import type { Component } from 'vue';
import { ChevronRight, ChevronDown, ChevronsDownUp, Plus, X } from '@lucide/vue';
import { Codemirror } from 'vue-codemirror';
import { languageExtensionsFor } from '@/lib/codeLanguage';
import { EditorView } from '@codemirror/view';

type StyleVariant = {
  id: string;
  label: string;
  description: string;
  features: string[];
  icon: Component;
};

const styles: StyleVariant[] = [
  {
    id: 'chevron-right',
    label: 'Chevron Right (Current)',
    description: 'The current implementation with a rotating chevron',
    features: [
      'ChevronRight icon rotates 90deg when expanded',
      'Icon positioned on the left',
      'Clean, minimalist appearance'
    ],
    icon: ChevronRight,
  },
  {
    id: 'chevron-down',
    label: 'Chevron Down/Up',
    description: 'Alternating chevron pointing down when collapsed, up when expanded',
    features: [
      'ChevronDown when collapsed, ChevronUp when expanded (via transform)',
      'More explicit directional cue',
      'Common in file explorers and sidebars'
    ],
    icon: ChevronDown,
  },
  {
    id: 'plus-minus',
    label: 'Plus/Minus',
    description: 'Plus icon when collapsed, minus when expanded',
    features: [
      'Plus icon to expand, Minus icon to collapse',
      'Very clear expand/collapse semantics',
      'Familiar from tree views and accordions'
    ],
    icon: Plus,
  },
  {
    id: 'expand-collapse',
    label: 'Expand/Collapse Icon',
    description: 'Dedicated expand/collapse icon',
    features: [
      'ChevronsDownUp icon that visually represents the action',
      'Modern, distinctive appearance',
      'Less ambiguous than single chevron'
    ],
    icon: ChevronsDownUp,
  },
];

const mockDataBlocks = [
  {
    id: 'db1',
    name: 'Person Schema',
    preview: 'PREFIX schema: <http://schema.org/>...',
    code: `PREFIX schema: <http://schema.org/>
PREFIX ex: <https://example.com/>

CONSTRUCT {
  ?person a schema:Person ;
          schema:name ?name ;
          schema:email ?email .
}
WHERE {
  ?person a ex:PersonEntity ;
          ex:fullName ?name ;
          ex:emailAddress ?email .
}`,
  },
  {
    id: 'db2',
    name: 'Organization Data',
    preview: 'SELECT ?org ?name WHERE {...',
    code: `PREFIX schema: <http://schema.org/>
PREFIX ex: <https://example.com/>

SELECT ?org ?name ?location
WHERE {
  ?org a schema:Organization ;
       schema:name ?name ;
       schema:location ?location .
  FILTER(LANG(?name) = "en")
}
ORDER BY ?name`,
  },
];

const mockRules = [
  {
    id: 'rule1',
    name: 'Validate Email Format',
    preview: 'CONSTRUCT { ?person ex:hasValidEmail...',
    code: `PREFIX ex: <https://example.com/>
PREFIX schema: <http://schema.org/>

CONSTRUCT {
  ?person ex:hasValidEmail true .
}
WHERE {
  ?person a schema:Person ;
          schema:email ?email .
  FILTER(REGEX(?email, "^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\\\.[a-zA-Z]{2,}$"))
}`,
  },
  {
    id: 'rule2',
    name: 'Calculate Age from BirthDate',
    preview: 'CONSTRUCT { ?person ex:age ?age...',
    code: `PREFIX ex: <https://example.com/>
PREFIX schema: <http://schema.org/>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

CONSTRUCT {
  ?person ex:age ?age .
}
WHERE {
  ?person a schema:Person ;
          schema:birthDate ?birthDate .
  BIND(YEAR(NOW()) - YEAR(?birthDate) AS ?age)
}`,
  },
  {
    id: 'rule3',
    name: 'Infer Organization Membership',
    preview: 'CONSTRUCT { ?person schema:memberOf...',
    code: `PREFIX schema: <http://schema.org/>
PREFIX ex: <https://example.com/>

CONSTRUCT {
  ?person schema:memberOf ?org .
}
WHERE {
  ?person ex:worksAt ?org .
  ?org a schema:Organization .
}`,
  },
];

const activeStyle = ref<StyleVariant>(styles[0]);
const expandedItems = reactive<Record<string, boolean>>({});

// Extensions for expanded editors (read-only, no folding)
const extensions = shallowRef([
  ...languageExtensionsFor('application/sparql-query'),
  EditorView.editable.of(false),
  EditorView.lineWrapping,
  EditorView.theme({
    '.cm-gutters': {
      display: 'none', // Hide gutter to match preview
    },
  })
]);

// Preview extensions with matching style
const previewExtensions = shallowRef([
  ...languageExtensionsFor('application/sparql-query'),
  EditorView.editable.of(false),
  EditorView.lineWrapping,
  EditorView.theme({
    '.cm-scroller': {
      overflow: 'hidden',
    },
    '.cm-gutters': {
      display: 'none', // Hide gutter (no line numbers or fold controls)
    },
  })
]);

// Filter out PREFIX lines and get first 3 non-empty lines for preview
const getPreviewCode = (code: string | undefined): string => {
  if (!code) return '';

  const lines = code.split('\n');
  const nonPrefixLines = lines
    .filter(line => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !trimmed.startsWith('PREFIX');
    })
    .slice(0, 3); // Take first 3 non-prefix lines

  return nonPrefixLines.join('\n') || '-- No preview available';
};

const setStyle = (style: StyleVariant) => {
  activeStyle.value = style;
};

const toggleItem = (id: string) => {
  expandedItems[id] = !expandedItems[id];
};

/*
 * A no-op on purpose: this page draws four style variants of the rule viewer
 * over fixed sample data, and the row's delete button is part of the chrome
 * being compared. Removing the row would leave the variants showing different
 * data, which is the one thing a mockup page must not do.
 */
const removeItem = (_id: string) => {};
</script>

<style scoped>
.page-shell {
  display: flex;
  flex-direction: column;
  gap: 2rem;
  padding: var(--space-8) var(--space-7) var(--space-9);
  max-width: 1200px;
  margin: 0 auto;
  color: var(--ink);
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem 1.5rem;
  flex-wrap: wrap;
}

.page-header h1 {
  margin: 0 0 var(--space-4);
  font-size: var(--text-hero-fluid);
}

.page-header p {
  margin: 0;
  color: var(--ink-secondary);
  max-width: 640px;
}

.active-style {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: var(--space-3) var(--space-5);
  border-radius: var(--radius-lg);
  border: 1px dashed var(--border-strong);
  background: var(--action-surface);
  font-size: var(--text-content);
}

.active-style code {
  background: rgba(129, 140, 248, 0.15);
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-panel);
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: var(--space-7);
}

.toolbar-button {
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  padding: var(--space-4) var(--space-6);
  background: var(--action-surface);
  color: inherit;
  font: inherit;
  cursor: pointer;
  transition: background-color 0.2s ease, border-color 0.2s ease, transform 0.2s ease;
}

.toolbar-button:hover {
  background: var(--action-surface);
}

.toolbar-button.is-active {
  border-color: var(--violet-500);
  background: var(--action-surface);
  font-weight: 600;
  transform: translateY(-1px);
}

.viewer-wrapper {
  border-radius: var(--radius-xl);
  overflow: hidden;
  border: 1px solid var(--border-default);
  background: var(--surface);
  padding: var(--space-7);
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.viewer-section {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.section-title {
  font-size: var(--text-content);
  font-weight: 600;
  color: var(--ink-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0;
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
}

/* ============================================
   STYLE VARIANT: Chevron Right (Current)
   ============================================ */
.style-chevron-right .viewer-item {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-panel);
  overflow: hidden;
  background: var(--surface-subtle);
}

/* Collapsed state */
.style-chevron-right .item-collapsed {
  display: flex;
  align-items: stretch;
  background: var(--surface);
}

.style-chevron-right .collapsed-header {
  width: 20%;
  min-width: 180px;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: var(--space-5) var(--space-6);
  background: var(--surface);
  border-right: 1px solid var(--border-default);
  cursor: pointer;
  user-select: none;
  transition: background-color 0.2s;
  flex-shrink: 0;
}

.style-chevron-right .collapsed-header:hover {
  background: var(--surface-subtle);
}

.style-chevron-right .collapsed-preview {
  width: calc(80% - 60px); /* Total minus header minus button */
  background: var(--surface-subtle);
  overflow: hidden;
  display: flex;
  align-items: center;
  position: relative;
}

.style-chevron-right .preview-content {
  width: 100%;
  position: relative;
  max-height: 70px;
  overflow: hidden;
}

.style-chevron-right .preview-fade {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 30px;
  background: linear-gradient(to bottom, transparent, var(--surface-subtle));
  pointer-events: none;
}

/* Expanded state - horizontal layout */
.style-chevron-right .item-expanded {
  display: flex;
  align-items: stretch;
  min-height: 200px;
}

.style-chevron-right .item-header-left {
  width: 20%;
  min-width: 180px;
  flex-shrink: 0;
  background: var(--surface);
  border-right: 1px solid var(--border-default);
  display: flex;
  align-items: flex-start;
  padding: var(--space-5) var(--space-6);
}

.style-chevron-right .header-toggle {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  cursor: pointer;
  user-select: none;
}

.style-chevron-right .item-actions-right {
  width: 60px;
  flex-shrink: 0;
  background: var(--surface);
  border-left: 1px solid var(--border-default);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: var(--space-5) var(--space-4);
}

.style-chevron-right .toggle-icon {
  color: var(--ink-muted);
  transition: transform 0.2s;
  flex-shrink: 0;
}

.style-chevron-right .is-expanded .toggle-icon {
  transform: rotate(90deg);
}

.style-chevron-right .item-name {
  font-size: var(--text-content);
  font-weight: 500;
  color: var(--ink);
  word-wrap: break-word;
}

/* ============================================
   STYLE VARIANT: Chevron Down/Up
   ============================================ */
.style-chevron-down .viewer-item {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  overflow: hidden;
  background: var(--surface);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

/* Collapsed state */
.style-chevron-down .item-collapsed {
  display: flex;
  align-items: stretch;
  background: var(--surface);
}

.style-chevron-down .collapsed-header {
  width: 20%;
  min-width: 180px;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: var(--space-6);
  background: linear-gradient(to bottom, var(--surface), var(--surface-subtle));
  border-right: 1px solid var(--border-default);
  cursor: pointer;
  user-select: none;
  transition: background-color 0.2s;
  flex-shrink: 0;
}

.style-chevron-down .collapsed-header:hover {
  background: var(--surface-subtle);
}

.style-chevron-down .collapsed-preview {
  width: calc(80% - 60px); /* Total minus header minus button */
  background: var(--surface-subtle);
  overflow: hidden;
  display: flex;
  align-items: center;
  position: relative;
}

.style-chevron-down .preview-content {
  width: 100%;
  position: relative;
  max-height: 70px;
  overflow: hidden;
}

.style-chevron-down .preview-fade {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 30px;
  background: linear-gradient(to bottom, transparent, var(--surface-subtle));
  pointer-events: none;
}

/* Expanded state - horizontal layout */
.style-chevron-down .item-expanded {
  display: flex;
  align-items: stretch;
  min-height: 200px;
}

.style-chevron-down .item-header-left {
  width: 20%;
  min-width: 180px;
  flex-shrink: 0;
  background: linear-gradient(to bottom, var(--surface), var(--surface-subtle));
  border-right: 1px solid var(--border-default);
  display: flex;
  align-items: flex-start;
  padding: var(--space-6);
}

.style-chevron-down .header-toggle {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  cursor: pointer;
  user-select: none;
}

.style-chevron-down .item-actions-right {
  width: 60px;
  flex-shrink: 0;
  background: linear-gradient(to bottom, var(--surface), var(--surface-subtle));
  border-left: 1px solid var(--border-default);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: var(--space-6) var(--space-4);
}

.style-chevron-down .toggle-icon {
  color: var(--ink-secondary);
  transition: transform 0.2s, color 0.2s;
  flex-shrink: 0;
}

.style-chevron-down .is-expanded .toggle-icon {
  transform: rotate(180deg);
  color: var(--action);
}

.style-chevron-down .item-name {
  font-size: var(--text-content);
  font-weight: 600;
  color: var(--ink);
  word-wrap: break-word;
}

/* ============================================
   STYLE VARIANT: Plus/Minus
   ============================================ */
.style-plus-minus .viewer-item {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-panel);
  overflow: hidden;
  background: var(--surface);
  margin-bottom: var(--space-4);
}

/* Collapsed state */
.style-plus-minus .item-collapsed {
  display: flex;
  align-items: stretch;
  background: var(--surface);
  border-left: 3px solid transparent;
  transition: border-left-color 0.2s;
}

.style-plus-minus .item-collapsed:hover {
  border-left-color: var(--border-hover);
}

.style-plus-minus .collapsed-header {
  width: 20%;
  min-width: 180px;
  display: flex;
  align-items: center;
  gap: 0.875rem;
  padding: var(--space-5) var(--space-6);
  background: var(--surface-subtle);
  border-right: 1px solid var(--border-default);
  cursor: pointer;
  user-select: none;
  transition: background-color 0.2s;
  flex-shrink: 0;
}

.style-plus-minus .collapsed-header:hover {
  background: var(--surface-sunken);
}

.style-plus-minus .collapsed-preview {
  width: calc(80% - 60px); /* Total minus header minus button */
  background: var(--surface-subtle);
  overflow: hidden;
  display: flex;
  align-items: center;
  position: relative;
}

.style-plus-minus .preview-content {
  width: 100%;
  position: relative;
  max-height: 70px;
  overflow: hidden;
}

.style-plus-minus .preview-fade {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 30px;
  background: linear-gradient(to bottom, transparent, var(--surface-subtle));
  pointer-events: none;
}

/* Expanded state - horizontal layout */
.style-plus-minus .item-expanded {
  display: flex;
  align-items: stretch;
  min-height: 200px;
  border-left: 3px solid var(--violet-500);
}

.style-plus-minus .item-header-left {
  width: 20%;
  min-width: 180px;
  flex-shrink: 0;
  background: var(--action-surface);
  border-right: 1px solid var(--action-border);
  display: flex;
  align-items: flex-start;
  padding: var(--space-5) var(--space-6);
}

.style-plus-minus .header-toggle {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  cursor: pointer;
  user-select: none;
}

.style-plus-minus .item-actions-right {
  width: 60px;
  flex-shrink: 0;
  background: var(--action-surface);
  border-left: 1px solid var(--action-border);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: var(--space-5) var(--space-4);
}

.style-plus-minus .toggle-icon {
  width: 18px;
  height: 18px;
  padding: var(--space-1);
  border-radius: var(--radius-sm);
  background: var(--surface-raised);
  color: var(--ink-secondary);
  transition: all 0.2s;
  flex-shrink: 0;
}

.style-plus-minus .item-collapsed:hover .toggle-icon {
  background: var(--surface-raised);
  color: var(--ink);
}

.style-plus-minus .is-expanded .toggle-icon {
  background: var(--violet-500);
  color: var(--action-fg);
  transform: rotate(90deg);
}

.style-plus-minus .item-name {
  font-size: var(--text-content);
  font-weight: 500;
  color: var(--ink);
  word-wrap: break-word;
}

/* ============================================
   STYLE VARIANT: Expand/Collapse Icon
   ============================================ */
.style-expand-collapse .viewer-item {
  border: 2px solid var(--border-subtle);
  border-radius: var(--radius-xl);
  overflow: hidden;
  background: var(--surface);
  transition: border-color 0.2s, box-shadow 0.2s;
}

.style-expand-collapse .viewer-item:hover {
  border-color: var(--border-default);
}

.style-expand-collapse .is-expanded {
  border-color: var(--violet-500);
  box-shadow: 0 4px 12px rgba(129, 140, 248, 0.15);
}

/* Collapsed state */
.style-expand-collapse .item-collapsed {
  display: flex;
  align-items: stretch;
  background: var(--surface);
}

.style-expand-collapse .collapsed-header {
  width: 20%;
  min-width: 180px;
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: var(--space-6);
  background: var(--surface-subtle);
  border-right: 2px solid var(--border-subtle);
  cursor: pointer;
  user-select: none;
  transition: background-color 0.2s;
  flex-shrink: 0;
}

.style-expand-collapse .collapsed-header:hover {
  background: var(--surface-subtle);
}

.style-expand-collapse .collapsed-preview {
  width: calc(80% - 60px); /* Total minus header minus button */
  background: var(--surface-subtle);
  overflow: hidden;
  display: flex;
  align-items: center;
  position: relative;
}

.style-expand-collapse .preview-content {
  width: 100%;
  position: relative;
  max-height: 70px;
  overflow: hidden;
}

.style-expand-collapse .preview-fade {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 30px;
  background: linear-gradient(to bottom, transparent, var(--surface-subtle));
  pointer-events: none;
}

/* Expanded state - horizontal layout */
.style-expand-collapse .item-expanded {
  display: flex;
  align-items: stretch;
  min-height: 200px;
}

.style-expand-collapse .item-header-left {
  width: 20%;
  min-width: 180px;
  flex-shrink: 0;
  background: var(--surface);
  border-right: 2px solid var(--border-subtle);
  display: flex;
  align-items: flex-start;
  padding: var(--space-6);
}

.style-expand-collapse .header-toggle {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  cursor: pointer;
  user-select: none;
}

.style-expand-collapse .item-actions-right {
  width: 60px;
  flex-shrink: 0;
  background: var(--surface);
  border-left: 2px solid var(--border-subtle);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: var(--space-6) var(--space-4);
}

.style-expand-collapse .toggle-icon {
  width: 20px;
  height: 20px;
  padding: var(--space-1);
  border-radius: 50%;
  background: var(--surface-raised);
  color: var(--ink-muted);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  flex-shrink: 0;
}

.style-expand-collapse .item-collapsed:hover .toggle-icon {
  background: var(--surface-raised);
  transform: scale(1.1);
}

.style-expand-collapse .is-expanded .toggle-icon {
  background: var(--violet-500);
  color: var(--action-fg);
  transform: rotate(180deg);
}

.style-expand-collapse .item-name {
  font-size: var(--text-content);
  font-weight: 600;
  color: var(--ink);
  word-wrap: break-word;
}

/* ============================================
   Common styles for all variants
   ============================================ */
.item-content {
  width: calc(80% - 60px); /* Total minus header minus button */
  padding: 0;
  background: var(--surface);
  display: flex;
  flex-direction: column;
}

.item-content :deep(.cm-editor) {
  height: 100% !important;
}

.btn-remove {
  padding: var(--space-3);
  background: none;
  border: none;
  color: var(--ink-muted);
  cursor: pointer;
  border-radius: var(--radius);
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-left: auto;
}

.btn-remove:hover {
  background: var(--danger);
  color: var(--danger-fg);
}

.page-footer {
  margin-top: var(--space-6);
}

.description-card {
  background: var(--surface-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  padding: var(--space-7);
}

.description-card h4 {
  margin: 0 0 var(--space-4);
  font-size: var(--text-heading);
  color: var(--ink);
}

.description-card p {
  margin: 0 0 var(--space-6);
  color: var(--ink-secondary);
  line-height: 1.6;
}

.description-card ul {
  margin: 0;
  padding-left: var(--space-7);
  list-style: disc;
}

.description-card li {
  margin: var(--space-3) 0;
  color: var(--ink-muted);
  line-height: 1.5;
}

/* Dark rules hang off the .dark class the theme switch sets, not the OS
   preference: a preference pinned in Settings against the OS otherwise
   left this block applying in light mode, or not applying in dark. */
.dark .page-shell {
  color: var(--ink-disabled);
}

.dark .page-header p {
  color: var(--ink-disabled);
}

.dark .active-style {
  border-color: var(--border-hover);
  background: rgba(99, 102, 241, 0.3);
}

.dark .active-style code {
  background: rgba(129, 140, 248, 0.28);
}

.dark .toolbar-button {
  border-color: var(--border-hover);
  background: var(--gray-800);
  color: var(--ink-disabled);
}

.dark .toolbar-button:hover {
  background: var(--gray-800);
}

.dark .toolbar-button.is-active {
  border-color: var(--action-border);
  background: var(--violet-700);
}

.dark .viewer-wrapper {
  background: var(--gray-800);
  border-color: var(--border-hover);
}

.dark .section-title {
  color: var(--ink-disabled);
  border-bottom-color: var(--border-hover);
}

.dark .description-card {
  background: var(--gray-800);
  border-color: var(--border-hover);
}

.dark .description-card h4 {
  color: var(--ink-disabled);
}

.dark .description-card p {
  color: var(--ink-disabled);
}

.dark .description-card li {
  color: var(--ink-disabled);
}
</style>