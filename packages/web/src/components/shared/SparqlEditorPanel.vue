<template>
  <section class="editor-section">
    <VersionToolbar
      v-if="chrome === 'full'"
      :title="editorTitle"
      :version-options="versionOptions"
      :selected-version="selectedVersion"
      :version-id="versionId"
      :is-new-entity="isNewEntity"
      :is-saving="isSaving"
      :is-loading="isLoading"
      :show-execution-row="showExecutionRow"
      :show-format-button="showFormatButton"
      :hide-version-selector="hideVersionSelector"
      :hide-save-buttons="hideSaveButtons"
      :hide-more-actions="hideMoreActions"
      :show-invalid-save-option="showInvalidSaveOption"
      :save-title="`Save ${editorTitle}`"
      :show-diff-button="showDiffButton"
      :diff-active="diffActive"
      :diff-title="diffTitle"
      :execution-placement="executionPlacement"
      @update:selectedVersion="(value) => $emit('update:selectedVersion', value)"
      @save="$emit('save')"
      @save-new-version="$emit('save-new-version')"
      @save-invalid="$emit('save-invalid')"
      @request-focus="$emit('request-focus')"
      @delete="$emit('delete')"
      @clone="$emit('clone')"
      @move="$emit('move')"
      @copy-version-id="$emit('copy-version-id')"
      @toggle-diff="$emit('toggle-diff')"
    >
      <template v-if="showPrefixButtons" #editor-actions>
        <PrefixConversionButtons
          :code="sparqlCode"
          :content-type="contentType"
          @update:code="(value: string) => $emit('update:sparqlCode', value)"
        />
      </template>

      <template #format-button>
        <button
          class="btn-compact"
          title="Format code (normalises formatting and prefixes)"
          :disabled="!sparqlCode || sparqlCode.trim().length === 0"
          @click="$emit('request-format')"
        >
          <WandSparkles :size="12" />
          Format
        </button>
      </template>

      <template #execution-row>
        <div v-if="!hideBackendSelector" class="backend-selector-group">
          <SectionLabel as="span">Backend:</SectionLabel>
          <!--
            Typed at rather than scrolled — the run row's two entity pickers
            (this and Arguments) name things the library holds many of. The
            media type between them is a fixed, grouped vocabulary and keeps
            its list.
          -->
          <SearchSelect
            class="backend-trigger-compact"
            test-id="sparql-backend-selector"
            aria-label="Backend"
            placeholder="Select backend"
            :disabled="isNewEntity || isLoading || backendsLoading"
            :model-value="selectedBackend ?? null"
            :options="backendOptions"
            @update:model-value="$emit('update:selectedBackend', $event)"
          />
        </div>

        <slot name="pre-mediatype-controls" />

        <div class="mediatype-selector-group">
          <SectionLabel for="sparql-mediatype-selector" as="label">Mediatype:</SectionLabel>
          <Select
            :model-value="selectedMediaType ?? undefined"
            :disabled="isNewEntity || isLoading"
            @update:model-value="$emit('update:selectedMediaType', $event as string)"
          >
            <SelectTrigger
              id="sparql-mediatype-selector"
              class="mediatype-trigger-compact"
              :disabled="isNewEntity || isLoading"
            >
              <SelectValue placeholder="Select format" />
            </SelectTrigger>
            <MediaTypeSelectContent
              :groups="groupedMediaTypeOptions"
              :query-type="props.queryType ?? null"
            />
          </Select>
        </div>

        <div v-if="showArgumentSelector" class="argumentset-selector-group">
          <SectionLabel as="span">Arguments:</SectionLabel>
          <SearchSelect
            class="argumentset-trigger-compact"
            test-id="sparql-argumentset-selector"
            aria-label="Arguments"
            placeholder="None"
            empty-label="None"
            :disabled="isNewEntity || isLoading || argumentSetLoading || isDirty"
            :model-value="selectedArgumentSetId ?? null"
            :options="argumentSetOptions"
            @update:model-value="(value) => $emit('update:selectedArgumentSetId', value || null)"
          />
        </div>

        <div class="execution-actions">
          <div class="button-group-compact">
            <button
              class="btn-compact btn-primary"
              :title="executeButtonTitle"
              :disabled="isExecuteDisabled"
              @click="$emit('execute')"
            >
              <Play :size="12" />
              Execute
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <button
                  class="btn-compact btn-primary btn-dropdown-toggle"
                  title="Execute Options"
                  :disabled="isExecuteDisabled"
                >
                  <ChevronDown :size="12" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled class="text-[12px]" @click="$emit('request-benchmark')">
                  Create Benchmark
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <button
            v-if="!hideCodeButton"
            class="btn-compact"
            title="Code"
            :disabled="isNewEntity"
            @click="$emit('request-code-dialog')"
          >
            <Code :size="12" />
            Code
          </button>
        </div>
      </template>
    </VersionToolbar>

    <!-- Validation Status Banner (always reserves space) -->
    <div
      v-if="chrome === 'full'"
      class="validation-banner"
      :class="{
        'validation-validating': bannerState === 'validating',
        'validation-valid': bannerState === 'valid',
        'validation-error': bannerState === 'error',
        'validation-placeholder': bannerState === 'placeholder',
        'validation-mixed': bannerState === 'mixed'
      }"
    >
      <!-- Empty query state -->
      <div v-if="displayValidationState === 'idle' && !sparqlCode.trim()" class="validation-content">
        <span class="validation-message validation-message-empty">No {{ validationTargetLabel }} to validate</span>
      </div>

      <!-- Validation content (always show rows to prevent jitter) -->
      <div v-else class="validation-rows">
        <div
          v-for="(row, index) in effectiveValidationRows"
          :key="row.label ? `${row.label}-${index}` : index"
          class="validation-content validation-row"
          :class="`validation-row-${getRowState(row)}`"
        >
          <Loader2
            v-if="getRowState(row) === 'validating' || getRowState(row) === 'idle'"
            :size="14"
            class="validation-icon validation-icon-spin"
          />
          <CheckCircle2
            v-else-if="getRowState(row) === 'valid'"
            :size="14"
            class="validation-icon"
          />
          <AlertCircle
            v-else-if="getRowState(row) === 'error'"
            :size="14"
            class="validation-icon"
          />
          <div class="validation-row-text">
            <span v-if="row.label" class="validation-row-label">{{ row.label }}:</span>
            <span class="validation-message" :class="{ 'validation-message-expandable': getRowState(row) === 'error' }">
              {{ getValidationMessage(row) }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!--
      The header row over the code, drawn only by the minimal chrome: the full
      chrome's version toolbar is already this row, and a second one under it
      would name the editor twice. It carries the editor's name and the
      controls that act on the document, which is where they belong — in a row
      with each other rather than floating over the first line of it.

      Popped out, the row stays and loses its two redundant parts: the title,
      which the pop-out's own header already carries, and Expand, whose job is
      done by the Close beside that title. What is left is the same strip of
      document controls in the same place relative to the code, so the editor
      does not change shape when it is enlarged.
    -->
    <PanelHeader v-if="expandable" :title="expanded ? undefined : editorTitle" sunken>
      <template #actions>
        <!--
          What the section wants to do *to the document*, beside the control
          that enlarges it — the rules screen puts Format, Import and Diff
          here. They belong in this row rather than in the save bar above,
          which is about the item and its versions rather than the text.

          Named for the row it sits in, not for the editor: `editor-actions` is
          already the full chrome's slot, passed through to `VersionToolbar`
          above.
        -->
        <slot name="header-actions" />
        <ExpandButton
          v-if="!expanded"
          :subject="editorTitle.toLowerCase()"
          testid="sparql-editor-expand"
          @click="$emit('request-expand')"
        />
      </template>
    </PanelHeader>

    <div class="editor-container" :class="{ 'with-overlay': editorOverlayActive }">
      <!--
        The editor sits in a box of its own rather than directly under the
        container, so that dimming it while a document loads is one property
        on one element. Dimming the container's children instead would mean
        the same `opacity` the swap below animates, with the two taking turns
        over it.
      -->
      <div class="editor-surface">
        <!--
          `documentKey` re-creates the editor when a different document takes
          over it, and with it the undo history — see `useEditorDocumentKey`.
          Without that, one Ctrl-Z after switching queries pulls the previous
          query's text back into the editor. Re-creating it is a hard cut,
          which is what the cross-fade is for.
        -->
        <CodeSwapTransition>
          <Codemirror
            :key="documentKey ?? undefined"
            :model-value="sparqlCode"
            :placeholder="placeholder"
            :style="{ height: '100%', minHeight: '200px' }"
            :autofocus="autofocusEditor"
            :indent-with-tab="true"
            :tab-size="2"
            :extensions="extensions"
            @update:model-value="$emit('update:sparqlCode', $event)"
            @ready="(payload) => handleEditorReady(payload.view)"
          />
        </CodeSwapTransition>
      </div>
      <Transition name="panel-scrim">
        <div v-if="editorOverlayActive" class="panel-overlay">
          {{ editorOverlayMessage }}
        </div>
      </Transition>
    </div>

    <!--
      The minimal chrome's footer. Everything the version toolbar used to carry
      above the code that a query still needs — how it validated, how big it is,
      and how to run it — comes back in here, below the editor, where the
      mockup puts it.
    -->
    <slot name="footer" />

    <!-- Query Outputs Banner (always reserves space) -->
    <div v-if="showQueryOutputs" class="validation-banner outputs-banner">
      <!-- Placeholder content when no outputs and no query type detected -->
      <div v-if="(!detectedOutputs || detectedOutputs.length === 0) && !queryType" class="validation-content">
        <Loader
          :size="14"
          class="validation-icon validation-icon-spin"
        />
        <span class="outputs-label">Query Outputs</span>
      </div>
      
      <!-- Content when query type is known but no outputs (or ASK query) -->
      <div v-else-if="(!detectedOutputs || detectedOutputs.length === 0 || queryType === QueryTypeIri.ask) && queryType" class="validation-content">
        <span class="outputs-label">Query Outputs</span>
        <span v-if="queryType === QueryTypeIri.ask" class="output-type-label">boolean</span>
        <span v-else-if="queryType === QueryTypeIri.describe || queryType === QueryTypeIri.construct" class="output-type-label">RDF triples</span>
        <span v-else-if="queryType === QueryTypeIri.update" class="output-type-label">(None - update query)</span>
      </div>
      
      <!-- Actual outputs content (only for SELECT queries) -->
      <div v-else class="validation-content">
        <span class="outputs-label">Query Outputs</span>
        <div class="outputs-list">
          <span v-for="output in detectedOutputs" :key="output" class="output-badge">
            {{ output }}
          </span>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { Codemirror } from 'vue-codemirror';
import { ChevronDown, Code, Play, AlertCircle, CheckCircle2, Loader2, WandSparkles, Loader, AlertTriangle } from '@lucide/vue';
import DropdownMenu from '../ui/dropdown-menu/DropdownMenu.vue';
import DropdownMenuContent from '../ui/dropdown-menu/DropdownMenuContent.vue';
import DropdownMenuItem from '../ui/dropdown-menu/DropdownMenuItem.vue';
import DropdownMenuTrigger from '../ui/dropdown-menu/DropdownMenuTrigger.vue';
import SearchSelect from './SearchSelect.vue';
import Select from '../ui/select/Select.vue';
import SelectContent from '../ui/select/SelectContent.vue';
import SelectItem from '../ui/select/SelectItem.vue';
import SelectTrigger from '../ui/select/SelectTrigger.vue';
import SelectValue from '../ui/select/SelectValue.vue';
import MediaTypeSelectContent from './MediaTypeSelectContent.vue';
import VersionToolbar, { type VersionOption } from './VersionToolbar.vue';
import ExpandButton from './ExpandButton.vue';
import PanelHeader from './PanelHeader.vue';
import SectionLabel from './SectionLabel.vue';
import CodeSwapTransition from './CodeSwapTransition.vue';
import type { Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { getGroupedMediaTypeOptions, type QueryType } from '@/lib/mediaTypes';
import { QueryTypeIri } from '@sparql-query-lib/types';
import { usePrefixDiscovery } from '@/composables/usePrefixDiscovery';
import PrefixConversionButtons from '@/components/shared/PrefixConversionButtons.vue';

type BackendOption = { value: string; label: string };
type GrammarValidationResult = {
  grammar: string;
  valid: boolean;
  normalized?: string;
  error?: string;
};
type ValidationRow = {
  label?: string;
  grammar?: string;
  validatingText?: string;
  validText?: string;
  errorText?: string;
};

const emit = defineEmits<{
  (e: 'update:sparqlCode', value: string): void;
  (e: 'update:selectedVersion', value: string): void;
  (e: 'save'): void;
  (e: 'save-new-version'): void;
  (e: 'delete'): void;
  (e: 'clone'): void;
  (e: 'move'): void;
  (e: 'save-invalid'): void;
  (e: 'request-focus'): void;
  (e: 'request-expand'): void;
  (e: 'update:selectedBackend', value: string): void;
  (e: 'update:selectedMediaType', value: string): void;
  (e: 'update:selectedArgumentSetId', value: string | null): void;
  (e: 'execute'): void;
  (e: 'request-code-dialog'): void;
  (e: 'request-benchmark'): void;
  (e: 'copy-version-id'): void;
  (e: 'request-format'): void;
  (e: 'toggle-diff'): void;
  /**
   * The live CodeMirror view.
   *
   * Only for callers that must talk to the editor rather than to its text —
   * the rules screen dispatches its stratum bands into the gutter and scrolls
   * to a rule when one is picked in the outline.
   */
  (e: 'editor-ready', view: EditorView): void;
}>();

const props = withDefaults(defineProps<{
  editorTitle: string;
  placeholder?: string;
  sparqlCode: string;
  selectedVersion: string | null;
  versionId?: string | null;
  versionOptions: VersionOption[];
  isNewEntity: boolean;
  isSaving: boolean;
  isLoading: boolean;
  editorOverlayActive: boolean;
  editorOverlayMessage: string;
  editorHeight?: number;
  extensions: Extension[];
  showExecutionRow?: boolean;
  showFormatButton?: boolean;
  /**
   * The prefix/expand pair beside Format. On by default: every document these
   * panels hold is one whose IRIs a prefix can shorten.
   */
  showPrefixButtons?: boolean;
  /**
   * What the editor is holding. Only the prefix conversions read it — they may
   * only run against a grammar that actually describes the document, and the
   * rules screen hosts SRL in this same panel. SPARQL by default, which is
   * what every other host puts in it.
   */
  contentType?: string | null;
  showQueryOutputs?: boolean;
  selectedBackend?: string | null;
  backendOptions?: BackendOption[];
  hideBackendSelector?: boolean;
  hideSaveButtons?: boolean;
  hideMoreActions?: boolean;
  hideCodeButton?: boolean;
  selectedMediaType?: string | null;
  argumentSetOptions?: { value: string; label: string }[];
  selectedArgumentSetId?: string | null;
  argumentSetLoading?: boolean;
  backendsLoading?: boolean;
  validationState?: 'idle' | 'validating' | 'valid' | 'error';
  validationError?: string | null;
  queryType?: QueryType;
  detectedOutputs?: string[];
  validationLabel?: string;
  validationRows?: ValidationRow[];
  validationResults?: GrammarValidationResult[];
  isDirty?: boolean;
  showArgumentSelector?: boolean;
  hideVersionSelector?: boolean;
  showInvalidSaveOption?: boolean;
  showDiffButton?: boolean;
  diffActive?: boolean;
  diffTitle?: string;
  executionPlacement?: 'row' | 'inline';
  /**
   * 'full'    — the version toolbar, the validation banner and the outputs
   *             strip, which is what Rules and Data Blocks still want.
   * 'minimal' — none of them. The query work area moved identity to the
   *             Details tab and version switching with it, so the only chrome
   *             left is a footer strip: validity, size, and how to run it.
   */
  chrome?: 'full' | 'minimal';
  allowExecuteOnValidationError?: boolean;
  /**
   * Draws the header row over the code, with the Expand button in it. The
   * caller owns the region it expands into — this panel sits inside a work
   * area, and what should come along with the editor is a question only the
   * screen around it can answer.
   */
  expandable?: boolean;
  /** True while this editor is the one popped out, which hides the button. */
  expanded?: boolean;
  /**
   * Where this document lives, as a prefix-source token (see
   * `lib/prefixSources.ts`). The declarations in it are registered with the
   * prefix manager as they are typed — a query and a rule set both teach the
   * app their prefixes, and both say which item taught them.
   */
  prefixSource?: string | null;
  /**
   * Names the document in the editor, so that a different one arrives in a
   * fresh instance with an empty undo history. Built by
   * `useEditorDocumentKey`, which is where the reasoning about *when* it
   * changes lives. Left off, the editor is never re-created — right for a
   * panel that only ever holds one document.
   */
  documentKey?: string | null;
}>(), {
  placeholder: 'Enter SPARQL code...',
  versionId: null,
  editorHeight: 100,
  showExecutionRow: false,
  showFormatButton: true,
  showPrefixButtons: true,
  contentType: 'application/sparql-query',
  showQueryOutputs: true,
  selectedBackend: null,
  backendOptions: () => [],
  hideBackendSelector: false,
  hideSaveButtons: false,
  hideMoreActions: false,
  hideCodeButton: false,
  selectedMediaType: null,
  argumentSetOptions: () => [],
  selectedArgumentSetId: null,
  argumentSetLoading: false,
  backendsLoading: false,
  validationState: 'idle',
  validationError: null,
  queryType: null,
  detectedOutputs: () => [],
  validationLabel: 'query',
  validationRows: () => [],
  validationResults: () => [],
  isDirty: false,
  showArgumentSelector: true,
  hideVersionSelector: false,
  showInvalidSaveOption: false,
  showDiffButton: false,
  diffActive: false,
  diffTitle: 'Compare Versions',
  executionPlacement: 'row',
  chrome: 'full',
  allowExecuteOnValidationError: false,
  expandable: false,
  expanded: false,
  prefixSource: undefined,
  documentKey: undefined,
});

/*
 * Prefixes are learned from the document on screen, not from the save that
 * may never come: a draft never saved and a version never re-opened both
 * declare their prefixes in the text you are looking at.
 */
usePrefixDiscovery(() => props.sparqlCode, () => props.prefixSource);

/*
 * Re-creating the editor for a new document costs the focus that was in the
 * old one, and the pop-out's Expand button is not where the caret was. So the
 * instance that leaves says whether it had focus, and the one that replaces it
 * takes it back; `autofocus` is left to the very first mount, which is the
 * only one that is not a replacement.
 */
const editorView = shallowRef<EditorView | null>(null);
const autofocusEditor = ref(true);
let editorHadFocus = false;

watch(
  () => props.documentKey,
  () => {
    editorHadFocus = editorView.value?.hasFocus ?? false;
  },
);

const handleEditorReady = (view: EditorView) => {
  editorView.value = view;
  autofocusEditor.value = false;
  if (editorHadFocus) {
    editorHadFocus = false;
    view.focus();
  }
  emit('editor-ready', view);
};

// Compute grouped media type options based on query type
const groupedMediaTypeOptions = computed(() => {
  return getGroupedMediaTypeOptions(props.queryType ?? null);
});

const validationTargetLabel = computed(() => props.validationLabel?.trim() || 'query');
const capitalizedValidationTargetLabel = computed(() => {
  const label = validationTargetLabel.value;
  return label.length ? label.charAt(0).toUpperCase() + label.slice(1) : 'Entry';
});

const displayValidationState = ref(props.validationState);
let validatingTimer: ReturnType<typeof setTimeout> | null = null;

const clearValidatingTimer = () => {
  if (!validatingTimer) return;
  clearTimeout(validatingTimer);
  validatingTimer = null;
};

watch(
  () => props.validationState,
  (nextState) => {
    if (nextState === 'validating') {
      clearValidatingTimer();
      validatingTimer = setTimeout(() => {
        if (props.validationState === 'validating') {
          displayValidationState.value = 'validating';
        }
        validatingTimer = null;
      }, 50);
      return;
    }

    clearValidatingTimer();
    displayValidationState.value = nextState;
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  clearValidatingTimer();
});

type BannerState = 'idle-empty' | 'placeholder' | 'validating' | 'valid' | 'error' | 'mixed';

const bannerState = computed<BannerState>(() => {
  const code = props.sparqlCode?.trim() || '';

  if (displayValidationState.value === 'idle' && !code) {
    return 'idle-empty';
  }

  if (displayValidationState.value === 'idle' && code) {
    return 'placeholder';
  }

  const rowStates = effectiveValidationRows.value.map((row) => getRowState(row));
  const hasValidating = rowStates.some((state) => state === 'validating');
  if (hasValidating) {
    return 'validating';
  }

  const hasError = rowStates.some((state) => state === 'error');
  const hasValid = rowStates.some((state) => state === 'valid');

  if (hasError && hasValid) {
    return 'mixed';
  }
  if (hasError) {
    return 'error';
  }
  if (hasValid) {
    return 'valid';
  }

  return 'validating';
});

const validationResultsByGrammar = computed(() => {
  const map = new Map<string, GrammarValidationResult>();
  (props.validationResults ?? []).forEach((result) => {
    if (result && typeof result.grammar === 'string') {
      map.set(result.grammar, result);
    }
  });
  return map;
});

const effectiveValidationRows = computed<ValidationRow[]>(() => {
  if (props.validationRows && props.validationRows.length > 0) {
    return props.validationRows;
  }
  return [
    {
      validText: `${capitalizedValidationTargetLabel.value} is valid`,
      validatingText: `Validating ${validationTargetLabel.value}...`,
      errorText: props.validationError ?? `Invalid ${validationTargetLabel.value}`,
    },
  ];
});

type RowState = 'validating' | 'valid' | 'error' | 'idle';

const getRowState = (row: ValidationRow): RowState => {
  if (displayValidationState.value === 'validating') {
    return 'validating';
  }

  if (row.grammar) {
    const result = validationResultsByGrammar.value.get(row.grammar);
    if (result) {
      return result.valid ? 'valid' : 'error';
    }
  }

  if (displayValidationState.value === 'valid') {
    return 'valid';
  }
  if (displayValidationState.value === 'error') {
    return 'error';
  }
  return 'idle';
};

const getValidationMessage = (row: ValidationRow) => {
  const state = getRowState(row);
  const result = row.grammar ? validationResultsByGrammar.value.get(row.grammar) : null;

  switch (state) {
    case 'validating':
      return row.validatingText || `Validating ${validationTargetLabel.value}...`;
    case 'valid':
      return row.validText || `${capitalizedValidationTargetLabel.value} is valid`;
    case 'error':
      return result?.error || row.errorText || props.validationError || `Invalid ${validationTargetLabel.value}`;
    default:
      return row.validatingText || `Validating ${validationTargetLabel.value}...`;
  }
};

const isBackendSelected = computed(() => {
  if (!props.showExecutionRow) {
    return true;
  }
  const value = props.selectedBackend ?? '';
  if (typeof value !== 'string') {
    return false;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed !== 'none';
});

const isExecuteDisabled = computed(() => {
  if (!props.showExecutionRow) {
    return true;
  }
  if (props.isNewEntity) {
    return true;
  }
  if (!isBackendSelected.value) {
    return true;
  }
  const code = props.sparqlCode?.trim() || '';
  if (!code) {
    return true;
  }
  // Allow execution despite validation errors if allowExecuteOnValidationError is true
  if (props.validationState === 'error' && !props.allowExecuteOnValidationError) {
    return true;
  }
  return false;
});

const executeButtonTitle = computed(() => {
  if (props.isNewEntity) {
    return 'Save before executing';
  }
  if (!isBackendSelected.value) {
    return 'Select a backend to execute against';
  }
  const code = props.sparqlCode?.trim() || '';
  if (!code) {
    return 'Enter a query to execute';
  }
  if (props.validationState === 'error') {
    if (props.allowExecuteOnValidationError) {
      return 'Execute (SPARQL parser warning - query may still be valid)';
    }
    return 'Fix validation errors before executing';
  }
  if (props.validationState === 'validating') {
    return 'Validating…';
  }
  return 'Execute';
});
</script>

<style scoped>


/*
 * No bottom border: this section is the whole left column, in every layout
 * that mounts it, so the rule had nothing below it to separate from — it drew
 * a hairline on the window's own edge and, worse, took a pixel of height with
 * it. That pixel is what pushed the footer here one row above the results
 * footer across the divider, which have to meet.
 */
.editor-section {
  display: flex;
  flex-direction: column;
  background: var(--surface);
  flex: 1;
  min-height: 0;
}

/*
 * The three selector rows (backend, media type, arguments) previously carried
 * byte-identical copies of these two rules.
 */
.backend-selector-group,
.mediatype-selector-group,
.argumentset-selector-group {
  display: flex;
  align-items: center;
  gap: var(--grid-gap);
}

/* Sizing only for the two choosers: each paints its own box (`SearchSelect`). */
.backend-trigger-compact {
  width: var(--grid-6);
}

.mediatype-trigger-compact {
  width: var(--grid-6);
  height: var(--grid-unit);
  font-size: var(--text-body);
}

.argumentset-trigger-compact {
  width: var(--grid-5);
}

.execution-actions {
  display: flex;
  align-items: center;
  gap: var(--grid-gap);
}

/*
 * min-width, not width: the grid step is an alignment floor, not a cap. "Code"
 * needs 68px but --grid-2 is 62px, and a hard width squashed its icon to half
 * size. Shorter labels still snap to the grid.
 */
.execution-actions .btn-compact:not(.btn-primary):not(.btn-dropdown-toggle) {
  min-width: var(--grid-2);
}

.execution-actions .btn-compact.btn-primary:not(.btn-dropdown-toggle) {
  min-width: var(--grid-3);
}

.editor-container {
  position: relative;
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.editor-container :deep(.cm-editor) {
  height: 100%;
}

.editor-container :deep(.cm-scroller) {
  overflow: auto;
}

/*
 * The editor and everything CodeMirror draws around it, as one thing to fade.
 * Positioned, because the outgoing editor of a swap is laid over the incoming
 * one; see `CodeSwapTransition`.
 */
.editor-surface {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  transition: opacity 150ms ease;
}

.with-overlay {
  pointer-events: none;
}

.with-overlay .editor-surface {
  opacity: 0.4;
}

/*
 * The scrim fades rather than appears. It is shown for loads that are over in
 * a frame as often as for slow ones, and a scrim that snaps on and off around
 * a query that was already cached reads as a fault rather than as progress.
 */
.panel-scrim-enter-active,
.panel-scrim-leave-active {
  transition: opacity 150ms ease;
}

.panel-scrim-enter-from,
.panel-scrim-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .editor-surface,
  .panel-scrim-enter-active,
  .panel-scrim-leave-active {
    transition: none;
  }
}

.panel-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: var(--space-7);
  /* The scrim token, not a white literal: a white one stayed white in dark
     mode and put --ink-secondary text on it at 1.1:1. */
  background: var(--surface-overlay);
  color: var(--ink-secondary);
  font-size: var(--text-content);
  font-weight: 500;
}

/* Validation Banner */
.validation-banner {
  flex-shrink: 0;
  padding: var(--space-3) var(--space-5);
  border-top: 1px solid var(--border-default);
  display: flex;
  align-items: stretch;
  flex-direction: column;
  gap: 6px;
  font-size: var(--text-body);
  font-weight: 500;
  transition: all 0.2s ease;
  min-height: 32px;
  max-height: none;
  overflow: visible;
  position: relative;
  z-index: 10;
  background: var(--surface-subtle);
}

.validation-banner.validation-error:hover {
  z-index: 100;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.validation-content {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.validation-rows {
  display: flex;
  flex-direction: column;
  gap: 3px;
  width: 100%;
}

.validation-row {
  align-items: center;
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-panel);
  border: 1px solid transparent;
  min-height: 32px;
}

.validation-row-text {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}

.validation-row-label {
  font-weight: 600;
  color: var(--ink-secondary);
  flex: 0 0 200px;
}

.validation-row:hover .validation-message {
  white-space: normal;
  overflow: visible;
}

.validation-icon {
  flex-shrink: 0;
}

.validation-icon-spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.validation-message {
  line-height: 1.4;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.validation-message-expandable {
  cursor: help;
}

.validation-banner.validation-error:hover .validation-message {
  white-space: normal;
  overflow: visible;
}

.validation-row-valid .validation-icon,
.validation-row-valid .validation-message,
.validation-row-valid .validation-row-label {
  color: var(--success-ink);
}
.validation-row-valid {
  background: var(--success-surface);
  border-color: var(--success-border);
}

.validation-row-error .validation-icon,
.validation-row-error .validation-message,
.validation-row-error .validation-row-label {
  color: var(--danger-ink);
}
.validation-row-error {
  background: var(--danger-surface);
  border-color: var(--danger-border);
}

.validation-row-validating .validation-icon,
.validation-row-validating .validation-message,
.validation-row-validating .validation-row-label,
.validation-row-idle .validation-icon,
.validation-row-idle .validation-message,
.validation-row-idle .validation-row-label {
  color: var(--action);
}
.validation-row-validating,
.validation-row-idle {
  background: var(--action-surface);
  border-color: var(--action-border);
}

.validation-message-empty {
  font-style: italic;
  opacity: 0.8;
}

.validation-banner.validation-valid,
.validation-banner.validation-error,
.validation-banner.validation-validating,
.validation-banner.validation-placeholder,
.validation-banner.validation-mixed {
  background: var(--surface-subtle);
  border-color: var(--border-default);
}

.outputs-banner {
  background: var(--action-surface);
  color: var(--action);
  border-color: var(--action-border);
}

.outputs-banner .validation-content {
  gap: 12px;
  align-items: center;
}

.outputs-banner .validation-icon-spin {
  opacity: 0.6;
}

.outputs-label {
  font-size: var(--text-label);
  font-weight: 600;
  color: var(--action);
  text-transform: uppercase;
  letter-spacing: 0.02em;
  white-space: nowrap;
}

.output-type-label {
  font-size: var(--text-label);
  font-style: italic;
  color: var(--action);
  opacity: 0.8;
}

.outputs-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.output-badge {
  display: inline-flex;
  align-items: center;
  padding: var(--space-1) var(--space-4);
  background: var(--surface);
  border: 1px solid var(--action-border);
  border-radius: var(--radius-full);
  font-size: var(--text-label);
  font-weight: var(--weight-semibold);
  color: var(--action);
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
}
</style>
