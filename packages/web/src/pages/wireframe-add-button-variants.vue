<template>
  <div class="demo-layout">
    <div class="demo-header">
      <h1>Add Button Style Variants</h1>
      <p>Choose your preferred style for add/create actions</p>
    </div>

    <div class="variants-grid">
      <!-- Variant 1: Icon Only (Current) -->
      <div class="variant-card">
        <h3>Variant 1: Icon Only (Current)</h3>
        <div class="demo-section">
          <div class="section-header variant-1">
            <button class="section-toggle">
              <span class="arrow">▸</span>
              <span class="section-title">Libraries</span>
            </button>
            <button class="add-button" title="Add Library">+</button>
          </div>
          <div class="category-header variant-1">
            <button class="cat-toggle">
              <span class="arrow small">▸</span>
              <span>Queries</span>
            </button>
            <button class="add-button-small" title="Add Query">+</button>
          </div>
        </div>
        <p class="variant-note">Compact but feels a bit "bare"</p>
      </div>

      <!-- Variant 2: Icon with subtle background -->
      <div class="variant-card">
        <h3>Variant 2: Icon with Border</h3>
        <div class="demo-section">
          <div class="section-header variant-2">
            <button class="section-toggle">
              <span class="arrow">▸</span>
              <span class="section-title">Libraries</span>
            </button>
            <button class="add-button" title="Add Library">+</button>
          </div>
          <div class="category-header variant-2">
            <button class="cat-toggle">
              <span class="arrow small">▸</span>
              <span>Queries</span>
            </button>
            <button class="add-button-small" title="Add Query">+</button>
          </div>
        </div>
        <p class="variant-note">More defined, clear click target</p>
      </div>

      <!-- Variant 3: Icon appears on hover only -->
      <div class="variant-card">
        <h3>Variant 3: Show on Hover</h3>
        <div class="demo-section">
          <div class="section-header variant-3">
            <button class="section-toggle">
              <span class="arrow">▸</span>
              <span class="section-title">Libraries</span>
            </button>
            <button class="add-button" title="Add Library">+</button>
          </div>
          <div class="category-header variant-3">
            <button class="cat-toggle">
              <span class="arrow small">▸</span>
              <span>Queries</span>
            </button>
            <button class="add-button-small" title="Add Query">+</button>
          </div>
        </div>
        <p class="variant-note">Cleaner UI, reveals on hover</p>
      </div>

      <!-- Variant 4: Three dots menu -->
      <div class="variant-card">
        <h3>Variant 4: Overflow Menu</h3>
        <div class="demo-section">
          <div class="section-header variant-4">
            <button class="section-toggle">
              <span class="arrow">▸</span>
              <span class="section-title">Libraries</span>
            </button>
            <button class="add-button" title="Actions">⋮</button>
          </div>
          <div class="category-header variant-4">
            <button class="cat-toggle">
              <span class="arrow small">▸</span>
              <span>Queries</span>
            </button>
            <button class="add-button-small" title="Actions">⋮</button>
          </div>
        </div>
        <p class="variant-note">More actions possible, less obvious</p>
      </div>

      <!-- Variant 5: Circular icon button -->
      <div class="variant-card">
        <h3>Variant 5: Circular Icon</h3>
        <div class="demo-section">
          <div class="section-header variant-5">
            <button class="section-toggle">
              <span class="arrow">▸</span>
              <span class="section-title">Libraries</span>
            </button>
            <button class="add-button" title="Add Library">+</button>
          </div>
          <div class="category-header variant-5">
            <button class="cat-toggle">
              <span class="arrow small">▸</span>
              <span>Queries</span>
            </button>
            <button class="add-button-small" title="Add Query">+</button>
          </div>
        </div>
        <p class="variant-note">Friendly, modern look</p>
      </div>

      <!-- Variant 6: No button, click section itself -->
      <div class="variant-card">
        <h3>Variant 6: Context Menu Only</h3>
        <div class="demo-section">
          <div class="section-header variant-6">
            <button class="section-toggle full-width">
              <span class="arrow">▸</span>
              <span class="section-title">Libraries</span>
              <span class="context-hint">(right-click to add)</span>
            </button>
          </div>
          <div class="category-header variant-6">
            <button class="cat-toggle full-width">
              <span class="arrow small">▸</span>
              <span>Queries</span>
              <span class="context-hint">(right-click)</span>
            </button>
          </div>
        </div>
        <p class="variant-note">Minimal UI, relies on context menu</p>
      </div>

      <!-- Variant 7: Small text "Add" -->
      <div class="variant-card">
        <h3>Variant 7: Text Label</h3>
        <div class="demo-section">
          <div class="section-header variant-7">
            <button class="section-toggle">
              <span class="arrow">▸</span>
              <span class="section-title">Libraries</span>
            </button>
            <button class="add-button" title="Add Library">Add</button>
          </div>
          <div class="category-header variant-7">
            <button class="cat-toggle">
              <span class="arrow small">▸</span>
              <span>Queries</span>
            </button>
            <button class="add-button-small" title="Add Query">Add</button>
          </div>
        </div>
        <p class="variant-note">More explicit, takes more space</p>
      </div>

      <!-- Variant 8: Icon with tooltip emphasis -->
      <div class="variant-card">
        <h3>Variant 8: Ghost Button</h3>
        <div class="demo-section">
          <div class="section-header variant-8">
            <button class="section-toggle">
              <span class="arrow">▸</span>
              <span class="section-title">Libraries</span>
            </button>
            <button class="add-button" title="Add Library">+</button>
          </div>
          <div class="category-header variant-8">
            <button class="cat-toggle">
              <span class="arrow small">▸</span>
              <span>Queries</span>
            </button>
            <button class="add-button-small" title="Add Query">+</button>
          </div>
        </div>
        <p class="variant-note">Subtle until hover, then prominent</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
</script>

<style scoped>
.demo-layout {
  padding: var(--space-8);
  background: var(--surface-subtle);
  min-height: 100vh;
}

.demo-header {
  text-align: center;
  margin-bottom: var(--space-9);
}

.demo-header h1 {
  font-size: var(--text-display-lg);
  font-weight: 700;
  margin: 0 0 var(--space-4) 0;
  color: var(--ink);
}

.demo-header p {
  font-size: var(--text-title);
  color: var(--ink-muted);
  margin: 0;
}

.variants-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 2rem;
  max-width: 1400px;
  margin: 0 auto;
}

.variant-card {
  background: var(--surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  padding: var(--space-7);
  box-shadow: 0 2px 4px rgba(0,0,0,0.05);
}

.variant-card h3 {
  margin: 0 0 var(--space-6) 0;
  font-size: var(--text-title);
  font-weight: 600;
  color: var(--ink);
}

.demo-section {
  background: var(--surface-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-panel);
  padding: var(--space-6);
  margin-bottom: var(--space-6);
}

.variant-note {
  font-size: var(--text-body-lg);
  color: var(--ink-muted);
  margin: 0;
  font-style: italic;
}

/* Common styles */
.section-header,
.category-header {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: var(--space-4);
}

.category-header {
  margin-top: var(--space-4);
  padding-left: var(--space-6);
}

.section-toggle,
.cat-toggle {
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
  font-size: var(--text-body-lg);
}

.section-toggle:hover,
.cat-toggle:hover {
  background: var(--surface-raised);
}

.section-title {
  font-weight: 600;
  color: var(--ink-secondary);
  text-transform: uppercase;
  letter-spacing: 0.025em;
}

.arrow {
  color: var(--ink-muted);
  font-size: var(--text-micro);
}

.arrow.small {
  font-size: var(--text-micro);
}

/* Variant 1: Current style */
.variant-1 .add-button,
.variant-1 .add-button-small {
  padding: var(--space-2) var(--space-4);
  background: var(--surface-raised);
  border: none;
  border-radius: var(--radius);
  cursor: pointer;
  font-size: var(--text-title);
  font-weight: 600;
  color: var(--ink-secondary);
  transition: all 0.2s;
}

.variant-1 .add-button-small {
  font-size: var(--text-body);
  padding: var(--space-1) var(--space-3);
}

.variant-1 .add-button:hover,
.variant-1 .add-button-small:hover {
  background: var(--gray-600);
  color: var(--action-fg);
}

/* Variant 2: With border */
.variant-2 .add-button,
.variant-2 .add-button-small {
  padding: var(--space-2) var(--space-4);
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  cursor: pointer;
  font-size: var(--text-title);
  font-weight: 600;
  color: var(--ink-secondary);
  transition: all 0.2s;
}

.variant-2 .add-button-small {
  font-size: var(--text-body);
  padding: var(--space-1) var(--space-3);
}

.variant-2 .add-button:hover,
.variant-2 .add-button-small:hover {
  background: var(--action);
  color: var(--action-fg);
  border-color: var(--action);
}

/* Variant 3: Hover to show */
.variant-3 .add-button,
.variant-3 .add-button-small {
  padding: var(--space-2) var(--space-4);
  background: transparent;
  border: none;
  border-radius: var(--radius);
  cursor: pointer;
  font-size: var(--text-title);
  font-weight: 600;
  color: var(--ink-disabled);
  transition: all 0.2s;
  opacity: 0;
}

.variant-3 .add-button-small {
  font-size: var(--text-body);
  padding: var(--space-1) var(--space-3);
}

.variant-3 .section-header:hover .add-button,
.variant-3 .category-header:hover .add-button-small {
  opacity: 1;
}

.variant-3 .add-button:hover,
.variant-3 .add-button-small:hover {
  background: var(--gray-600);
  color: var(--action-fg);
}

/* Variant 4: Overflow menu */
.variant-4 .add-button,
.variant-4 .add-button-small {
  padding: var(--space-2) var(--space-3);
  background: transparent;
  border: none;
  border-radius: var(--radius);
  cursor: pointer;
  font-size: var(--text-heading);
  color: var(--ink-muted);
  transition: all 0.2s;
  line-height: 1;
}

.variant-4 .add-button-small {
  font-size: var(--text-title);
}

.variant-4 .add-button:hover,
.variant-4 .add-button-small:hover {
  background: var(--surface-raised);
  color: var(--ink);
}

/* Variant 5: Circular */
.variant-5 .add-button,
.variant-5 .add-button-small {
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
}

.variant-5 .add-button-small {
  width: 18px;
  height: 18px;
  font-size: var(--text-body);
}

.variant-5 .add-button:hover,
.variant-5 .add-button-small:hover {
  background: var(--action);
  color: var(--action-fg);
  transform: scale(1.1);
}

/* Variant 6: Context menu only */
.variant-6 .full-width {
  width: 100%;
}

.variant-6 .context-hint {
  margin-left: auto;
  font-size: var(--text-micro);
  color: var(--ink-disabled);
  font-weight: normal;
}

/* Variant 7: Text label */
.variant-7 .add-button,
.variant-7 .add-button-small {
  padding: var(--space-2) var(--space-4);
  background: transparent;
  border: none;
  border-radius: var(--radius);
  cursor: pointer;
  font-size: var(--text-label);
  font-weight: 600;
  color: var(--action);
  transition: all 0.2s;
  text-transform: uppercase;
  letter-spacing: 0.025em;
}

.variant-7 .add-button-small {
  font-size: var(--text-micro);
  padding: var(--space-1) var(--space-4);
}

.variant-7 .add-button:hover,
.variant-7 .add-button-small:hover {
  background: var(--action-surface);
  color: var(--action-ink);
}

/* Variant 8: Ghost button */
.variant-8 .add-button,
.variant-8 .add-button-small {
  padding: var(--space-2) var(--space-4);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius);
  cursor: pointer;
  font-size: var(--text-title);
  font-weight: 600;
  color: var(--ink-disabled);
  transition: all 0.2s;
}

.variant-8 .add-button-small {
  font-size: var(--text-body);
  padding: var(--space-1) var(--space-3);
}

.variant-8 .add-button:hover,
.variant-8 .add-button-small:hover {
  background: var(--action);
  border-color: var(--action);
  color: var(--action-fg);
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(13, 110, 253, 0.3);
}
</style>
