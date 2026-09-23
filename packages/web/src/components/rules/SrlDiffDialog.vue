<template>
  <Dialog :open="open" @update:open="(value) => emit('update:open', value)">
    <DialogContent class="srl-diff-dialog" data-testid="srl-diff-dialog">
      <DialogHeader>
        <DialogTitle>{{ leftLabel }} → {{ rightLabel }}</DialogTitle>
        <DialogDescription class="sr-only">
          The rule set document, {{ leftLabel }} on the left and {{ rightLabel }} on the right.
        </DialogDescription>
      </DialogHeader>

      <p v-if="textError" class="error">{{ textError }}</p>
      <p v-else-if="leftText === null || rightText === null" class="muted">Loading…</p>
      <SparqlDiffViewer
        v-else
        :left-query="leftText"
        :right-query="rightText"
        :left-label="leftLabel"
        :right-label="rightLabel"
        content-type="application/srl"
        height="60vh"
      />

      <!--
        What saving the draft would do to the rule set's parts — only when
        something is being compared against a draft, and only when there is
        something to say. The text diff above is the answer to "what changed";
        this is the one thing it cannot show: which rules end up detached.
      -->
      <div v-if="error || (result && !isNoOp)" class="preview-body" data-testid="srl-save-impact">
        <p v-if="error" class="error">{{ error }}</p>
        <template v-else-if="result">
          <SectionLabel>On save</SectionLabel>

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
 * The rules editor's Diff: two versions of the document side by side, the same
 * merge view the query editor diffs with.
 *
 * Against a draft it also carries the SRL import's dry run, cut down to the
 * rows that say something — which rules saving would create or detach. That
 * used to be the whole dialog, and a document with no edits got a paragraph of
 * preamble and "No changes" instead of a diff.
 */
import { computed } from 'vue';
import Dialog from '../ui/dialog/Dialog.vue';
import DialogContent from '../ui/dialog/DialogContent.vue';
import DialogDescription from '../ui/dialog/DialogDescription.vue';
import DialogHeader from '../ui/dialog/DialogHeader.vue';
import DialogTitle from '../ui/dialog/DialogTitle.vue';
import SectionLabel from '../shared/SectionLabel.vue';
import SparqlDiffViewer from '../shared/SparqlDiffViewer.vue';
import type { RuleSetSrlPreview } from '@/composables/useApiClient';

const props = defineProps<{
  open: boolean;
  leftLabel: string;
  rightLabel: string;
  /** Null while that side is still being fetched. */
  leftText: string | null;
  rightText: string | null;
  textError: string | null;
  /** The save dry run; null where the right side is not a draft. */
  result: RuleSetSrlPreview | null;
  error: string | null;
}>();

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
}>();

const changed = computed(() => (props.result?.updated ?? []).filter((entry) => entry.changed));
const dataCreated = computed(() => props.result?.data?.created ?? []);
const dataDetached = computed(() => props.result?.data?.detached ?? []);

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
.srl-diff-dialog {
  max-width: min(1200px, 92vw);
}

.preview-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 20vh;
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
