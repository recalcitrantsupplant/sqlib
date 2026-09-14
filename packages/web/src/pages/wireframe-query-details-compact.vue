<template>
  <div class="compact-demo-page">
    <div class="demo-header">
      <h1>Query Details - Compact Layout Options</h1>
      <p>Compare different compact layouts. Current implementation uses ~180px height.</p>
    </div>

    <!-- Option 1: Single Row (Most Compact) -->
    <section class="demo-section">
      <div class="demo-label">
        <h2>Option 1: Single Row Layout</h2>
        <span class="demo-metrics">~60px height | 67% reduction</span>
      </div>
      <div class="option-1">
        <div class="compact-header">
          <div class="header-left">
            <span class="section-title">Query Details</span>
            <span class="divider">|</span>
            <label>Name:</label>
            <input type="text" value="Get All Countries" class="input-inline" />
            <span class="divider">|</span>
            <label>Desc:</label>
            <input type="text" value="Retrieve countries" class="input-inline" />
            <span class="divider">|</span>
            <label>Backend:</label>
            <select class="select-inline">
              <option>Wikidata</option>
            </select>
            <span class="divider">|</span>
            <label>Ver:</label>
            <select class="select-inline-small">
              <option>v3</option>
            </select>
          </div>
          <div class="header-right">
            <button class="btn-compact btn-edit"><Edit :size="12" /> Edit</button>
            <button class="btn-compact"><Save :size="14" /> Save</button>
            <button class="btn-compact"><Code :size="14" /> Show Code</button>
            <button class="btn-compact btn-primary"><Play :size="14" /> Execute</button>
          </div>
        </div>
      </div>
      <div class="demo-notes">
        <strong>Pros:</strong> Minimal space, everything visible<br>
        <strong>Cons:</strong> Very cramped, hard to read
      </div>
    </section>

    <!-- Option 2: Two Row Compact (Recommended) -->
    <section class="demo-section recommended">
      <div class="demo-label">
        <h2>Option 2: Two Row Compact ⭐ Recommended</h2>
        <span class="demo-metrics">~70px height | 61% reduction</span>
      </div>
      <div class="option-2">
        <div class="compact-header-row">
          <div class="title-actions">
            <span class="section-title">Query Details</span>
          </div>
          <div class="main-actions">
            <button class="btn-compact btn-edit"><Edit :size="12" /> Edit</button>
            <button class="btn-compact"><Save :size="14" /> Save</button>
            <button class="btn-compact"><Code :size="14" /> Show Code</button>
            <button class="btn-compact btn-primary"><Play :size="14" /> Execute</button>
            <select class="select-compact">
              <option>Wikidata Backend</option>
            </select>
          </div>
        </div>
        <div class="compact-fields-row">
          <div class="field-inline">
            <label>Name:</label>
            <input type="text" value="Get All Countries" />
          </div>
          <span class="separator">|</span>
          <div class="field-inline">
            <label>Desc:</label>
            <input type="text" value="Retrieve all countries from Wikidata" />
          </div>
          <span class="separator">|</span>
          <div class="field-inline">
            <label>Backend:</label>
            <select>
              <option>Wikidata</option>
            </select>
          </div>
          <span class="separator">|</span>
          <div class="field-inline">
            <label>Ver:</label>
            <select class="select-small">
              <option>v3</option>
            </select>
          </div>
          <span class="separator">|</span>
          <div class="field-inline">
            <label>Comment:</label>
            <input type="text" value="Added filter" class="input-small" />
          </div>
        </div>
      </div>
      <div class="demo-notes">
        <strong>Pros:</strong> Balanced, readable, good space savings<br>
        <strong>Cons:</strong> May need horizontal scroll on small screens
      </div>
    </section>

    <!-- Option 3: Collapsible -->
    <section class="demo-section">
      <div class="demo-label">
        <h2>Option 3: Collapsible Section</h2>
        <span class="demo-metrics">~35px collapsed | ~70px expanded</span>
      </div>
      <div class="option-3">
        <div class="collapsible-header" @click="option3Expanded = !option3Expanded">
          <button class="btn-icon-collapse">
            <ChevronDown v-if="option3Expanded" :size="14" />
            <ChevronRight v-else :size="14" />
          </button>
          <span class="query-summary">Get All Countries (v3)</span>
          <div class="header-actions">
            <button class="btn-compact btn-edit" @click.stop><Edit :size="12" /> Edit</button>
            <button class="btn-compact"><Save :size="14" /> Save</button>
            <button class="btn-compact"><Code :size="14" /> Show Code</button>
            <button class="btn-compact btn-primary"><Play :size="14" /> Execute</button>
            <select class="select-compact">
              <option>Wikidata</option>
            </select>
          </div>
        </div>
        <div v-if="option3Expanded" class="collapsible-content">
          <div class="field-inline">
            <label>Name:</label>
            <input type="text" value="Get All Countries" />
          </div>
          <div class="field-inline">
            <label>Description:</label>
            <input type="text" value="Retrieve all countries from Wikidata" />
          </div>
          <div class="field-inline">
            <label>Backend:</label>
            <select><option>Wikidata</option></select>
          </div>
          <div class="field-inline">
            <label>Comment:</label>
            <input type="text" value="Added filter" />
          </div>
        </div>
      </div>
      <div class="demo-notes">
        <strong>Pros:</strong> Can hide details, shows key info (name/version)<br>
        <strong>Cons:</strong> Extra click to see/edit details
      </div>
    </section>

    <!-- Option 4: Inline Labels -->
    <section class="demo-section">
      <div class="demo-label">
        <h2>Option 4: Inline Labels (Placeholder Style)</h2>
        <span class="demo-metrics">~85px height | 53% reduction</span>
      </div>
      <div class="option-4">
        <div class="compact-header-row">
          <div class="title-actions">
            <span class="section-title">Query Details</span>
          </div>
          <div class="main-actions">
            <button class="btn-compact btn-edit"><Edit :size="12" /> Edit</button>
            <button class="btn-compact"><Save :size="14" /> Save</button>
            <button class="btn-compact"><Code :size="14" /> Show Code</button>
            <button class="btn-compact btn-primary"><Play :size="14" /> Execute</button>
            <select class="select-compact">
              <option>Wikidata Backend</option>
            </select>
          </div>
        </div>
        <div class="inline-label-fields">
          <input type="text" placeholder="Name: Get All Countries" value="Name: Get All Countries" class="input-with-label" />
          <select class="select-with-label">
            <option>Backend: Wikidata</option>
          </select>
          <select class="select-with-label select-small">
            <option>Version: v3</option>
          </select>
          <input type="text" placeholder="Comment..." value="Comment: Added filter" class="input-with-label input-small" />
        </div>
        <div class="inline-label-fields">
          <input type="text" placeholder="Description: Retrieve all countries..." value="Description: Retrieve all countries from Wikidata" class="input-with-label input-full" />
        </div>
      </div>
      <div class="demo-notes">
        <strong>Pros:</strong> Modern look, clean, compact<br>
        <strong>Cons:</strong> Labels as placeholders can be confusing
      </div>
    </section>

    <!-- Option 5: Grid Layout -->
    <section class="demo-section">
      <div class="demo-label">
        <h2>Option 5: Compact Grid</h2>
        <span class="demo-metrics">~85px height | 53% reduction</span>
      </div>
      <div class="option-5">
        <div class="compact-header-row">
          <div class="title-actions">
            <span class="section-title">Query Details</span>
          </div>
          <div class="main-actions">
            <button class="btn-compact btn-edit"><Edit :size="12" /> Edit</button>
            <button class="btn-compact"><Save :size="14" /> Save</button>
            <button class="btn-compact"><Code :size="14" /> Show Code</button>
            <button class="btn-compact btn-primary"><Play :size="14" /> Execute</button>
            <select class="select-compact">
              <option>Wikidata Backend</option>
            </select>
          </div>
        </div>
        <div class="grid-fields">
          <div class="grid-row">
            <div class="field-group">
              <label>Name:</label>
              <input type="text" value="Get All Countries" />
            </div>
            <div class="field-group">
              <label>Backend:</label>
              <select><option>Wikidata</option></select>
            </div>
            <div class="field-group field-small">
              <label>Version:</label>
              <select><option>v3</option></select>
            </div>
            <div class="field-group">
              <label>Comment:</label>
              <input type="text" value="Added filter" />
            </div>
          </div>
          <div class="grid-row">
            <div class="field-group field-full">
              <label>Description:</label>
              <input type="text" value="Retrieve all countries from Wikidata" />
            </div>
          </div>
        </div>
      </div>
      <div class="demo-notes">
        <strong>Pros:</strong> organised, scannable, good balance<br>
        <strong>Cons:</strong> Description still needs full row
      </div>
    </section>

    <!-- Current Implementation for Comparison -->
    <section class="demo-section current">
      <div class="demo-label">
        <h2>Current Implementation (For Comparison)</h2>
        <span class="demo-metrics">~180px height | baseline</span>
      </div>
      <div class="current-implementation">
        <div class="metadata-header">
          <div class="metadata-title-group">
            <h3>Query Details</h3>
          </div>
          <div class="action-buttons">
            <button class="btn btn-sm"><Edit :size="14" /> Edit</button>
            <button class="btn"><Save :size="16" /> Save</button>
            <button class="btn"><Code :size="16" /> Show Code</button>
            <button class="btn btn-primary"><Play :size="16" /> Execute</button>
          </div>
        </div>
        <div class="metadata-fields">
          <div class="metadata-left">
            <div class="field-group">
              <label>NAME</label>
              <input type="text" value="Get All Countries" />
            </div>
            <div class="field-group">
              <label>DESCRIPTION</label>
              <input type="text" value="Retrieve all countries from Wikidata" />
            </div>
            <div class="field-group">
              <label>DEFAULT BACKEND</label>
              <select><option>Wikidata</option></select>
            </div>
          </div>
          <div class="metadata-right">
            <div class="field-group">
              <label>VERSION</label>
              <select><option>v3</option></select>
            </div>
            <div class="field-group">
              <label>VERSION COMMENT</label>
              <input type="text" value="Added filter" />
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { Edit, Save, Code, Play, ChevronDown, ChevronRight } from '@lucide/vue';

const option3Expanded = ref(true);
</script>

<style scoped>
.compact-demo-page {
  padding: var(--space-8);
  background: var(--surface-subtle);
  min-height: 100vh;
}

.demo-header {
  margin-bottom: var(--space-8);
  background: var(--surface);
  padding: var(--space-7);
  border-radius: var(--radius-lg);
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.demo-header h1 {
  margin: 0 0 var(--space-4) 0;
  font-size: var(--text-display);
  color: var(--ink);
}

.demo-header p {
  margin: 0;
  color: var(--ink-muted);
}

.demo-section {
  margin-bottom: var(--space-7);
  background: var(--surface);
  border-radius: var(--radius-lg);
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  overflow: hidden;
}

.demo-section.recommended {
  border: 2px solid var(--action);
}

.demo-section.current {
  border: 2px solid var(--warning);
}

.demo-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-5) var(--space-6);
  background: var(--surface-subtle);
  border-bottom: 1px solid var(--border-default);
}

.demo-label h2 {
  margin: 0;
  font-size: var(--text-title);
  font-weight: 600;
  color: var(--ink);
}

.demo-metrics {
  font-size: var(--text-body-lg);
  color: var(--ink-muted);
  font-weight: 500;
}

.demo-notes {
  padding: var(--space-5) var(--space-6);
  background: var(--surface-subtle);
  border-top: 1px solid var(--border-default);
  font-size: var(--text-body-lg);
  color: var(--ink-secondary);
  line-height: 1.6;
}

/* Common Compact Styles */
.btn-compact {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: var(--space-2) var(--space-4);
  font-size: var(--text-body);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  background: var(--surface);
  cursor: pointer;
  color: var(--ink-secondary);
}

.btn-compact:hover {
  background: var(--surface-subtle);
}

.btn-compact.btn-primary {
  background: var(--action);
  color: var(--action-fg);
  border-color: var(--action);
}

.btn-compact.btn-edit {
  background: var(--surface-raised);
}

.section-title {
  font-size: var(--text-body-lg);
  font-weight: 600;
  color: var(--ink);
}

.divider, .separator {
  color: var(--ink-disabled);
  margin: 0 var(--space-4);
}

/* Option 1: Single Row */
.option-1 {
  padding: var(--space-4) var(--space-5);
}

.compact-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
}

.header-right {
  display: flex;
  gap: 6px;
}

.option-1 label {
  font-size: var(--text-label);
  color: var(--ink-muted);
  font-weight: 500;
  white-space: nowrap;
}

.input-inline {
  padding: var(--space-1) var(--space-3);
  font-size: var(--text-body);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  min-width: 0;
  flex: 0 1 auto;
}

.select-inline {
  padding: var(--space-1) var(--space-3);
  font-size: var(--text-body);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
}

.select-inline-small {
  padding: var(--space-1) var(--space-3);
  font-size: var(--text-body);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  width: 60px;
}

/* Option 2: Two Row Compact */
.option-2 {
  padding: var(--space-4) var(--space-5);
}

.compact-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-4);
}

.title-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.main-actions {
  display: flex;
  gap: 6px;
  align-items: center;
}

.select-compact {
  padding: var(--space-2) var(--space-4);
  font-size: var(--text-body);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
}

.compact-fields-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.field-inline {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.field-inline label {
  font-size: var(--text-label);
  color: var(--ink-muted);
  font-weight: 500;
  white-space: nowrap;
}

.field-inline input,
.field-inline select {
  padding: var(--space-2) var(--space-4);
  font-size: var(--text-body);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  min-width: 0;
}

.field-inline input {
  flex: 1;
  min-width: 120px;
}

.select-small {
  width: 70px;
}

.input-small {
  width: 120px;
}

/* Option 3: Collapsible */
.option-3 {
  padding: var(--space-4) var(--space-5);
}

.collapsible-header {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
}

.btn-icon-collapse {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  background: none;
  cursor: pointer;
  color: var(--ink-muted);
}

.query-summary {
  font-size: var(--text-body-lg);
  font-weight: 600;
  color: var(--ink);
  flex: 1;
}

.header-actions {
  display: flex;
  gap: 6px;
  margin-left: auto;
}

.collapsible-content {
  margin-top: var(--space-4);
  padding-top: var(--space-4);
  border-top: 1px solid var(--border-subtle);
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.collapsible-content .field-inline {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: stretch;
}

.collapsible-content .field-inline label {
  font-size: var(--text-label);
  color: var(--ink-muted);
  font-weight: 500;
}

.collapsible-content .field-inline input,
.collapsible-content .field-inline select {
  width: 100%;
  padding: var(--space-2) var(--space-4);
  font-size: var(--text-body);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
}

/* Option 4: Inline Labels */
.option-4 {
  padding: var(--space-4) var(--space-5);
}

.inline-label-fields {
  display: flex;
  gap: 8px;
  margin-bottom: var(--space-4);
}

.inline-label-fields:last-child {
  margin-bottom: 0;
}

.input-with-label,
.select-with-label {
  padding: var(--space-2) var(--space-4);
  font-size: var(--text-body);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  flex: 1;
  min-width: 0;
}

.input-with-label.input-small,
.select-with-label.select-small {
  flex: 0 0 120px;
}

.input-with-label.input-full {
  flex: 1;
}

/* Option 5: Grid */
.option-5 {
  padding: var(--space-4) var(--space-5);
}

.grid-fields {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.grid-row {
  display: grid;
  grid-template-columns: 2fr 1.5fr 0.8fr 1.5fr;
  gap: 12px;
  align-items: end;
}

.grid-row:last-child {
  grid-template-columns: 1fr;
}

.field-group {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.field-group.field-small {
  grid-column: span 1;
}

.field-group.field-full {
  grid-column: span 1;
}

.field-group label {
  font-size: var(--text-label);
  color: var(--ink-muted);
  font-weight: var(--weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.field-group input,
.field-group select {
  padding: var(--space-2) var(--space-4);
  font-size: var(--text-body);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
}

/* Current Implementation */
.current-implementation {
  padding: var(--space-6);
}

.metadata-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-6);
}

.metadata-title-group {
  display: flex;
  align-items: center;
  gap: 12px;
}

.metadata-title-group h3 {
  margin: 0;
  font-size: var(--text-title);
  font-weight: 600;
}

.action-buttons {
  display: flex;
  gap: 8px;
}

.btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: var(--space-3) var(--space-5);
  font-size: var(--text-body-lg);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-panel);
  background: var(--surface);
  cursor: pointer;
}

.btn-sm {
  padding: var(--space-2) var(--space-4);
  font-size: var(--text-body);
}

.btn.btn-primary {
  background: var(--action);
  color: var(--action-fg);
  border-color: var(--action);
}

.metadata-fields {
  display: flex;
  gap: 16px;
}

.metadata-left,
.metadata-right {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.metadata-right {
  padding-left: var(--space-6);
  border-left: 1px solid var(--border-default);
}

.current-implementation .field-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.current-implementation .field-group label {
  font-size: var(--text-body);
  font-weight: var(--weight-semibold);
  color: var(--ink-muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.current-implementation .field-group input,
.current-implementation .field-group select {
  padding: var(--space-4) var(--space-5);
  font-size: var(--text-content);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
}
</style>
