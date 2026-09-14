<template>
  <div
    class="query-group-node"
    :data-node-kind="nodeKind"
    :class="{
      'is-open': isOpen,
      'is-selected': selected,
      'has-error': validation?.level === 'error',
      'has-warning': validation?.level === 'warning',
      'is-running': execution?.status === 'running',
      'ran-ok': execution?.status === 'ok',
      'ran-failed': execution?.status === 'failed',
    }"
  >
    <Handle type="target" :position="targetHandlePosition" />
    <Handle type="source" :position="sourceHandlePosition" />

    <div class="node-shell">
      <button class="node-toggle" type="button" @click.stop="toggleOpen">
        <span class="node-kind">{{ nodeTitle }}</span>
        <span
          v-if="validation"
          class="node-validation-badge"
          :class="validation.level"
          :title="validationTitle"
        >{{ validation.level === 'error' ? '!' : '?' }}{{ validationCount > 1 ? ` ${validationCount}` : '' }}</span>
        <span class="node-toggle-icon" :class="{ open: isOpen }">v</span>
      </button>

      <div v-if="execution" class="node-execution" :class="execution.status">
        <span class="node-execution-status">{{ executionStatusLabel }}</span>
        <span v-if="execution.durationMs !== undefined" class="node-execution-chip" :class="{ slowest: execution.isSlowest }">
          {{ formatDuration(execution.durationMs) }}
        </span>
        <span v-if="execution.count !== undefined" class="node-execution-chip">
          {{ execution.count }} {{ execution.countLabel }}
        </span>
      </div>
      <p v-if="execution?.error" class="node-execution-error" :title="execution.error">{{ execution.error }}</p>

      <div v-if="isOpen" class="node-details">
        <div class="node-name">
          <span class="node-name-label">{{ attachmentLabel }}</span>
          <span class="node-name-value">{{ attachedNameText }}</span>
        </div>
        <pre class="node-preview"><code>{{ previewText }}</code></pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { Handle, Position, type NodeProps } from '@vue-flow/core';

const props = defineProps<NodeProps>();

/*
 * Handles follow whichever way the canvas is laid out, and every node on the
 * canvas follows the same one. Half the graph joined top-to-bottom and half
 * left-to-right is what sends an edge out of one node's underside to hunt
 * around for another's flank, and no amount of layout tuning fixes a drawing
 * whose ends disagree.
 */
const targetHandlePosition = computed(() => props.targetPosition ?? Position.Left);
const sourceHandlePosition = computed(() => props.sourcePosition ?? Position.Right);

type NodeValidation = {
  errors: number;
  warnings: number;
  level: 'error' | 'warning';
  messages: string[];
};

type QueryGroupNodeData = {
  kind?: 'query' | 'dynamic' | 'ruleset' | 'patch' | 'start' | 'end';
  attachedName?: string | null;
  queryString?: string | null;
  label?: string | null;
  validation?: NodeValidation | null;
  execution?: {
    status: 'running' | 'ok' | 'failed';
    durationMs?: number;
    count?: number;
    countLabel?: 'rows' | 'triples';
    error?: string;
    isFailedNode: boolean;
    isSlowest?: boolean;
  } | null;
};

const isOpen = ref(false);

const nodeData = computed(() => (props.data ?? {}) as QueryGroupNodeData);
/*
 * Also published on the card as `data-node-kind`, because since the title
 * started preferring the author's label there is no longer any text on the
 * card that says what kind of node this is. A test that wants the *kind* — the
 * claim "the construct template's second step is a rule set, not a query" — had
 * been reading the title for it, which quietly became an assertion about
 * whoever named the node last. The attribute is the kind; the title is the name.
 */
const nodeKind = computed(() => nodeData.value.kind ?? 'query');
const attachedName = computed(() => nodeData.value.attachedName ?? null);
const queryString = computed(() => nodeData.value.queryString ?? null);
const validation = computed(() => nodeData.value.validation ?? null);
const validationCount = computed(() =>
  validation.value ? validation.value.errors + validation.value.warnings : 0
);
const validationTitle = computed(() => validation.value?.messages.join('\n') ?? '');
const execution = computed(() => nodeData.value.execution ?? null);
const executionStatusLabel = computed(() => {
  switch (execution.value?.status) {
    case 'running': return 'Running';
    case 'failed': return 'Failed';
    case 'ok': return 'Done';
    default: return '';
  }
});
const formatDuration = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`);

const kindLabel = computed(() => {
  switch (nodeKind.value) {
    case 'dynamic':
      return 'Dynamic Query Node';
    case 'ruleset':
      return 'Ruleset Node';
    case 'patch':
      return 'Patch Node';
    case 'query':
    default:
      return 'Query Node';
  }
});

/*
 * What the node is attached to, named for what it does with it. A patch node
 * holds an update and runs nothing: calling that "Query" would put the same word
 * on a node that executes its query and one that only reads it.
 */
const attachmentLabel = computed(() => {
  switch (nodeKind.value) {
    case 'ruleset':
      return 'Ruleset';
    case 'patch':
      return 'Update derived';
    default:
      return 'Query';
  }
});

const attachedNameText = computed(() => {
  if (attachedName.value && attachedName.value.trim().length > 0) {
    return attachedName.value;
  }
  switch (nodeKind.value) {
    case 'ruleset':
      return 'No ruleset selected';
    case 'patch':
      return 'No update selected';
    default:
      return 'No query selected';
  }
});

/*
 * What the card is titled: the name `canvasNodeLabel` worked out, which is the
 * author's own name for the node when they gave it one.
 *
 * This read `attachedName` and then the kind, which is the same answer for
 * every node nobody has named and ignores the ones somebody has — so a node
 * renamed in the inspector's Editor tab went on reading "Query Node" on the
 * graph, and a canvas of five unassigned steps was five identical cards.
 *
 * The old derivation stays as the fallback, for `data` this component did not
 * build: the same reason `kind` defaults to `query` rather than throwing.
 */
const nodeTitle = computed(() => {
  const label = nodeData.value.label;
  if (typeof label === 'string' && label.trim().length > 0) {
    return label.trim();
  }
  if (attachedName.value && attachedName.value.trim().length > 0) {
    return attachedName.value;
  }
  return kindLabel.value;
});

const previewLines = computed(() => {
  const raw = queryString.value ?? '';
  if (!raw.trim()) {
    return [] as string[];
  }
  return raw
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !trimmed.startsWith('PREFIX');
    });
});

const previewText = computed(() => {
  if (nodeKind.value === 'ruleset') {
    return '-- No preview available';
  }
  const lines = previewLines.value;
  if (!lines.length) {
    if (attachedName.value) {
      return '-- No preview available';
    }
    return nodeKind.value === 'patch'
      ? '-- Assign an update to see a preview'
      : '-- Assign a query to see a preview';
  }
  return lines.slice(0, 6).join('\n');
});

const toggleOpen = () => {
  isOpen.value = !isOpen.value;
};
</script>

<style scoped>
.query-group-node {
  min-width: 220px;
  max-width: 320px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-xl);
  background: var(--surface);
  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.08);
  color: var(--ink);
}

.query-group-node.is-selected {
  border-color: var(--action-hover);
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.2);
}

/* Validation state reads through selection: the ring changes colour, so a selected
   node with an error still shows it. */
.query-group-node.has-warning {
  border-color: var(--warning-border);
}

.query-group-node.has-error {
  border-color: var(--danger-border);
}

.query-group-node.has-warning.is-selected {
  box-shadow: 0 0 0 2px var(--warning-border);
}

.query-group-node.has-error.is-selected {
  box-shadow: 0 0 0 2px var(--danger-border);
}

.node-validation-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.25rem;
  height: 1.25rem;
  margin-left: auto;
  margin-right: var(--space-4);
  padding: 0 var(--space-3);
  border-radius: var(--radius-full, 999px);
  border: 1px solid transparent;
  font-size: var(--text-micro);
  font-weight: 700;
  line-height: 1;
}

.node-validation-badge.error {
  background: var(--danger-surface);
  border-color: var(--danger-border);
  color: var(--danger-ink);
}

.node-validation-badge.warning {
  background: var(--warning-surface);
  border-color: var(--warning-border);
  color: var(--warning-ink);
}

/* Execution state. The left rule is a status ring that reads at a glance without
   competing with the validation border. */
.query-group-node.is-running {
  border-left: 3px solid var(--action);
}

.query-group-node.ran-ok {
  border-left: 3px solid var(--success);
}

.query-group-node.ran-failed {
  border-left: 3px solid var(--danger-border);
}

.node-execution {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
}

.node-execution-status {
  font-size: var(--text-micro);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ink-secondary);
}

.node-execution.failed .node-execution-status {
  color: var(--danger-ink);
}

.node-execution.ok .node-execution-status {
  color: var(--success-ink);
}

.node-execution-chip {
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-full, 999px);
  background: var(--surface-subtle);
  font-size: var(--text-micro);
  color: var(--ink-secondary);
}

.node-execution-chip.slowest {
  border-color: var(--warning-border);
  color: var(--warning-ink);
}

.node-execution-error {
  margin: 0;
  font-size: var(--text-micro);
  color: var(--danger-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.node-shell {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: var(--space-5) var(--space-6);
}

.node-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  border: none;
  background: transparent;
  padding: 0;
  font: inherit;
  color: inherit;
  cursor: pointer;
}

.node-kind {
  font-size: var(--text-content);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ink-secondary);
}

.node-toggle-icon {
  font-size: var(--text-body);
  color: var(--ink-muted);
  transition: transform 0.2s ease;
}

.node-toggle-icon.open {
  transform: rotate(180deg);
}

.node-details {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.node-name {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.node-name-label {
  font-size: var(--text-label);
  text-transform: uppercase;
  letter-spacing: 0.02em;
  color: var(--ink-muted);
}

.node-name-value {
  font-size: var(--text-content);
  font-weight: 500;
  color: var(--ink);
  word-break: break-word;
}

.node-preview {
  background: var(--surface-subtle);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  padding: var(--space-4);
  font-size: var(--text-body);
  line-height: 1.35;
  color: var(--ink);
  max-height: 6.5rem;
  overflow: hidden;
  white-space: pre-wrap;
}

:deep(.vue-flow__handle) {
  width: 10px;
  height: 10px;
  background: var(--gray-800);
  border: 2px solid var(--surface);
}
</style>
