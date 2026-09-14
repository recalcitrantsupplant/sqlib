<template>
  <div class="receipt">
    <header class="receipt-head">
      <Wrench :size="11" class="wrench" />
      <!--
        The readable description, with the exact tool name on hover. §7 makes a
        receipt an audit record — it has to stay possible to see which tool ran,
        not just a friendly paraphrase of it.
      -->
      <span class="tool-name" :title="receipt.tool">{{ labelFor(receipt.tool) }}</span>
      <span v-if="receipt.callCount > 1" class="call-count">×{{ receipt.callCount }}</span>
      <span class="status" :class="receipt.status">
        {{ receipt.status === 'ok' ? 'ok' : receipt.error || 'error' }}
      </span>
    </header>

    <div class="artifacts">
      <div v-for="(artifact, index) in receipt.artifacts" :key="index" class="artifact">
        <Workflow v-if="artifact.type === 'group'" :size="11" class="artifact-icon" />
        <Scale v-else-if="artifact.type === 'ruleset'" :size="11" class="artifact-icon" />
        <FileCode2 v-else :size="11" class="artifact-icon" />
        <span class="artifact-name">{{ artifact.name }}</span>
        <!--
          This badge must agree with the callable row. If the receipt says
          draft, the row says Draft — the receipt is the audit trail and it is
          worthless the moment the two can disagree.
        -->
        <span class="artifact-version" :class="artifact.version == null ? 'draft' : 'live'">
          {{ artifact.version == null ? 'draft' : `v${artifact.version}` }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Wrench, FileCode2, Workflow, Scale } from '@lucide/vue';
import type { ToolReceipt } from '../../composables/useAssistantSession';
import { useAssistantTools } from '../../composables/useAssistantTools';

defineProps<{ receipt: ToolReceipt }>();

const { labelFor } = useAssistantTools();
</script>

<style scoped>
/*
 * A bordered card rather than prose. An assistant describing its own tool
 * calls in a sentence is a claim; this is a record.
 */
.receipt {
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-panel);
  background: var(--surface-subtle);
}

.receipt-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  background: var(--surface-subtle);
  border-bottom: 1px solid var(--border-subtle);
}

.wrench {
  color: var(--ink-muted);
}

.tool-name {
  font-family: var(--font-mono);
  font-size: var(--text-label);
  font-weight: var(--weight-semibold);
  color: var(--ink-secondary);
}

.call-count {
  font-size: var(--text-micro);
  color: var(--ink-muted);
}

.status {
  margin-left: auto;
  font-size: var(--text-micro);
}

.status.ok {
  color: var(--success-ink);
}

.status.error {
  color: var(--danger-ink);
}

.artifacts {
  display: flex;
  flex-direction: column;
  padding: var(--space-2) 0;
  background: var(--surface);
}

.artifact {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-1) var(--space-4);
  font-size: var(--text-label);
  color: var(--ink-secondary);
}

.artifact-icon {
  flex-shrink: 0;
  color: var(--ink-muted);
}

.artifact-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.artifact-version {
  margin-left: auto;
  flex-shrink: 0;
  font-weight: var(--weight-semibold);
}

.artifact-version.live {
  color: var(--success-ink);
}

.artifact-version.draft {
  color: var(--warning-ink);
}
</style>
