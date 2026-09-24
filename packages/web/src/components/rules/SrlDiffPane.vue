<template>
  <div class="diff-pane" data-testid="srl-diff-pane">
    <!--
      The row the run strip is not drawing while this is up: same height, same
      chrome, so moving between the editor and the diff does not move the code
      under them. The pair being compared is centred — it is the subject of
      this view, not an action on it — and the way back sits where actions sit.
    -->
    <div class="diff-controls">
      <SectionLabel as="h3" size="lg" class="diff-title">{{ leftLabel }} → {{ rightLabel }}</SectionLabel>

      <!--
        The way back. The editor's own Diff button is underneath this pane, so
        the toggle has to be reachable from on top of it.
      -->
      <button
        class="btn-compact diff-close"
        data-testid="close-srl-diff"
        title="Back to the editor"
        @click="emit('close')"
      >
        Editor
      </button>
    </div>

    <div class="diff-content">
      <p v-if="textError" class="error">{{ textError }}</p>
      <p v-else-if="leftText === null || rightText === null" class="muted">Loading…</p>
      <div v-else class="diff-body">
        <SparqlDiffViewer
          :left-query="leftText"
          :right-query="rightText"
          :left-label="leftLabel"
          :right-label="rightLabel"
          content-type="application/srl"
          height="100%"
        />
      </div>

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
    </div>
  </div>
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
 *
 * It is a pane rather than a dialog because it opens over the editor pop-out
 * and replaces what that box is showing — see `ExpandableEditor`'s `layer`
 * slot. The editor underneath keeps its instance, so coming back lands on the
 * same document, selection and undo history.
 */
import { computed } from 'vue';
import SectionLabel from '../shared/SectionLabel.vue';
import SparqlDiffViewer from '../shared/SparqlDiffViewer.vue';
import type { RuleSetSrlPreview } from '@/composables/useApiClient';

const props = defineProps<{
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
  (e: 'close'): void;
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
.diff-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

/*
 * The run row's own chrome and height (`RunBar`), and three tracks so the pair
 * is centred on the row rather than on what is left of it once the button
 * beside it has taken its width.
 */
.diff-controls {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  flex-shrink: 0;
  box-sizing: border-box;
  min-height: var(--panel-bar-h);
  padding: var(--space-2) var(--space-5);
  background: var(--surface-subtle);
  border-bottom: 1px solid var(--border-default);
}

.diff-title {
  grid-column: 2;
}

.diff-close {
  grid-column: 3;
  justify-self: end;
}

/*
 * The diff and, under it, what saving would do. The merge view runs to the
 * edges, as the editor it replaces does — the padding belongs to the prose
 * under it, not to the code.
 */
.diff-content {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.diff-body {
  flex: 1;
  min-height: 0;
}

.preview-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  flex-shrink: 0;
  max-height: 20vh;
  padding: var(--space-5) var(--space-6);
  border-top: 1px solid var(--border-default);
  overflow: auto;
}

/* The states that stand in for the diff, set in from the edge as prose is. */
.diff-content > .error,
.diff-content > .muted {
  padding: var(--space-5) var(--space-6);
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
