<template>
  <Dialog :open="open" @update:open="(value) => emit('update:open', value)">
    <DialogContent class="max-w-2xl">
      <DialogHeader>
        <DialogTitle>Pending changes</DialogTitle>
        <DialogDescription>
          What saving this document would do to the rules and data blocks of this rule set.
          Nothing is deleted: a rule the document no longer contains is detached from this rule set
          only.
        </DialogDescription>
      </DialogHeader>

      <div class="preview-body">
        <p v-if="loading" class="muted">Working out what would change…</p>
        <p v-else-if="error" class="error">{{ error }}</p>
        <template v-else-if="result">
          <p v-if="isNoOp" class="muted">
            No changes — {{ unchangedTotal }} part{{ unchangedTotal === 1 ? '' : 's' }} unchanged.
          </p>

          <ul v-if="result.warnings.length" class="list warnings">
            <li v-for="(warning, index) in result.warnings" :key="`w${index}`">⚠ {{ warning }}</li>
          </ul>

          <ul v-if="result.created.length" class="list">
            <li v-for="(item, index) in result.created" :key="`c${index}`">
              <span class="tag create">new</span>{{ item.label }}
              <span v-if="!item.named" class="muted">(auto-named)</span>
            </li>
          </ul>

          <ul v-if="changed.length" class="list">
            <li v-for="(item, index) in changed" :key="`u${index}`">
              <span class="tag update">edited</span><code>{{ item.ruleVersionId }}</code>
            </li>
          </ul>

          <ul v-if="dataCreated.length" class="list">
            <li v-for="(item, index) in dataCreated" :key="`dc${index}`">
              <span class="tag create">new data</span>{{ item.label }}
            </li>
          </ul>

          <ul v-if="result.detached.length" class="list">
            <li v-for="(item, index) in result.detached" :key="`d${index}`">
              <span class="tag" :class="item.orphaned ? 'orphan' : 'detach'">
                {{ item.orphaned ? 'orphaned' : 'detached' }}
              </span>
              <code>{{ item.ruleVersionId }}</code>
              <span class="muted">{{ detachExplanation(item.orphaned, item.otherRuleSets) }}</span>
            </li>
          </ul>

          <ul v-if="dataDetached.length" class="list">
            <li v-for="(item, index) in dataDetached" :key="`dd${index}`">
              <span class="tag" :class="item.orphaned ? 'orphan' : 'detach'">
                {{ item.orphaned ? 'orphaned data' : 'detached data' }}
              </span>
              <code>{{ item.dataBlockVersionId }}</code>
              <span class="muted">{{ detachExplanation(item.orphaned, item.otherRuleSets) }}</span>
            </li>
          </ul>

          <p v-if="seedSummary" class="muted">{{ seedSummary }}</p>
        </template>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
/**
 * The SRL import's dry run.
 *
 * It used to sit under the editor as an always-present section; it is a
 * question you ask once, just before saving a rule set that already has
 * versions, so it is a dialog reached from the save bar's ⋮ menu. A draft
 * has nothing to compare against and never opens it.
 */
import { computed } from 'vue';
import Dialog from '../ui/dialog/Dialog.vue';
import DialogContent from '../ui/dialog/DialogContent.vue';
import DialogDescription from '../ui/dialog/DialogDescription.vue';
import DialogHeader from '../ui/dialog/DialogHeader.vue';
import DialogTitle from '../ui/dialog/DialogTitle.vue';
import type { RuleSetSrlPreview } from '@/composables/useApiClient';

const props = defineProps<{
  open: boolean;
  result: RuleSetSrlPreview | null;
  loading: boolean;
  error: string | null;
}>();

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
}>();

const changed = computed(() => (props.result?.updated ?? []).filter((entry) => entry.changed));
const dataCreated = computed(() => props.result?.data?.created ?? []);
const dataDetached = computed(() => props.result?.data?.detached ?? []);

const unchangedTotal = computed(
  () => (props.result?.unchangedCount ?? 0) + (props.result?.data?.unchangedCount ?? 0),
);

const isNoOp = computed(
  () =>
    !!props.result
    && props.result.created.length === 0
    && changed.value.length === 0
    && props.result.detached.length === 0
    && dataCreated.value.length === 0
    && dataDetached.value.length === 0,
);

/** What the seed rows contribute, as values versus declared inputs. */
const seedSummary = computed(() => {
  const seeds = props.result?.tupleSeeds;
  if (!seeds || (seeds.rows === 0 && seeds.declarations.length === 0)) return '';
  const parts: string[] = [];
  if (seeds.rows) parts.push(`${seeds.rows} initial tuple${seeds.rows === 1 ? '' : 's'}`);
  if (seeds.declarations.length) {
    parts.push(
      `${seeds.declarations.length} declared input${seeds.declarations.length === 1 ? '' : 's'} `
      + `(${seeds.declarations.map((d) => `TUPLE(${d.terms.join(', ')})`).join(', ')})`,
    );
  }
  return parts.join('; ');
});

const detachExplanation = (orphaned: boolean, otherRuleSets: number) =>
  orphaned
    ? '— removed from this rule set and no longer used anywhere. Nothing is deleted; clean up separately if you want it gone.'
    : `— removed from this rule set; still used by ${otherRuleSets} other rule set${otherRuleSets === 1 ? '' : 's'}.`;
</script>

<style scoped>
.preview-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 60vh;
  overflow: auto;
}

.list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: var(--text-body-lg);
}

.warnings {
  color: var(--warning-ink);
}

.tag {
  display: inline-block;
  margin-right: var(--space-3);
  padding: 0 var(--space-3);
  border-radius: var(--radius);
  font-size: var(--text-label);
  font-weight: var(--weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.tag.create {
  background: var(--success-surface);
  color: var(--success-ink);
}

.tag.update {
  background: var(--action-surface);
  color: var(--action-ink);
}

.tag.detach {
  background: var(--surface-sunken);
  color: var(--ink-secondary);
}

.tag.orphan {
  background: var(--danger-surface);
  color: var(--danger-ink);
}

.muted {
  margin: 0;
  color: var(--ink-muted);
  font-size: var(--text-body-lg);
}

.error {
  margin: 0;
  color: var(--danger-ink);
  font-size: var(--text-body-lg);
  white-space: pre-wrap;
}
</style>
