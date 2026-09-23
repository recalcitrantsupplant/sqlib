<template>
  <div class="code-panel" data-testid="code-snippet-panel">
    <!--
      Two ways to pass the same values, and the choice is a real one: a stored
      set is a frozen version in the library, inline values are sent with the
      call and saved nowhere. The API takes either — never both at once — so
      the toggle picks which body the snippet shows.
    -->
    <div v-if="variants.length > 1" class="variant-toggle" role="radiogroup" aria-label="How arguments are passed">
      <button
        v-for="variant in variants"
        :key="variant.id"
        type="button"
        role="radio"
        class="variant-button"
        :class="{ active: variant.id === activeVariantId }"
        :aria-checked="variant.id === activeVariantId"
        :data-testid="`code-variant-${variant.id}`"
        @click="activeVariantId = variant.id"
      >
        {{ variant.label }}
      </button>
    </div>

    <div class="language-tabs" role="tablist">
      <button
        v-for="language in SNIPPET_LANGUAGES"
        :key="language.id"
        type="button"
        role="tab"
        class="language-tab"
        :class="{ active: language.id === active }"
        :aria-selected="language.id === active"
        :data-testid="`code-language-${language.id}`"
        @click="active = language.id"
      >
        {{ language.label }}
      </button>
    </div>

    <!--
      The snippet is right; the endpoint may not answer yet. Saying which is the
      difference between copying a call that works and copying one that 404s
      until someone saves.
    -->
    <p v-if="unavailable" class="notice notice--blocked" data-testid="code-unavailable">
      <TriangleAlert :size="14" />
      <span>{{ unavailable }}</span>
    </p>
    <p v-else-if="draftNote" class="notice notice--draft" data-testid="code-draft-note">
      <TriangleAlert :size="14" />
      <span>{{ draftNote }}</span>
    </p>

    <InlineNote v-if="activeVariant.note" data-testid="code-variant-note">
      {{ activeVariant.note }}
    </InlineNote>

    <div class="snippet-header">
      <span class="snippet-label">{{ activeLabel }} · {{ activeVariant.request.method }}</span>
      <button
        type="button"
        class="copy-button"
        :disabled="!!unavailable"
        data-testid="code-copy"
        @click="copy"
      >
        <Check v-if="copied" :size="12" />
        <Copy v-else :size="12" />
        {{ copied ? 'Copied' : 'Copy' }}
      </button>
    </div>

    <!--
      Spans, one per highlighted run, written on one line: any whitespace
      between them in the template would become text inside the <pre>, and the
      text here is exactly what Copy writes.
    -->
    <pre class="snippet" data-testid="code-snippet"><span v-for="(segment, index) in segments" :key="index" :class="segment.className || undefined">{{ segment.text }}</span></pre>

    <section v-if="visibleArguments.length || argumentsHint" class="arguments">
      <h4 v-if="visibleArguments.length" class="arguments-title">Arguments in this call</h4>
      <ul v-if="visibleArguments.length" class="arguments-list">
        <li v-for="argument in visibleArguments" :key="argument.name" class="argument">
          <span class="argument-name">{{ argument.name }}</span>
          <span v-if="argument.detail" class="argument-detail">{{ argument.detail }}</span>
        </li>
      </ul>
      <InlineNote v-if="argumentsHint" class="arguments-hint">{{ argumentsHint }}</InlineNote>
    </section>
  </div>
</template>

<script lang="ts">
/**
 * The Code tab: the one HTTP call that runs — or saves — what is on screen,
 * in whichever language the reader works in.
 *
 * Every executable screen has the same question behind this tab ("how do I
 * call this from my own code?"), so the chrome is shared and the screens supply
 * only the request. What they must not supply is a plausible request: the URL
 * and body here are the ones the app itself sends, which is why the callers
 * build them from the same ids and argument payloads their Run button uses.
 */
export interface CodeSnippetArgument {
  name: string;
  /** Type, arity or origin — whatever makes the value's shape obvious. */
  detail?: string;
}

/**
 * One way of making the same call.
 *
 * Queries and groups accept their arguments two ways — a stored set by id, or
 * the values inline — and which one a caller wants is not something the screen
 * can decide for them: a scheduled job wants the frozen set, a script driving
 * its own values wants inline. So both are offered, and the toggle is the
 * choice rather than a guess at it.
 */
export interface CodeSnippetVariant {
  id: string;
  label: string;
  request: SnippetRequest;
  /** One line on what this way of calling means — saved vs. sent. */
  note?: string;
  /** Overrides the panel's `callArguments` while this variant is selected. */
  callArguments?: CodeSnippetArgument[];
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Check, Copy, TriangleAlert } from '@lucide/vue';
import InlineNote from './InlineNote.vue';
import {
  SNIPPET_LANGUAGES,
  renderSnippet,
  type SnippetLanguage,
  type SnippetRequest,
} from '@/lib/codeSnippets';
import { loadLanguage } from '@/lib/codeLanguage';
import { highlightSegments, type HighlightSegment } from '@/lib/staticHighlight';

const props = withDefaults(
  defineProps<{
    /** The only call, when there is only one. Ignored if `variants` is given. */
    request?: SnippetRequest;
    /** Two or more ways to make the call; renders a toggle above the snippet. */
    variants?: CodeSnippetVariant[];
    /** Which variant opens selected — the one matching what the screen is doing. */
    defaultVariantId?: string | null;
    /** Shown when the target is a draft: the call is correct but not yet live. */
    draftNote?: string | null;
    /**
     * Shown instead of the draft note when there is no callable target at all
     * — an unsaved scratch entity. The snippet still renders, so the shape of
     * the call is visible, but copying is off.
     */
    unavailable?: string | null;
    callArguments?: CodeSnippetArgument[];
    argumentsHint?: string | null;
  }>(),
  {
    request: undefined,
    variants: () => [],
    defaultVariantId: null,
    draftNote: null,
    unavailable: null,
    callArguments: () => [],
    argumentsHint: null,
  },
);

/*
 * One list either way, so the template never branches on which prop was given.
 * A caller with a single call passes `request`; it becomes the only variant and
 * the toggle stays out of the way.
 */
const variants = computed<CodeSnippetVariant[]>(() =>
  props.variants.length
    ? props.variants
    : [{ id: 'only', label: '', request: props.request ?? { method: 'POST', url: '' } }],
);

const selectedVariantId = ref<string | null>(null);

const activeVariantId = computed<string>({
  get: () => {
    const ids = variants.value.map((variant) => variant.id);
    for (const candidate of [selectedVariantId.value, props.defaultVariantId]) {
      if (candidate && ids.includes(candidate)) return candidate;
    }
    return ids[0];
  },
  set: (value: string) => {
    selectedVariantId.value = value;
  },
});

const activeVariant = computed<CodeSnippetVariant>(
  () => variants.value.find((variant) => variant.id === activeVariantId.value) ?? variants.value[0],
);

/** A variant's own list wins; otherwise the panel-wide one. */
const visibleArguments = computed<CodeSnippetArgument[]>(
  () => activeVariant.value.callArguments ?? props.callArguments,
);

const active = ref<SnippetLanguage>('curl');
const copied = ref(false);

const activeLabel = computed(
  () => SNIPPET_LANGUAGES.find((language) => language.id === active.value)?.label ?? 'cURL',
);

const snippet = computed(() => renderSnippet(active.value, activeVariant.value.request));

/*
 * The snippet as coloured spans. It is shown as plain text at once and coloured
 * when its grammar arrives, which is immediate once a language has been loaded
 * and one chunk fetch the first time. Only the latest request may write, so a
 * slow grammar cannot colour a snippet that has since changed language.
 */
const segments = ref<HighlightSegment[]>([]);
let highlightSeq = 0;

watch(
  [snippet, active],
  async ([code, language]) => {
    const seq = ++highlightSeq;
    segments.value = [{ text: code, className: '' }];
    const mediaType = SNIPPET_LANGUAGES.find((entry) => entry.id === language)?.mediaType;
    const grammar = await loadLanguage(mediaType);
    if (seq !== highlightSeq || !grammar) return;
    segments.value = highlightSegments(code, grammar);
  },
  { immediate: true },
);

async function copy() {
  if (props.unavailable) return;
  try {
    await navigator.clipboard.writeText(snippet.value);
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 1500);
  } catch {
    // Clipboard access can be denied; the snippet is on screen and selectable,
    // so failing quietly beats an error toast for something the user can see.
  }
}
</script>

<style scoped>
.code-panel {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-4);
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-5);
}

.variant-toggle {
  display: inline-flex;
  align-self: flex-start;
  overflow: hidden;
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
}

.variant-button {
  padding: var(--space-2) var(--space-4);
  border: none;
  border-left: 1px solid var(--border-default);
  background: var(--surface);
  font-family: inherit;
  font-size: var(--text-label);
  color: var(--ink-muted);
  cursor: pointer;
}

.variant-button:first-child {
  border-left: none;
}

.variant-button.active {
  background: var(--surface-raised);
  font-weight: var(--weight-semibold);
  color: var(--ink);
}

.language-tabs {
  display: inline-flex;
  align-self: flex-start;
  overflow: hidden;
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
}

.language-tab {
  padding: var(--space-2) var(--space-4);
  border: none;
  border-left: 1px solid var(--border-default);
  background: var(--surface);
  font-family: inherit;
  font-size: var(--text-label);
  color: var(--ink-muted);
  cursor: pointer;
}

.language-tab:first-child {
  border-left: none;
}

.language-tab.active {
  background: var(--segment-selected);
  font-weight: var(--weight-semibold);
  color: var(--segment-selected-ink);
}

.notice {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  margin: 0;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius);
  font-size: var(--text-label);
  line-height: var(--leading-normal);
}

.notice--draft {
  border: 1px solid var(--warning-border);
  background: var(--warning-surface);
  color: var(--warning-ink);
}

.notice--blocked {
  border: 1px solid var(--border-default);
  background: var(--surface-subtle);
  color: var(--ink-secondary);
}

.snippet-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
}

.snippet-label {
  font-size: var(--text-micro);
  font-weight: var(--weight-semibold);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--ink-muted);
}

.copy-button {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface);
  font-family: inherit;
  font-size: var(--text-label);
  color: var(--ink-secondary);
  cursor: pointer;
}

.copy-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/*
 * The snippet scrolls sideways rather than wrapping: a wrapped cURL line reads
 * as a different command from the one you would paste.
 */
.snippet {
  margin: 0;
  overflow-x: auto;
  padding: var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-panel);
  background: var(--surface-subtle);
  font-family: var(--font-mono);
  font-size: var(--text-label);
  line-height: var(--leading-normal);
  color: var(--ink);
  white-space: pre;
}

/*
 * The same tokens the editors' highlight style uses (`lib/codemirrorHighlight.ts`),
 * so a keyword or a string reads alike in a snippet and in an editor. `:deep()`
 * because the classes are bound from data, which the design-system check
 * cannot see written in the template.
 */
.snippet :deep(.hl-keyword) {
  color: var(--syntax-keyword);
}

.snippet :deep(.hl-string),
.snippet :deep(.hl-literal) {
  color: var(--rdf-literal);
}

.snippet :deep(.hl-comment) {
  color: var(--syntax-comment);
  font-style: italic;
}

.snippet :deep(.hl-function),
.snippet :deep(.hl-property) {
  color: var(--rdf-iri);
}

.snippet :deep(.hl-type) {
  color: var(--rdf-prefix);
}

.snippet :deep(.hl-punct) {
  color: var(--syntax-punct);
}

.arguments-title {
  margin: 0 0 var(--space-3);
  font-size: var(--text-micro);
  font-weight: var(--weight-semibold);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--ink-muted);
}

.arguments-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.argument {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-1) 0;
}

.argument-name {
  font-family: var(--font-mono);
  font-size: var(--text-label);
  color: var(--ink);
}

.argument-detail {
  font-size: var(--text-label);
  color: var(--ink-muted);
}

/* Where the hint sits is a fact about the list above it; the type is the note's. */
.arguments-hint {
  margin: var(--space-3) 0 0;
}
</style>
