<template>
  <div class="details-panel" data-testid="details-panel">
    <!--
      The body scrolls; the footer does not. What is at the foot of the panel
      is the entity's own dates and the one action that destroys it, and both
      want to be where they were left rather than somewhere in the scroll.
    -->
    <div class="details-body">
      <!--
        No "Identity" heading: the first thing in the panel needs no label
        saying that a name is a name, and dropping it puts the fields at the
        top where the eye already is. Versions and Signature keep theirs —
        they are the second and third thing, and they do need naming.
      -->
      <section class="details-group">
        <div class="identity-grid">
          <span class="field-label">Name</span>
          <input
            ref="nameInput"
            class="field-input"
            data-testid="details-name"
            :value="name"
            :placeholder="`Untitled ${entityNoun}`"
            @input="emit('update:name', ($event.target as HTMLInputElement).value)"
          />

          <!--
            A description is a sentence or two more often than it is five words,
            and a single-line input showed the first forty characters of it and
            hid the rest behind a caret you had to drive. It is a box that grows
            to what it holds, capped at three lines so the fields below it stay
            where they are; past that, the last line fades under a "more" that
            opens the whole thing in place. Still one editable field either way —
            expanding is not a mode, and typing works in both.
          -->
          <span class="field-label description-label">Description</span>
          <div class="description-field" :class="{ clamped: descriptionClamped, opened: descriptionOpened }">
            <textarea
              ref="descriptionInput"
              class="field-input description-input"
              data-testid="details-description"
              rows="1"
              :value="description"
              @input="onDescriptionInput"
            />
            <button
              v-if="descriptionOverflows"
              class="description-toggle"
              data-testid="details-description-toggle"
              :title="descriptionExpanded ? 'Show less' : 'Show the whole description'"
              @click="toggleDescription"
            >
              {{ descriptionExpanded ? 'less' : 'more' }}
            </button>
          </div>

          <!--
            The id sits with the name because it is the other half of "what am I
            looking at": the string a caller puts in its config. Whole and
            wrapped rather than the last six characters, which identified it for
            a human reading this panel and for nothing else — the only thing
            anyone does with an id is paste it somewhere.

            The Library row that used to be here is gone: the sidebar shows
            which library is open and the save bar says where a scratch item
            will land, so a third copy could only ever agree with them.
          -->
          <span class="field-label id-label">{{ idLabel }}</span>
          <span class="field-value field-mono id-field">
            <template v-if="entityId">
              <span class="id-text" data-testid="details-id">{{ entityId }}</span>
              <button
                class="copy-button"
                :title="`Copy ${idLabel.toLowerCase()}`"
                @click="emit('copy-id')"
              >
                <Copy :size="12" />
              </button>
            </template>
            <template v-else>not assigned</template>
          </span>

          <!-- A group has no backend of its own — each node carries one — so the
               row is absent there rather than reading "None" and being wrong.
               Where it does exist it is the *default* backend: what a caller gets
               when it names none, which is a property of the query and editable
               here rather than only in the execution row. -->
          <template v-if="showBackend">
            <span class="field-label">Default Backend</span>
            <!--
              Typed at rather than scrolled: the option list is every backend
              the deployment knows, all named by hand.
            -->
            <SearchSelect
              test-id="details-backend"
              aria-label="Default backend"
              :model-value="backendValue"
              :options="backendOptions"
              @update:model-value="(value) => emit('update:backend', value)"
            />
          </template>

          <!--
            Tags sit with identity because that is what they are: what this
            entity is *about*, beside what it is called. Not with versions — a
            tag is on the stable entity, never on a version (tags doc §4.4), so
            saving neither carries them forward nor drops them.
          -->
          <template v-if="taggableKind">
            <span class="field-label">Tags</span>
            <EntityTagsField
              :entity-id="entityId"
              :kind="taggableKind"
              :entity-name="name || `Untitled ${entityNoun}`"
            />
          </template>
        </div>
      </section>

      <div class="details-rule" />

      <section class="details-group">
        <div class="group-head">
          <span class="group-label">Versions</span>
        </div>

        <!-- Scratch has no versions and needs no essay about it: the Scratch chip
             in the save bar already says where the body lives. -->
        <InlineNote v-if="isScratch" data-testid="no-versions">No versions yet</InlineNote>

        <template v-else>
          <!-- The draft pins above the versions because it is the one row that
               needs a decision: save it or throw it away. -->
          <div
            v-if="editCount > 0"
            class="version-row draft-row"
            :class="{ selected: draftSelected }"
            role="button"
            tabindex="0"
            data-testid="draft-version-row"
            @click="emit('select-draft')"
            @keydown.enter.prevent="emit('select-draft')"
            @keydown.space.prevent="emit('select-draft')"
          >
            <span class="version-name">Draft</span>
            <span class="version-comment">{{ editCount }} {{ editCount === 1 ? 'edit' : 'edits' }}</span>
            <span class="version-age">{{ draftAge }}</span>
            <!-- The slots a version row ends with, held open so the ages line up. -->
            <span class="version-tools" />
            <span v-if="showActionSlot" class="version-action" />
          </div>

          <!--
            Collapsed to the current version and whatever else is being looked
            at: the panel's job is "what am I looking at", not "what happened
            here", and the history is one click below when it is the question.

            Each row is clickable to read that version, and carries its own
            actions — Diff against current, and where the host can persist the
            choice, Set current. The action column is one fixed-width slot so
            the `current` pill and `Set current` occupy the same box and no row
            shifts as the pointer moves across the list.
          -->
          <div
            v-for="option in visibleVersions"
            :key="option.value"
            class="version-row"
            :class="{
              selected: !draftSelected && option.value === selectedVersion,
              current: option.value === currentVersion,
            }"
            role="button"
            tabindex="0"
            data-testid="version-row"
            @click="emit('select-version', option.value)"
            @keydown.enter.prevent="emit('select-version', option.value)"
            @keydown.space.prevent="emit('select-version', option.value)"
          >
            <span class="version-name">v{{ option.label }}</span>
            <!--
              The note, written where it is read. A version's comment is the
              only reason this list is worth reading, and it is optional, so it
              is collected here rather than at the moment of saving: Save stays
              one click, and a note can be added — or corrected — afterwards.

              The text is not itself the control. This cell is the widest part
              of a row whose own job is to open that version, so a button
              spanning it swallows the click most people aim at the row; the
              pencil in the tools at the end of the row is what starts an
              edit, and every handler there stops propagation because reaching
              for the note is not a request to load the version.
            -->
            <input
              v-if="canAnnotateVersions && editingComment === option.value"
              ref="commentInput"
              v-model="commentDraft"
              class="version-comment-input"
              data-testid="version-comment-input"
              :aria-label="`Note on v${option.label}`"
              placeholder="What changed?"
              @click.stop
              @keydown.stop
              @keydown.enter.prevent="commitComment(option)"
              @keydown.esc.prevent="cancelComment"
              @blur="commitComment(option)"
            />
            <span v-else class="version-comment" :class="{ empty: !option.comment }">
              {{ option.comment || option.summary || (canAnnotateVersions ? 'No note' : '—') }}
            </span>
            <!--
              Before the two fixed-width slots that end the row, so the age
              lands on the same edge on every row — including the draft above,
              which has neither a tool nor an action to draw.
            -->
            <span class="version-age">{{ formatRelativeTime(option.dateModified) }}</span>

            <span class="version-tools">
              <button
                v-if="canAnnotateVersions && editingComment !== option.value"
                class="note-button"
                data-testid="version-comment-edit"
                :title="option.comment ? `Edit the note on v${option.label}` : `Add a note to v${option.label}`"
                @click.stop="startComment(option)"
              >
                <PencilLine :size="13" />
              </button>

              <!--
                The version's id, for the same reason the entity's id above has a
                copy button: a caller pinning a version pastes this string, and
                the row shows only the number people read.
              -->
              <button
                class="copy-version-button"
                data-testid="copy-version-id"
                :title="`Copy v${option.label}'s version id`"
                @click.stop="copyVersionId(option)"
              >
                <Copy :size="13" />
              </button>

              <!--
                Against *current*, with no picker: the comparison anyone wants
                from a version list is "what changed since what callers get".
              -->
              <button
                v-if="canCompareVersions && option.value !== currentVersion"
                class="diff-button"
                data-testid="compare-version"
                :title="`Compare v${option.label} with the current version`"
                @click.stop="emit('compare-version', option.value)"
              >
                <GitCompare :size="13" />
              </button>
            </span>

            <span v-if="showActionSlot" class="version-action">
              <span v-if="option.value === currentVersion" class="current-tag" data-testid="current-version-tag">
                current
              </span>
              <button
                v-else-if="canSetCurrentVersion"
                class="set-current-button"
                data-testid="set-current-version"
                :title="`Make v${option.label} the current version`"
                @click.stop="emit('set-current-version', option.value)"
              >
                Set current
              </button>
            </span>
          </div>

          <button
            v-if="hiddenVersionCount > 0 || historyOpen"
            class="history-toggle"
            data-testid="toggle-version-history"
            @click="historyOpen = !historyOpen"
          >
            <component :is="historyOpen ? ChevronUp : ChevronDown" :size="12" />
            {{ historyOpen ? 'Hide history' : `Show history (${hiddenVersionCount})` }}
          </button>

          <InlineNote v-if="versionOptions.length === 0">
            Nothing saved yet — Save turns what is in the editor into v1.
          </InlineNote>
        </template>
      </section>

      <div v-if="showSignature" class="details-rule" />

      <section v-if="showSignature" class="details-group">
        <div class="group-label">Signature</div>
        <!--
          Inputs keep the grouping detection already gives them: each VALUES
          clause is one group, bound together row by row, so its variables sit
          inside one outline. LIMIT and OFFSET are inputs of another kind and
          say so with their keyword.
        -->
        <div class="signature-row" data-testid="signature-inputs">
          <span class="signature-label">Inputs</span>
          <template v-if="hasInputs">
            <span
              v-for="(group, index) in valuesGroups"
              :key="`values-${index}`"
              class="input-group"
              data-testid="signature-input-group"
            >
              <span v-for="variable in group" :key="variable" class="chip-mono">{{ variable }}</span>
            </span>
            <span
              v-for="param in pageParameters"
              :key="`${param.keyword}-${param.name}`"
              class="chip-mono"
              data-testid="signature-page-parameter"
            >
              <span class="chip-keyword">{{ param.keyword }}</span>{{ param.name }}
            </span>
          </template>
          <span v-else class="signature-none">none</span>
        </div>
        <div class="signature-row" data-testid="signature-outputs">
          <span class="signature-label">Outputs</span>
          <em v-if="outputKind === 'none'" class="signature-none">None</em>
          <span v-else-if="outputKind === 'graph'" class="chip-mono">RDF graph</span>
          <span v-else-if="outputKind === 'boolean'" class="chip-mono">boolean</span>
          <template v-else-if="detectedOutputs.length > 0">
            <span v-for="output in detectedOutputs" :key="output" class="chip-mono">{{ output }}</span>
          </template>
          <span v-else class="signature-none">none</span>
        </div>
      </section>

      <!-- Whatever else the section wants on Details and nothing else does. -->
      <slot />
    </div>

    <!--
      The foot of the panel: when this thing was made, and the one action that
      unmakes it. Delete confirms in place rather than in a dialog — the strip
      it sits in is where the answer is wanted, and a dialog over a panel this
      small covers the thing being deleted.
    -->
    <div v-if="showFooter" class="details-footer" data-testid="details-footer">
      <template v-if="deleteConfirming">
        <InlineNote as="span" tone="danger" class="confirm-note">{{ deleteConfirmPrompt }}</InlineNote>
        <button
          class="confirm-delete"
          data-testid="details-confirm-delete"
          :disabled="deleting"
          @click="confirmDelete"
        >
          {{ deleting ? 'Deleting…' : 'Delete' }}
        </button>
        <button class="confirm-cancel" data-testid="details-cancel-delete" @click="deleteConfirming = false">
          Cancel
        </button>
      </template>
      <template v-else>
        <InlineNote v-if="createdLabel" as="span" data-testid="details-created">Created {{ createdLabel }}</InlineNote>
        <button
          v-if="canDelete"
          class="delete-button"
          data-testid="details-delete"
          @click="deleteConfirming = true"
        >
          <Trash2 :size="12" />Delete {{ entityNoun }}
        </button>
      </template>
    </div>
  </div>
</template>

<script lang="ts">
/**
 * The Details tab, for every versioned thing that has one.
 *
 * Identity, versions and (where it has one) signature are the same three
 * groups whether the body is SPARQL, a canvas or an ETL pipeline, so they are
 * declared once here. What varies is only the noun, whether the entity carries
 * a backend of its own, and whether it has a detectable signature; everything
 * else — the draft row pinned above the versions, the `unassigned` library
 * while scratch, the copyable id — is the same decision in all three places
 * and is made once.
 */
export interface DetailsVersionOption {
  value: string;
  label: string;
  /** The note someone wrote on this version, or null where nobody has. */
  comment?: string | null;
  /**
   * What to show in the note's place when there is no note — a data graph's
   * triple count and format, say. Kept apart from `comment` so that editing a
   * version with no note starts from an empty field rather than from a
   * description of the version that nobody typed.
   */
  summary?: string | null;
  dateModified?: string | null;
}

export interface DetailsBackendOption {
  value: string;
  label: string;
}
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ChevronDown, ChevronUp, Copy, GitCompare, PencilLine, Trash2 } from '@lucide/vue';
import { useCopyToClipboard } from '../../composables/useCopyToClipboard';
import type { DetectInputsResponse } from '@sparql-query-lib/contracts';
import { isBooleanQueryType, isGraphQueryType, isQueryTypeIri, isResultSetQueryType } from '@sparql-query-lib/types';
import { formatRelativeTime, formatCompactAge, formatShortDate } from '../../lib/time';
import EntityTagsField from '../tags/EntityTagsField.vue';
import InlineNote from './InlineNote.vue';
import SearchSelect from './SearchSelect.vue';
import type { TaggableKind } from '../../composables/useEntityTags';

const props = withDefaults(defineProps<{
  name: string;
  description: string;
  isScratch: boolean;
  /** The saved entity's id; null while the item is still scratch. */
  entityId: string | null;
  /** Lower-case singular, for the placeholder and the id row: query, group, pipeline. */
  entityNoun?: string;
  /** The selected default backend's id; must appear in `backendOptions`. */
  backendValue?: string;
  backendOptions?: DetailsBackendOption[];
  /** False where the entity has no backend of its own — a query group. */
  showBackend?: boolean;
  /** False where nothing detects inputs and outputs — a group, a pipeline. */
  showSignature?: boolean;
  versionOptions: DetailsVersionOption[];
  selectedVersion: string | null;
  currentVersion: string | null;
  /** Unsaved autosaves held in this browser; 0 means no draft row. */
  editCount: number;
  draftSavedAt: string | null;
  draftSelected: boolean;
  detectedInputs?: DetectInputsResponse | null;
  detectedOutputs?: string[];
  /** The detected query type IRI; decides what the Outputs row lists. */
  queryType?: string | null;
  /**
   * Which taggable kind this entity is, or absent where it is not one.
   *
   * Absent means no Tags row at all, which is the honest rendering for the two
   * kinds the model cannot tag (tags doc §4.6) — a row reading "none" beside a
   * control that always fails would be worse.
   */
  taggableKind?: TaggableKind | null;
  /**
   * True where the entity can be pointed at one of its versions from here.
   *
   * False leaves the version list read-only, which is the honest rendering
   * everywhere the host has nothing to persist the choice with.
   */
  canSetCurrentVersion?: boolean;
  /**
   * True where the host can persist a version's note.
   *
   * False leaves the comment column read-only — the honest rendering wherever
   * nothing is listening for `annotate-version`.
   */
  canAnnotateVersions?: boolean;
  /**
   * True where a version can be diffed against the current one from here.
   *
   * False where the host has no diff view to open, which is every surface but
   * the query work area today.
   */
  canCompareVersions?: boolean;
  /** When the entity was created; absent leaves the footer note out. */
  createdAt?: string | null;
  /**
   * True where deleting from here is wired up. False — the default — leaves
   * the footer's delete out rather than drawing a button that does nothing.
   */
  canDelete?: boolean;
  /** True while the host's delete is in flight, for the button's label. */
  deleting?: boolean;
}>(), {
  entityNoun: 'query',
  backendValue: '',
  backendOptions: () => [],
  showBackend: true,
  showSignature: true,
  detectedInputs: null,
  detectedOutputs: () => [],
  queryType: null,
  taggableKind: null,
  canSetCurrentVersion: false,
  canAnnotateVersions: false,
  canCompareVersions: false,
  createdAt: null,
  canDelete: false,
  deleting: false,
});

const emit = defineEmits<{
  (e: 'update:name', value: string): void;
  (e: 'update:description', value: string): void;
  (e: 'update:backend', value: string): void;
  (e: 'select-version', value: string): void;
  (e: 'set-current-version', value: string): void;
  (e: 'select-draft'): void;
  (e: 'compare-version', value: string): void;
  (e: 'annotate-version', payload: { value: string; comment: string | null }): void;
  (e: 'copy-id'): void;
  (e: 'delete'): void;
}>();

const nameInput = ref<HTMLInputElement | null>(null);

const { copyToClipboard } = useCopyToClipboard();

function copyVersionId(option: DetailsVersionOption) {
  copyToClipboard(option.value, `Copied v${option.label}'s version id`);
}

/*
 * The version note, edited in place on its row.
 *
 * One row at a time: `editingComment` holds the version being annotated, and
 * `commentDraft` the text. Enter and blur both commit — unlike the save prompt
 * this replaced, clicking away here is not destructive, because the version
 * already exists and the worst case is a note saved a moment early. Esc
 * abandons the edit, and committing an unchanged value emits nothing rather
 * than spending a request to write what is already there.
 */
const editingComment = ref<string | null>(null);
const commentDraft = ref('');
const commentInput = ref<HTMLInputElement[] | HTMLInputElement | null>(null);

async function startComment(option: DetailsVersionOption) {
  editingComment.value = option.value;
  commentDraft.value = option.comment ?? '';
  await nextTick();
  const element = Array.isArray(commentInput.value) ? commentInput.value[0] : commentInput.value;
  element?.focus();
  element?.select();
}

function commitComment(option: DetailsVersionOption) {
  if (editingComment.value !== option.value) return;
  const next = commentDraft.value.trim();
  editingComment.value = null;
  // An emptied note is a real edit — it clears the one that was there — so it
  // is sent as null rather than skipped.
  if (next === (option.comment ?? '')) return;
  emit('annotate-version', { value: option.value, comment: next || null });
}

function cancelComment() {
  editingComment.value = null;
}

/*
 * The description box sizes itself to its content.
 *
 * Three lines is the cap: enough that most descriptions are simply readable,
 * few enough that Library, Backend and Tags do not get pushed off the top of
 * the panel by one long paragraph. The measurement is the browser's own —
 * height to `auto`, read `scrollHeight`, set it back — because a character
 * count cannot know where the text wrapped, and the panel is resizable, so
 * where it wraps changes.
 */
const COLLAPSED_LINES = 3;

const descriptionInput = ref<HTMLTextAreaElement | null>(null);
const descriptionExpanded = ref(false);
const descriptionOverflows = ref(false);
const descriptionClamped = computed(() => descriptionOverflows.value && !descriptionExpanded.value);
const descriptionOpened = computed(() => descriptionOverflows.value && descriptionExpanded.value);

function syncDescriptionHeight() {
  const element = descriptionInput.value;
  if (!element) return;

  const styles = getComputedStyle(element);
  const lineHeight = parseFloat(styles.lineHeight) || 18;
  const paddingTop = parseFloat(styles.paddingTop);
  const border = parseFloat(styles.borderTopWidth) + parseFloat(styles.borderBottomWidth);

  element.style.height = 'auto';
  const contentHeight = element.scrollHeight + border;
  /*
   * The clamp leaves the bottom padding out of the height on purpose. A
   * textarea paints overflowing text straight through its bottom padding
   * rather than clipping at the text box, so counting it in would leave the
   * top few pixels of a fourth line peeking under the fade.
   */
  const cappedHeight = lineHeight * COLLAPSED_LINES + paddingTop + border;

  /*
   * The natural padding is symmetric, so the threshold counts the top one
   * twice rather than reading the bottom one: an opened box pads its bottom
   * out to keep the text from running under "less", and measuring that would
   * make opening it look like it no longer overflows — which would close it
   * again, and so on.
   *
   * The extra pixel is slack: sub-pixel line heights otherwise report a
   * description that fits its three lines exactly as overflowing them.
   */
  descriptionOverflows.value =
    contentHeight > lineHeight * COLLAPSED_LINES + paddingTop * 2 + border + 1;
  element.style.height = `${descriptionClamped.value ? cappedHeight : contentHeight}px`;
}

function onDescriptionInput(event: Event) {
  emit('update:description', (event.target as HTMLTextAreaElement).value);
  // Typing past the cap grows the box while it is open, and reveals "more"
  // while it is not.
  void nextTick(syncDescriptionHeight);
}

function toggleDescription() {
  descriptionExpanded.value = !descriptionExpanded.value;
  void nextTick(syncDescriptionHeight);
}

// Loading another entity replaces the text without anyone typing, and dragging
// the splitter rewraps it without the text changing at all. Both change how
// tall it needs to be.
watch(() => props.description, () => {
  descriptionExpanded.value = false;
  void nextTick(syncDescriptionHeight);
});

let descriptionResizeObserver: ResizeObserver | null = null;

onMounted(() => {
  syncDescriptionHeight();
  if (typeof ResizeObserver === 'undefined' || !descriptionInput.value) return;
  descriptionResizeObserver = new ResizeObserver(() => syncDescriptionHeight());
  descriptionResizeObserver.observe(descriptionInput.value);
});

onBeforeUnmount(() => {
  descriptionResizeObserver?.disconnect();
  descriptionResizeObserver = null;
});

// The save bar sends an unnamed item here rather than growing a second
// name field of its own.
defineExpose({
  focusName: () => {
    nameInput.value?.focus();
    nameInput.value?.select();
  },
});

/*
 * The list folds to what is being looked at, and opens to the whole history.
 *
 * Collapsed shows the current version and — when it is a different one — the
 * version selected in the editor, because a list that hid the row you are
 * reading would be lying about what is on screen. Everything else is history,
 * and history is a click away rather than a scroll.
 */
const historyOpen = ref(false);

const visibleVersions = computed(() => {
  if (historyOpen.value) return props.versionOptions;
  const kept = props.versionOptions.filter((option) => (
    option.value === props.currentVersion
    || (!props.draftSelected && option.value === props.selectedVersion)
  ));
  // Nothing is current and nothing is selected — a version list still has to
  // show something, so it shows the newest.
  if (kept.length === 0 && props.versionOptions.length > 0) return props.versionOptions.slice(0, 1);
  return kept;
});

const hiddenVersionCount = computed(() => props.versionOptions.length - visibleVersions.value.length);

/*
 * One fixed-width slot for the row's action, so `current` and `Set current`
 * occupy the same box: without it the rows are two different shapes and the
 * list re-flows as the pointer moves down it. Absent entirely where neither
 * can appear — a read-only list with nothing marked current has no action
 * column to reserve.
 */
const showActionSlot = computed(() => props.canSetCurrentVersion || props.currentVersion !== null);

const createdLabel = computed(() => formatShortDate(props.createdAt));

const showFooter = computed(() => props.canDelete || !!createdLabel.value);

const deleteConfirming = ref(false);

const deleteConfirmPrompt = computed(() => {
  const count = props.versionOptions.length;
  if (count === 0) return `Delete this ${props.entityNoun}?`;
  if (count === 1) return `Delete this ${props.entityNoun} and its one version?`;
  return `Delete this ${props.entityNoun} and all ${count} versions?`;
});

function confirmDelete() {
  emit('delete');
}

/*
 * Switching entity closes both: the history that was open was the other
 * entity's, and so was the delete being confirmed. A failed delete leaves the
 * confirm strip up with the button ready to try again — the host unmounts the
 * panel on success, so nothing here has to close it.
 */
watch(() => props.entityId, () => {
  historyOpen.value = false;
  deleteConfirming.value = false;
});

const idLabel = computed(() => `${props.entityNoun.charAt(0).toUpperCase()}${props.entityNoun.slice(1)} ID`);

const draftAge = computed(() => formatCompactAge(props.draftSavedAt) || 'just now');

// Each VALUES clause is its own group of inputs: its variables are bound
// together, a row at a time, which is why an argument set can carry more than
// one set of bindings.
const valuesGroups = computed(() => props.detectedInputs?.valuesInputs ?? []);

const pageParameters = computed(() => [
  ...(props.detectedInputs?.limitParameters ?? []).map((name) => ({ keyword: 'LIMIT', name })),
  ...(props.detectedInputs?.offsetParameters ?? []).map((name) => ({ keyword: 'OFFSET', name })),
]);

const hasInputs = computed(() => valuesGroups.value.length > 0 || pageParameters.value.length > 0);

/*
 * What a query hands back follows from its form: SELECT its variables, ASK a
 * boolean, CONSTRUCT and DESCRIBE a graph, and an update nothing at all. An
 * unknown type falls back to listing whatever variables were detected.
 */
const outputKind = computed<'variables' | 'boolean' | 'graph' | 'none'>(() => {
  const type = props.queryType;
  if (!type) return 'variables';
  if (isBooleanQueryType(type)) return 'boolean';
  if (isGraphQueryType(type)) return 'graph';
  if (isResultSetQueryType(type)) return 'variables';
  return isQueryTypeIri(type) ? 'none' : 'variables';
});
</script>

<style scoped>
.details-panel {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

.details-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-5);
  min-height: 0;
  padding: var(--space-5);
  overflow: auto;
}

.details-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.group-head {
  display: flex;
  align-items: baseline;
  gap: var(--space-4);
}

.group-label {
  color: var(--ink-muted);
  font-size: var(--text-label);
  font-weight: var(--weight-semibold);
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.details-rule {
  height: 1px;
  background: var(--border-subtle);
}

.identity-grid {
  display: grid;
  /* Wide enough for "Default Backend" on one line — the longest label here. */
  grid-template-columns: 104px 1fr;
  gap: var(--space-4) var(--space-5);
  align-items: center;
  font-size: var(--text-body);
}

.field-label {
  color: var(--ink-muted);
}

/* The two rows whose value is taller than one control keep their label on the
   first line of it rather than centred against the whole box. */
.description-label {
  align-self: start;
  padding-top: var(--space-3);
}

.id-label {
  align-self: start;
  padding-top: var(--space-2);
}

.field-value {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
}

.field-mono {
  color: var(--ink-secondary);
  font-family: var(--font-mono);
}

/* An id is one long unbroken token, so it wraps mid-string or not at all — and
   not at all means the panel scrolls sideways. */
.id-field {
  align-items: flex-start;
  overflow: visible;
}

.id-text {
  min-width: 0;
  font-size: var(--text-label);
  line-height: 16px;
  word-break: break-all;
}

.field-input {
  box-sizing: border-box;
  min-width: 0;
  height: var(--control-h);
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink);
  font-family: inherit;
  font-size: var(--text-body);
}

.description-field {
  position: relative;
  min-width: 0;
}

/* An opened box keeps a line's worth of room at the bottom so the last
   sentence does not run under "less". */
.description-field.opened .description-input {
  padding-bottom: var(--space-7);
}

/* No manual resize handle: the box already sizes itself, and a dragged corner
   would fight the measurement. */
.description-input {
  display: block;
  width: 100%;
  height: auto;
  padding-top: var(--space-2);
  padding-bottom: var(--space-2);
  overflow: hidden;
  line-height: 18px;
  resize: none;
}

/*
 * The fade is the tell. It sits on the last visible line so the text looks cut
 * off before you read the word, and "more" rides on a scrim of the field's own
 * background so it stays legible over whatever the sentence happens to be.
 */
.description-field.clamped::after {
  position: absolute;
  right: 1px;
  bottom: 1px;
  left: 1px;
  height: 18px;
  border-radius: 0 0 var(--radius) var(--radius);
  background: linear-gradient(to right, transparent 55%, var(--surface) 88%);
  content: '';
  pointer-events: none;
}

.description-toggle {
  /* Above the fade: the gradient is opaque where the word sits, so without
     this the pseudo-element paints straight over it. */
  position: absolute;
  z-index: 1;
  right: 6px;
  bottom: 4px;
  padding: 0 var(--space-1);
  border: none;
  background: var(--surface);
  color: var(--action);
  font-family: inherit;
  font-size: var(--text-label);
  font-weight: var(--weight-semibold);
  cursor: pointer;
}

.description-toggle:hover {
  text-decoration: underline;
}

.copy-button {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: var(--radius);
  background: transparent;
  color: var(--ink-muted);
  cursor: pointer;
}

.copy-button:hover {
  background: var(--surface-sunken);
  color: var(--ink);
}

.version-row {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius);
  background: transparent;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}

.version-row:hover {
  border-color: var(--border-strong);
}

.version-row:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring);
  outline-offset: 1px;
}

.version-row.current {
  border-color: var(--action-border);
  background: var(--action-surface);
}

.version-row.selected {
  border-color: var(--action);
}

.draft-row {
  border: 1px dashed var(--warning-border);
  background: var(--warning-surface);
}

.version-name {
  flex-shrink: 0;
  color: var(--ink-secondary);
  font-size: var(--text-body);
  font-weight: var(--weight-semibold);
}

.draft-row .version-name {
  color: var(--warning-ink);
}

.version-row.current .version-name {
  color: var(--action-ink);
}

.version-comment {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--ink-secondary);
  font-size: var(--text-body);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.draft-row .version-comment {
  color: var(--warning-ink);
}

/*
 * Muted wherever the text is not a note somebody wrote — "No note", or the
 * summary standing in for one.
 */
.version-comment.empty {
  color: var(--ink-muted);
  font-style: italic;
}

/*
 * The pencil, drawn like the diff button beside it: quiet until the row is
 * under the pointer, so eight rows of icons do not drown the version numbers
 * they sit beside. Focus brings it back for anyone arriving by keyboard.
 */
.note-button {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--ink-muted);
  opacity: 0;
  cursor: pointer;
}

.version-row:hover .note-button,
.note-button:focus-visible,
.version-row:hover .copy-version-button,
.copy-version-button:focus-visible {
  opacity: 1;
}

/* Drawn like the pencil: an id is wanted rarely, and only once you are on the row. */
.copy-version-button {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--ink-muted);
  opacity: 0;
  cursor: pointer;
}

.note-button:hover,
.copy-version-button:hover {
  background: var(--surface-raised);
  color: var(--action);
}

.version-comment-input {
  flex: 1;
  min-width: 0;
  box-sizing: border-box;
  height: 22px;
  padding: 0 var(--space-3);
  border: 1px solid var(--action);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink);
  font-family: inherit;
  font-size: var(--text-body);
  outline: none;
}

.version-age {
  flex-shrink: 0;
  color: var(--ink-muted);
  font-size: var(--text-label);
  white-space: nowrap;
}

/* Quiet until wanted: the row is for reading a version, and comparing it with
   current is the rarer of the two. */
.diff-button {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: var(--radius);
  background: transparent;
  color: var(--ink-muted);
  cursor: pointer;
}

.diff-button:hover {
  background: var(--surface-raised);
  color: var(--ink);
}

/*
 * The row's tools, in a slot of their own width: a current version has no
 * Diff button and the draft has no tools at all, and without a fixed box the
 * age beside them would sit at three different depths down the list.
 *
 * At the end of the row rather than beside the age, so the middle of a row —
 * where a click aimed at "this version" lands — is text rather than a button
 * that means something else.
 */
.version-tools {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);
  width: 74px;
}

/*
 * One slot, one width. `current` and `Set current` are different lengths, and
 * letting each size itself made every row a different shape and the list
 * re-flow under the pointer.
 */
.version-action {
  display: flex;
  flex-shrink: 0;
  justify-content: flex-end;
  width: 70px;
}

.set-current-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: var(--radius);
  background: transparent;
  color: var(--ink-muted);
  font-family: inherit;
  font-size: var(--text-label);
  white-space: nowrap;
  cursor: pointer;
}

.set-current-button:hover {
  background: var(--surface-raised);
  color: var(--ink);
}

.current-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 20px;
  border-radius: var(--radius);
  background: var(--action-border);
  color: var(--action-ink);
  font-size: var(--text-label);
  font-weight: var(--weight-semibold);
  white-space: nowrap;
}

.history-toggle {
  display: inline-flex;
  align-self: flex-start;
  align-items: center;
  gap: var(--space-2);
  height: 20px;
  margin-left: calc(var(--space-2) * -1);
  padding: 0 var(--space-2);
  border: none;
  border-radius: var(--radius);
  background: transparent;
  color: var(--ink-muted);
  font-family: inherit;
  font-size: var(--text-label);
  cursor: pointer;
}

.history-toggle:hover {
  background: var(--surface-sunken);
  color: var(--ink);
}

.signature-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
}

.signature-label {
  width: 48px;
  flex-shrink: 0;
  color: var(--ink-muted);
  font-size: var(--text-body);
}

.signature-none {
  color: var(--ink-muted);
  font-size: var(--text-body);
}

.input-group {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-full);
}

.chip-keyword {
  margin-right: var(--space-2);
  color: var(--ink-muted);
  font-weight: var(--weight-semibold);
}

.chip-mono {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-full);
  background: var(--surface-subtle);
  color: var(--ink-secondary);
  font-family: var(--font-mono);
  font-size: var(--text-label);
}

.details-footer {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: var(--space-4);
  box-sizing: border-box;
  /* Same band as the Results tab's footer: switching tabs must not move it. */
  min-height: var(--panel-bar-h);
  padding: var(--space-4) var(--space-5);
  border-top: 1px solid var(--border-subtle);
  background: var(--surface-subtle);
}

/* Destructive, and last in the row: red enough to read as the one action here
   that cannot be undone, quiet enough that it is not what the eye lands on. */
.delete-button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: var(--control-h-sm);
  margin-left: auto;
  padding: 0 var(--space-4);
  border: none;
  border-radius: var(--radius);
  background: transparent;
  color: var(--danger-active);
  font-family: inherit;
  font-size: var(--text-label);
  font-weight: var(--weight-medium);
  cursor: pointer;
}

.delete-button:hover {
  background: var(--danger-surface);
  color: var(--danger-ink);
}

/* The width is the footer row's fact: the prompt shrinks so the buttons do not. */
.confirm-note {
  min-width: 0;
}

.confirm-delete {
  height: var(--control-h-sm);
  margin-left: auto;
  padding: 0 var(--space-4);
  border: 1px solid var(--danger);
  border-radius: var(--radius);
  background: var(--danger);
  color: var(--danger-fg);
  font-family: inherit;
  font-size: var(--text-label);
  font-weight: var(--weight-semibold);
  cursor: pointer;
}

.confirm-delete:hover:not(:disabled) {
  background: var(--danger-hover);
}

.confirm-delete:disabled {
  cursor: default;
  opacity: 0.7;
}

.confirm-cancel {
  height: var(--control-h-sm);
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink-secondary);
  font-family: inherit;
  font-size: var(--text-label);
  cursor: pointer;
}

.confirm-cancel:hover {
  border-color: var(--border-strong);
  color: var(--ink);
}
</style>
