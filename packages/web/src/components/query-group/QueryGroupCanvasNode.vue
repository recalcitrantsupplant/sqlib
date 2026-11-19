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
      <div class="node-head">
        <button
          class="node-toggle"
          type="button"
          :aria-expanded="isOpen"
          data-testid="node-toggle"
          @click.stop="toggleOpen"
        >
          <span class="node-kind">{{ nodeTitle }}</span>
        </button>
        <span
          v-if="validation"
          class="node-validation-badge"
          :class="validation.level"
          :title="validationTitle"
        >{{ validationBadgeText }}</span>
        <PopoverRoot v-if="canPeek" v-model:open="peekOpen">
          <PopoverAnchor as-child>
            <button
              ref="peekButton"
              type="button"
              class="btn-compact node-peek nodrag"
              :class="{ pinned: peekPinned }"
              :aria-expanded="peekOpen"
              data-testid="node-peek"
              @click.stop="togglePeekPin"
              @pointerenter="openPeekSoon"
              @pointerleave="closePeekSoon"
            >
              <Eye :size="12" />Peek
            </button>
          </PopoverAnchor>
          <PopoverPortal>
            <PopoverContent
              side="bottom"
              align="start"
              :side-offset="6"
              :collision-padding="12"
              class="node-peek-panel"
              data-testid="node-peek-panel"
              @open-auto-focus.prevent
              @interact-outside="keepOpenForAnchor"
              @pointerenter="cancelPeekClose"
              @pointerleave="closePeekSoon"
            >
              <p v-if="peekState === 'loading'" class="node-peek-note">Loading…</p>
              <p v-else-if="peekState === 'missing'" class="node-peek-note">{{ peekMissingText }}</p>
              <Codemirror
                v-else
                :model-value="peekText"
                :extensions="peekExtensions"
                :style="{ width: '100%' }"
              />
            </PopoverContent>
          </PopoverPortal>
        </PopoverRoot>
        <button
          type="button"
          class="icon-control icon-control--sm node-disclosure nodrag"
          :title="isOpen ? 'Collapse' : 'Expand'"
          :aria-label="isOpen ? 'Collapse' : 'Expand'"
          :aria-expanded="isOpen"
          data-testid="node-disclosure"
          @click.stop="toggleOpen"
        >
          <ChevronDown v-if="isOpen" />
          <ChevronRight v-else />
        </button>
      </div>

      <div v-if="execution" class="node-execution" :class="execution.status">
        <span class="node-execution-status">{{ executionStatusLabel }}</span>
        <span v-if="execution.durationMs !== undefined" class="node-execution-chip" :class="{ slowest: execution.isSlowest }">
          {{ formatDuration(execution.durationMs) }}
        </span>
        <button
          v-if="execution.count !== undefined && showNodeResult"
          type="button"
          class="node-execution-chip node-result-link nodrag"
          title="Show this node's result"
          data-testid="node-result-link"
          @click.stop="showNodeResult(props.id)"
        >
          {{ executionCountText }}
        </button>
        <span v-else-if="execution.count !== undefined" class="node-execution-chip">
          {{ executionCountText }}
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
import { computed, inject, onBeforeUnmount, ref, watch } from 'vue';
import { Handle, Position, type NodeProps } from '@vue-flow/core';
import { ChevronDown, ChevronRight, Eye } from '@lucide/vue';
import { PopoverAnchor, PopoverContent, PopoverPortal, PopoverRoot } from 'reka-ui';
import { Codemirror } from 'vue-codemirror';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { SHOW_NODE_RESULT } from '../../lib/nodeResult';
import { languageExtensionsFor } from '@/lib/codeLanguage';
import { rdfSyntaxHighlighting } from '@/lib/codemirrorHighlight';
import { useApiClient } from '@/composables/useApiClient';
import { resolveRuleSetVersion } from '@/composables/ruleSetVersionLookup';

const props = defineProps<NodeProps>();

/* A row count is a way into that node's rows: it opens them in the Results tab. */
const showNodeResult = inject(SHOW_NODE_RESULT, null);

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
/*
 * The badge says what it counts. It used to be a bare "!" or "?", and "? 2"
 * read as a question rather than two things to fix; the title still lists them.
 */
const validationBadgeText = computed(() => {
  const count = validationCount.value;
  if (validation.value?.level === 'error') return count === 1 ? '1 problem' : `${count} problems`;
  return count === 1 ? '1 warning' : `${count} warnings`;
});
const executionCountText = computed(() => {
  const count = execution.value?.count;
  const label = execution.value?.countLabel;
  if (count === undefined) return '';
  if (!label) return String(count);
  return `${count} ${count === 1 ? label.replace(/s$/, '') : label}`;
});
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

/* ------------------------------------------------------------------ *
 * Peek: the node's whole text, read-only, without opening the node.
 * ------------------------------------------------------------------ */

const ruleSetVersionId = computed(() => (props.data as { ruleSetVersionId?: string | null } | undefined)?.ruleSetVersionId ?? null);

/*
 * A query or patch node carries its text. A rule set node carries only the
 * version IRI, so its SRL is read when the peek first opens.
 */
const canPeek = computed(() => {
  if (nodeKind.value === 'ruleset') return !!ruleSetVersionId.value;
  if (nodeKind.value === 'start' || nodeKind.value === 'end') return false;
  return !!(queryString.value && queryString.value.trim());
});

const peekOpen = ref(false);
const ruleSetSrl = ref<string | null>(null);
const ruleSetState = ref<'idle' | 'loading' | 'ready' | 'missing'>('idle');
const api = useApiClient();

watch(ruleSetVersionId, () => {
  ruleSetSrl.value = null;
  ruleSetState.value = 'idle';
});

watch(peekOpen, async (open) => {
  if (!open || nodeKind.value !== 'ruleset' || ruleSetState.value !== 'idle') return;
  const versionId = ruleSetVersionId.value;
  if (!versionId) return;
  ruleSetState.value = 'loading';
  try {
    const resolved = await resolveRuleSetVersion(api, versionId);
    if (versionId !== ruleSetVersionId.value) return;
    ruleSetSrl.value = resolved?.srlDocument ?? null;
    ruleSetState.value = ruleSetSrl.value?.trim() ? 'ready' : 'missing';
  } catch {
    if (versionId === ruleSetVersionId.value) ruleSetState.value = 'missing';
  }
});

const peekState = computed(() => {
  if (nodeKind.value !== 'ruleset') return 'ready';
  return ruleSetState.value === 'idle' ? 'loading' : ruleSetState.value;
});
const peekMissingText = 'No rules to show';
const peekText = computed(() => (nodeKind.value === 'ruleset' ? ruleSetSrl.value ?? '' : queryString.value ?? ''));

const peekContentType = computed(() => {
  switch (nodeKind.value) {
    case 'ruleset': return 'application/srl';
    case 'patch': return 'application/sparql-update';
    default: return 'application/sparql-query';
  }
});

const peekExtensions = computed<Extension[]>(() => [
  ...languageExtensionsFor(peekContentType.value),
  EditorState.readOnly.of(true),
  EditorView.editable.of(false),
  rdfSyntaxHighlighting,
  EditorView.lineWrapping,
  EditorView.theme({
    '&': { backgroundColor: 'transparent' },
    '.cm-gutters': { display: 'none' },
    '.cm-activeLine': { backgroundColor: 'transparent' },
    '.cm-content': { padding: '0' },
  }),
]);

/*
 * Hover shows the peek, and it goes when the pointer leaves both the button and
 * the panel, after a short grace so the pointer can cross the gap. A click pins
 * it open until a second click, Escape or a click outside.
 */
const peekPinned = ref(false);
const peekButton = ref<HTMLElement | null>(null);
/* The button toggles the pin itself; a press on it is not a click outside. */
const keepOpenForAnchor = (event: Event) => {
  const target = event.target as Node | null;
  if (target && peekButton.value?.contains(target)) event.preventDefault();
};
watch(peekOpen, (open) => { if (!open) peekPinned.value = false; });
const togglePeekPin = () => {
  clearTimers();
  if (peekPinned.value) {
    peekOpen.value = false;
    return;
  }
  peekPinned.value = true;
  peekOpen.value = true;
};
let openTimer: ReturnType<typeof setTimeout> | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;
const clearTimers = () => {
  if (openTimer) clearTimeout(openTimer);
  if (closeTimer) clearTimeout(closeTimer);
  openTimer = null;
  closeTimer = null;
};
const openPeekSoon = () => {
  if (peekOpen.value) return cancelPeekClose();
  clearTimers();
  openTimer = setTimeout(() => { peekOpen.value = true; }, 250);
};
const closePeekSoon = () => {
  if (peekPinned.value) return;
  clearTimers();
  closeTimer = setTimeout(() => { peekOpen.value = false; }, 200);
};
const cancelPeekClose = () => {
  if (closeTimer) clearTimeout(closeTimer);
  closeTimer = null;
};
onBeforeUnmount(clearTimers);
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
  padding: 0 var(--space-3);
  border-radius: var(--radius-full, 999px);
  border: 1px solid transparent;
  flex-shrink: 0;
  font-size: var(--text-micro);
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
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

.node-result-link {
  cursor: pointer;
  font: inherit;
  font-size: var(--text-micro);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.node-result-link:hover {
  border-color: var(--border-strong, var(--border-default));
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

.node-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.node-toggle {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  text-align: left;
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

.node-peek {
  gap: var(--space-2);
  flex-shrink: 0;
}

.node-peek.pinned {
  border-color: var(--action);
  color: var(--action);
}

.node-disclosure {
  border-color: transparent;
  background: transparent;
  color: var(--ink-muted);
}

.node-disclosure:hover {
  border-color: var(--border-default);
  color: var(--ink);
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
  /* The canvas centres node text; query text needs its indentation. */
  text-align: left;
  white-space: pre-wrap;
}

:deep(.vue-flow__handle) {
  width: 10px;
  height: 10px;
  background: var(--gray-800);
  border: 2px solid var(--surface);
}
</style>

<!-- The peek panel is portalled to <body>, outside this component's scope. -->
<style>
.node-peek-panel {
  z-index: 50;
  width: min(36rem, calc(100vw - 2rem));
  max-height: min(24rem, 60vh);
  overflow: auto;
  padding: var(--space-4) var(--space-5);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  background: var(--surface);
  box-shadow: 0 10px 28px rgba(15, 23, 42, 0.18);
  color: var(--ink);
  font-size: var(--text-code, var(--text-body));
}

.node-peek-note {
  margin: 0;
  color: var(--ink-muted);
  font-size: var(--text-body);
}
</style>
