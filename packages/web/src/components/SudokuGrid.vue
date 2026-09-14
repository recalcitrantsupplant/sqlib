<template>
  <div class="sudoku-grid">
    <div
      v-for="i in 9"
      :key="i"
      class="sudoku-row"
    >
      <div
        v-for="j in 9"
        :key="j"
        class="sudoku-cell"
        :class="{
          'border-right': j % 3 === 0 && j !== 9,
          'border-bottom': i % 3 === 0 && i !== 9
        }"
      >
        <input
          v-model.number="grid[i - 1][j - 1]"
          type="text"
          maxlength="1"
          class="cell-input"
          :class="{ 'has-value': grid[i - 1][j - 1] }"
          @input="handleInput($event, i - 1, j - 1)"
          @keydown="handleKeydown($event, i - 1, j - 1)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';

interface Props {
  modelValue: (number | null)[][];
}

const props = defineProps<Props>();
const emit = defineEmits<{
  'update:modelValue': [value: (number | null)[][]];
}>();

// Local grid state
const grid = ref<(number | null)[][]>(
  props.modelValue.map(row => [...row])
);

// Watch for external changes
watch(
  () => props.modelValue,
  (newValue) => {
    grid.value = newValue.map(row => [...row]);
  },
  { deep: true }
);

// Watch for internal changes and emit
watch(
  grid,
  (newValue) => {
    emit('update:modelValue', newValue.map(row => [...row]));
  },
  { deep: true }
);

const handleInput = (event: Event, row: number, col: number) => {
  const input = event.target as HTMLInputElement;
  const value = input.value;

  // Only allow digits 1-9 or empty
  if (value === '') {
    grid.value[row][col] = null;
  } else if (/^[1-9]$/.test(value)) {
    grid.value[row][col] = parseInt(value, 10);
  } else {
    // Invalid input, revert
    input.value = grid.value[row][col]?.toString() || '';
  }
};

const handleKeydown = (event: KeyboardEvent, row: number, col: number) => {
  const key = event.key;

  // Arrow key navigation
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) {
    event.preventDefault();
    let newRow = row;
    let newCol = col;

    switch (key) {
      case 'ArrowUp':
        newRow = Math.max(0, row - 1);
        break;
      case 'ArrowDown':
        newRow = Math.min(8, row + 1);
        break;
      case 'ArrowLeft':
        newCol = Math.max(0, col - 1);
        break;
      case 'ArrowRight':
        newCol = Math.min(8, col + 1);
        break;
    }

    // Find and focus the new cell
    const cells = document.querySelectorAll('.cell-input');
    const targetIndex = newRow * 9 + newCol;
    (cells[targetIndex] as HTMLInputElement)?.focus();
  }
};
</script>

<style scoped>
.sudoku-grid {
  display: inline-block;
  border: 2px solid var(--gray-800);
  border-radius: var(--radius-lg);
  padding: var(--space-4);
  background: var(--surface);
}

.sudoku-row {
  display: flex;
}

.sudoku-cell {
  width: 40px;
  height: 40px;
  border: 1px solid var(--border-default);
  position: relative;
}

.sudoku-cell.border-right {
  border-right: 2px solid var(--gray-800);
}

.sudoku-cell.border-bottom {
  border-bottom: 2px solid var(--gray-800);
}

.cell-input {
  width: 100%;
  height: 100%;
  border: none;
  outline: none;
  text-align: center;
  font-size: var(--text-heading);
  font-weight: 500;
  color: var(--ink);
  background: transparent;
  caret-color: var(--action);
}

.cell-input:focus {
  background: rgba(59, 130, 246, 0.1);
}

.cell-input.has-value {
  color: var(--ink);
  font-weight: 600;
}

/* Dark rules hang off the .dark class the theme switch sets, not the OS
   preference: a preference pinned in Settings against the OS otherwise
   left this block applying in light mode, or not applying in dark. */
.dark .sudoku-grid {
  background: var(--gray-800);
  border-color: var(--border-hover);
}

.dark .sudoku-cell {
  border-color: var(--border-hover);
}

.dark .sudoku-cell.border-right,
.dark .sudoku-cell.border-bottom {
  border-color: var(--border-hover);
}

.dark .cell-input:focus {
  background: rgba(59, 130, 246, 0.2);
}
</style>
