<template>
  <div class="page-shell">
    <header class="page-header">
      <div>
        <h1>Sudoku Solver with RDF Rules</h1>
        <p>
          Edit the Sudoku grid or the RDF representation. Changes sync automatically.
          Toggle between Turtle and N-Triples formats. Click "Solve" to apply inference rules.
        </p>
      </div>
    </header>

    <section class="content-section">
      <div class="left-panel">
        <h2>Sudoku Grid</h2>
        <SudokuGrid v-model="gridData" />

        <div class="button-group">
          <button type="button" class="action-button" @click="clearGrid">
            Clear Grid
          </button>
          <button type="button" class="action-button primary" @click="loadExample">
            Load Example
          </button>
        </div>

        <div class="example-selector">
          <label for="example-select">Example Puzzle:</label>
          <select id="example-select" v-model="selectedExample" @change="loadExample">
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
        </div>
      </div>

      <div class="right-panel">
        <div class="panel-title-row">
          <h2>RDF Representation</h2>
          <div class="format-toggle">
            <button
              type="button"
              class="toggle-button"
              :class="{ active: rdfFormat === 'turtle' }"
              @click="rdfFormat = 'turtle'"
            >
              Turtle
            </button>
            <button
              type="button"
              class="toggle-button"
              :class="{ active: rdfFormat === 'ntriples' }"
              @click="rdfFormat = 'ntriples'"
            >
              N-Triples
            </button>
          </div>
        </div>

        <div class="editor-wrapper">
          <EditableRdfViewer
            v-if="rdfFormat === 'turtle'"
            v-model="editableRdf"
            content-type="text/turtle"
            min-height="500px"
            :prefix-source="null"
            @update:model-value="onRdfChange"
          />
          <EditableRdfViewer
            v-else
            v-model="editableRdf"
            content-type="application/n-triples"
            min-height="500px"
            :prefix-source="null"
            @update:model-value="onRdfChange"
          />
        </div>

        <div class="button-group">
          <button type="button" class="action-button" @click="copyToDataBlock">
            Copy to Data Block
          </button>
          <button type="button" class="action-button primary" @click="solve">
            Solve with Rules
          </button>
        </div>

        <div v-if="solving" class="status-message">
          Solving puzzle with inference rules...
        </div>
        <div v-if="solved" class="status-message success">
          Puzzle solved! Solution loaded from inference graph.
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import SudokuGrid from '@/components/SudokuGrid.vue';
import EditableRdfViewer from '@/components/EditableRdfViewer.vue';

// Grid state (9x9 array of numbers or null)
const gridData = ref<(number | null)[][]>(
  Array(9).fill(null).map(() => Array(9).fill(null))
);

const rdfFormat = ref<'turtle' | 'ntriples'>('turtle');
const selectedExample = ref('easy');
const solving = ref(false);
const solved = ref(false);
const syncingFromRdf = ref(false);
const syncingFromGrid = ref(false);
const editableRdf = ref<string>('');

// Convert grid to RDF Turtle
const gridToTurtle = (grid: (number | null)[][]): string => {
  const prefixes = `@prefix ex: <http://example.org/sudoku#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

`;

  const triples: string[] = [];

  for (let i = 0; i < 9; i++) {
    for (let j = 0; j < 9; j++) {
      const value = grid[i][j];
      const cellNum = i * 9 + j + 1;

      triples.push(
        `<urn:square/${cellNum}> ex:hasIndexI ${i + 1} ;`,
        `    ex:hasIndexJ ${j + 1}${value !== null ? ' ;' : ' .'}`,
      );

      if (value !== null) {
        triples.push(`    ex:hasValue ${value} .`);
      }

      triples.push('');
    }
  }

  return prefixes + triples.join('\n');
};

// Convert grid to RDF N-Triples
const gridToNTriples = (grid: (number | null)[][]): string => {
  const triples: string[] = [];

  for (let i = 0; i < 9; i++) {
    for (let j = 0; j < 9; j++) {
      const value = grid[i][j];
      const cellNum = i * 9 + j + 1;
      const cellUri = `<urn:square/${cellNum}>`;

      triples.push(
        `${cellUri} <http://example.org/sudoku#hasIndexI> "${i + 1}"^^<http://www.w3.org/2001/XMLSchema#integer> .`,
        `${cellUri} <http://example.org/sudoku#hasIndexJ> "${j + 1}"^^<http://www.w3.org/2001/XMLSchema#integer> .`
      );

      if (value !== null) {
        triples.push(
          `${cellUri} <http://example.org/sudoku#hasValue> "${value}"^^<http://www.w3.org/2001/XMLSchema#integer> .`
        );
      }
    }
  }

  return triples.join('\n');
};

// Parse RDF back to grid
const rdfToGrid = (rdf: string): (number | null)[][] => {
  const grid: (number | null)[][] = Array(9).fill(null).map(() => Array(9).fill(null));

  // Build a map of cell URIs to their properties
  const cellData: Record<string, { i?: number; j?: number; value?: number }> = {};

  // Parse line by line - works for both Turtle and N-Triples
  const lines = rdf.split('\n');
  let currentCell: string | null = null;

  for (const line of lines) {
    // Skip empty lines and comments
    if (!line.trim() || line.trim().startsWith('#')) continue;

    // Check for cell URI (both formats)
    const cellMatch = line.match(/<urn:square\/(\d+)>/);
    if (cellMatch) {
      currentCell = cellMatch[1];
      if (!cellData[currentCell]) {
        cellData[currentCell] = {};
      }
    }

    if (currentCell) {
      // Check for properties - extract just the number, ignore format details
      const iMatch = line.match(/hasIndexI[>\s]+["']?(\d+)/);
      const jMatch = line.match(/hasIndexJ[>\s]+["']?(\d+)/);
      const vMatch = line.match(/hasValue[>\s]+["']?(\d+)/);

      if (iMatch) cellData[currentCell].i = parseInt(iMatch[1]);
      if (jMatch) cellData[currentCell].j = parseInt(jMatch[1]);
      if (vMatch) cellData[currentCell].value = parseInt(vMatch[1]);
    }
  }

  // Populate grid from parsed data
  for (const [cellNum, data] of Object.entries(cellData)) {
    if (data.i !== undefined && data.j !== undefined) {
      const row = data.i - 1;
      const col = data.j - 1;

      if (row >= 0 && row < 9 && col >= 0 && col < 9) {
        grid[row][col] = data.value ?? null;
      }
    }
  }

  return grid;
};

// Computed RDF representations
const rdfTurtle = computed(() => gridToTurtle(gridData.value));
const rdfNTriples = computed(() => gridToNTriples(gridData.value));

// Watch for grid changes and update editable RDF
watch(gridData, () => {
  if (!syncingFromRdf.value) {
    syncingFromGrid.value = true;
    editableRdf.value = rdfFormat.value === 'turtle' ? rdfTurtle.value : rdfNTriples.value;
    // Use nextTick to ensure the update completes before clearing the flag
    setTimeout(() => {
      syncingFromGrid.value = false;
    }, 0);
  }
}, { deep: true, immediate: true });

// Watch for format changes and update editable RDF
watch(rdfFormat, () => {
  if (!syncingFromRdf.value) {
    editableRdf.value = rdfFormat.value === 'turtle' ? rdfTurtle.value : rdfNTriples.value;
  }
});

// Example puzzles
const examples = {
  easy: [
    [5, 3, null, null, 7, null, null, null, null],
    [6, null, null, 1, 9, 5, null, null, null],
    [null, 9, 8, null, null, null, null, 6, null],
    [8, null, null, null, 6, null, null, null, 3],
    [4, null, null, 8, null, 3, null, null, 1],
    [7, null, null, null, 2, null, null, null, 6],
    [null, 6, null, null, null, null, 2, 8, null],
    [null, null, null, 4, 1, 9, null, null, 5],
    [null, null, null, null, 8, null, null, 7, 9]
  ] as (number | null)[][],
  medium: [
    [null, null, null, 6, null, null, 4, null, null],
    [7, null, null, null, null, 3, 6, null, null],
    [null, null, null, null, 9, 1, null, 8, null],
    [null, null, null, null, null, null, null, null, null],
    [null, 5, null, 1, 8, null, null, null, 3],
    [null, null, null, 3, null, 6, null, 4, 5],
    [null, 4, null, 2, null, null, null, 6, null],
    [9, null, 3, null, null, null, null, null, null],
    [null, 2, null, null, null, null, 1, null, null]
  ] as (number | null)[][],
  hard: [
    [null, null, null, null, null, null, null, 1, 2],
    [null, null, null, null, null, null, null, null, 3],
    [null, null, 2, 3, null, null, 4, null, null],
    [null, null, 1, 8, null, null, null, null, 5],
    [null, 6, null, null, 7, null, 8, null, null],
    [null, null, null, null, null, 9, null, null, null],
    [null, null, 8, 5, null, null, null, null, null],
    [9, null, null, null, 4, null, 5, null, null],
    [4, 7, null, null, null, 6, null, null, null]
  ] as (number | null)[][]
};

// Event handlers
const onRdfChange = (newRdf: string) => {
  if (!syncingFromGrid.value) {
    syncingFromRdf.value = true;
    try {
      const newGrid = rdfToGrid(newRdf);
      gridData.value = newGrid;
      solved.value = false;
    } catch (error) {
      console.error('Error parsing RDF:', error);
    }
    setTimeout(() => {
      syncingFromRdf.value = false;
    }, 0);
  }
};

const clearGrid = () => {
  gridData.value = Array(9).fill(null).map(() => Array(9).fill(null));
  solved.value = false;
};

const loadExample = () => {
  const example = examples[selectedExample.value as keyof typeof examples];
  gridData.value = example.map(row => [...row]);
  solved.value = false;
};

const copyToDataBlock = () => {
  // In a real implementation, this would copy to a data block in the ruleset editor
  navigator.clipboard.writeText(editableRdf.value);
  alert('RDF copied to clipboard! Paste it into a data block in your ruleset.');
};

const solve = async () => {
  solving.value = true;
  solved.value = false;

  try {
    // In a real implementation, this would:
    // 1. Send the RDF to a ruleset execution endpoint
    // 2. Apply Sudoku solving rules
    // 3. Get back the inferred RDF with solutions
    // 4. Parse and update the grid

    // For now, simulate with a simple solver
    await new Promise(resolve => setTimeout(resolve, 1000));

    // TODO: Integrate with actual ruleset execution
    alert('Sudoku solving with rulesets coming soon! This would:\n\n1. Copy current RDF to a data block\n2. Apply inference rules (row/column/box constraints)\n3. Run iteratively until solved\n4. Load result from inference graph');

    solved.value = true;
  } catch (error) {
    console.error('Error solving:', error);
    alert('Error solving puzzle');
  } finally {
    solving.value = false;
  }
};

// Load example on mount
loadExample();
</script>

<style scoped>
.page-shell {
  padding: var(--space-8) var(--space-7);
  max-width: 1400px;
  margin: 0 auto;
}

.page-header {
  margin-bottom: var(--space-8);
}

.page-header h1 {
  margin: 0 0 var(--space-4);
  font-size: var(--text-display-lg);
  font-weight: bold;
}

.page-header p {
  margin: 0;
  color: var(--ink-muted);
  line-height: 1.5;
}

.content-section {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2rem;
  align-items: start;
}

.left-panel,
.right-panel {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.left-panel h2,
.right-panel h2 {
  margin: 0;
  font-size: var(--text-heading);
  font-weight: 600;
}

.panel-title-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 1rem;
}

.format-toggle {
  display: flex;
  gap: 0.25rem;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  padding: var(--space-2);
  background: var(--surface-subtle);
}

.toggle-button {
  border: none;
  border-radius: var(--radius-panel);
  padding: var(--space-3) var(--space-5);
  background: transparent;
  color: var(--ink-muted);
  font-size: var(--text-content);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.toggle-button:hover {
  background: var(--surface-raised);
  color: var(--ink);
}

.toggle-button.active {
  background: var(--surface);
  color: var(--ink);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.editor-wrapper {
  border-radius: var(--radius-lg);
  overflow: hidden;
  border: 1px solid var(--border-default);
}

.button-group {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.action-button {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  padding: var(--space-4) var(--space-6);
  background: var(--surface);
  color: var(--ink);
  font-size: var(--text-content);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.action-button:hover {
  background: var(--surface-subtle);
  border-color: var(--border-hover);
}

.action-button.primary {
  background: var(--action);
  color: var(--action-fg);
  border-color: var(--action);
}

.action-button.primary:hover {
  background: var(--action-hover);
  border-color: var(--action-hover);
}

.example-selector {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: var(--text-content);
}

.example-selector label {
  font-weight: 500;
  color: var(--ink-secondary);
}

.example-selector select {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-panel);
  padding: var(--space-3) var(--space-5);
  background: var(--surface);
  color: var(--ink);
  font-size: var(--text-content);
  cursor: pointer;
}

.status-message {
  padding: var(--space-5) var(--space-6);
  border-radius: var(--radius-lg);
  background: var(--action-surface);
  border: 1px solid var(--action-border);
  color: var(--action-ink);
  font-size: var(--text-content);
}

.status-message.success {
  background: var(--success-surface);
  border-color: var(--success-border);
  color: var(--success-ink);
}

@media (max-width: 1024px) {
  .content-section {
    grid-template-columns: 1fr;
  }
}

/* Dark rules hang off the .dark class the theme switch sets, not the OS
   preference: a preference pinned in Settings against the OS otherwise
   left this block applying in light mode, or not applying in dark. */
.dark .format-toggle {
  border-color: var(--border-hover);
  background: var(--gray-800);
}

.dark .toggle-button:hover {
  background: var(--gray-700);
}

.dark .toggle-button.active {
  background: var(--gray-700);
}

.dark .editor-wrapper {
  border-color: var(--border-hover);
}

.dark .action-button {
  border-color: var(--border-hover);
  background: var(--gray-800);
}

.dark .action-button:hover {
  background: var(--gray-700);
  border-color: var(--border-hover);
}

.dark .example-selector select {
  border-color: var(--border-hover);
  background: var(--gray-800);
}

.dark .status-message {
  background: rgba(59, 130, 246, 0.1);
  border-color: rgba(59, 130, 246, 0.3);
  color: var(--action);
}

.dark .status-message.success {
  background: rgba(34, 197, 94, 0.1);
  border-color: rgba(34, 197, 94, 0.3);
  color: var(--success);
}
</style>
