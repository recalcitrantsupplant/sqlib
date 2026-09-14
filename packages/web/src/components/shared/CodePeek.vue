<template>
  <section v-if="hasContent" class="code-peek" :data-testid="testId">
    <button
      type="button"
      class="peek-head"
      :aria-expanded="expanded"
      :data-testid="testId ? `${testId}-toggle` : undefined"
      :title="expanded ? 'Collapse' : 'Expand to the whole document'"
      @click="expanded = !expanded"
    >
      <ChevronDown v-if="expanded" :size="13" class="peek-chevron" />
      <ChevronRight v-else :size="13" class="peek-chevron" />
      <span class="peek-label">{{ label }}</span>
      <span v-if="meta" class="peek-meta">· {{ meta }}</span>
      <span class="peek-spacer" />
      <span class="peek-meta" :data-testid="testId ? `${testId}-state` : undefined">{{ stateNote }}</span>
    </button>

    <!--
      Collapsed and expanded are two editors rather than one that changes
      height, because they are showing two different documents: the peek has
      the prologue stripped and the full view does not. Swapping the text under
      one editor would make "expand" look like an edit.
    -->
    <div
      v-if="!expanded"
      ref="bodyEl"
      class="peek-body"
      role="button"
      tabindex="0"
      :aria-label="`Expand ${label}`"
      :style="{ maxHeight: collapsedHeight }"
      :data-testid="testId ? `${testId}-peek` : undefined"
      @click="expanded = true"
      @keydown.enter.prevent="expanded = true"
      @keydown.space.prevent="expanded = true"
    >
      <Codemirror
        :model-value="peekText"
        :extensions="peekExtensions"
        :style="{ width: '100%' }"
      />
      <!--
        The shade says one thing: the text carries on past the bottom edge. It
        is absent when it does not — including when the *only* thing held back
        is the prologue, which was cut off the top and cannot be pointed at by
        a fade at the bottom. That is the header's sentence to say.
      -->
      <div v-if="isClipped" class="peek-shade" aria-hidden="true"></div>
    </div>

    <div v-else class="peek-full" :style="{ maxHeight: expandedHeight }">
      <Codemirror
        :model-value="content ?? ''"
        :extensions="fullExtensions"
        :style="{ width: '100%' }"
      />
    </div>
  </section>
  <p v-else-if="empty" class="peek-meta peek-empty" :data-testid="testId">{{ empty }}</p>
</template>

<script setup lang="ts">
/**
 * A document you can glance at, and then read.
 *
 * Collapsed it is a few lines of syntax-highlighted code at a fixed height,
 * shaded out at the bottom, with the prologue removed; clicking anywhere on it
 * opens the whole thing. That combination is the point, and each part earns its
 * place:
 *
 * - **Fixed height.** A preview whose size depends on its content cannot be
 *   scanned past: a page of six inputs becomes six pages. Every peek is the
 *   same height, so the shape of the page is the same whatever is in it.
 * - **Prefixes hidden.** The first six lines of nearly every RDF or SPARQL
 *   document are `PREFIX` declarations that are the same in all of them. Given
 *   four lines to say what a document *is*, spending them on the prologue says
 *   nothing at all. They come back the moment it is expanded, because they are
 *   part of the document and a reader who opened it wants it whole.
 * - **Shaded, not truncated.** A hard cut reads as the end of the text. The
 *   fade is the only honest rendering of "this continues" — and so it is drawn
 *   only when the text really does continue past the bottom edge, measured
 *   rather than guessed. What was cut off the *top* is said in words instead;
 *   a gradient at the bottom cannot point upwards.
 * - **Blank lines dropped.** The peek is a glance, not a rendering: the full
 *   document keeps its spacing and is one click away. Dense text puts more in
 *   the same six rows, and — the reason it is here — it keeps the clip landing
 *   on ink. A fade over a blank line says "the document ends here", which is
 *   the opposite of what a fade is for.
 * - **A document that fits is shown whole.** Hiding the prologue is justified
 *   by scarcity, and a two-line document has none: hiding one of its two lines
 *   saves nothing and leaves the header hedging about a document it could have
 *   shown.
 *
 * Read-only throughout. These are previews of things that live elsewhere —
 * a data graph version, a pinned rule set — and offering an edit that cannot
 * land is worse than offering none.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { Codemirror } from 'vue-codemirror';
import { ChevronDown, ChevronRight } from '@lucide/vue';
import type { Extension } from '@codemirror/state';
import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { rdfSyntaxHighlighting } from '@/lib/codemirrorHighlight';
import { languageExtensionsFor } from '@/lib/codeLanguage';

const props = withDefaults(
  defineProps<{
    label: string;
    /** The document. Nothing renders when it is empty. */
    content?: string | null;
    /** The media type, which decides the highlighting. */
    contentType?: string | null;
    /** Version, size, format — whatever names *which* document this is. */
    meta?: string;
    /** Shown in place of the peek when there is no content at all. */
    empty?: string;
    testId?: string;
    /** How many lines the collapsed peek shows. */
    collapsedLines?: number;
    /** Where the expanded view starts scrolling instead of growing. */
    expandedHeight?: string;
    /** Opens expanded — for the one document on a page that is the subject. */
    defaultExpanded?: boolean;
  }>(),
  {
    content: '',
    contentType: 'text/turtle',
    meta: '',
    empty: '',
    testId: undefined,
    collapsedLines: 6,
    expandedHeight: '420px',
    defaultExpanded: false,
  },
);

const expanded = ref(props.defaultExpanded);

const hasContent = computed(() => (props.content ?? '').trim().length > 0);

const lines = computed(() => (props.content ?? '').replace(/\s+$/, '').split('\n'));

/**
 * A prologue line: Turtle's `@prefix`/`@base` and SPARQL's `PREFIX`/`BASE`.
 *
 * Matched at the start of the line and case-insensitively, because SPARQL's
 * keywords are and Turtle's directives are not, and both turn up in SRL.
 */
const PROLOGUE = /^\s*(?:@?prefix\b|@?base\b)/i;

const isProloguePart = (line: string) => PROLOGUE.test(line);

const prologueCount = computed(() => lines.value.filter(isProloguePart).length);

/** The document as it stands fits the collapsed box, so there is nothing to spend. */
const fitsWhole = computed(() => lines.value.length <= props.collapsedLines);

/** The lines that say something: the prologue gone, and the blanks with it. */
const bodyLines = computed(() => lines.value.filter((line) => !isProloguePart(line) && line.trim()));

/*
 * When the peek is the document itself rather than a reduction of it.
 *
 * Either it fits — see above — or it is *nothing but* prologue, where peeking
 * at a blank box would read as a preview that failed to load, and the honest
 * answer to "what does this say" is that it says only this.
 */
const showsWhole = computed(() => fitsWhole.value || bodyLines.value.length === 0);

const peekText = computed(() => (showsWhole.value ? lines.value.join('\n') : bodyLines.value.join('\n')));

/** How many prologue lines the peek is actually holding back — see `showsWhole`. */
const hiddenPrologue = computed(() => (showsWhole.value ? 0 : prologueCount.value));

const collapsedHeight = computed(() => `calc(${props.collapsedLines} * var(--peek-line-height))`);

/** Lines past the bottom edge, before wrapping is taken into account. */
const hiddenLines = computed(() => Math.max(0, peekText.value.split('\n').length - props.collapsedLines));

/*
 * Whether the body overflows the box it is in, measured.
 *
 * Counting lines is an approximation of this and a poor one: `lineWrapping` is
 * on, so three long rules can fill six rows while `split('\n')` says three, and
 * the same document stops overflowing when the pane gets wider. The observer
 * sees the pane resize, the wrap change and the font arriving late; the count
 * sees none of them. The two are unioned rather than one replacing the other,
 * because a count is available before layout is (and in a DOM without
 * `ResizeObserver`, which is where the specs run).
 */
const bodyEl = ref<HTMLElement | null>(null);
const overflows = ref(false);

function measure() {
  const el = bodyEl.value;
  // A hair of tolerance: sub-pixel line heights make an exact comparison
  // report an overflow of a third of a pixel as content below the fold.
  overflows.value = el ? el.scrollHeight - el.clientHeight > 1 : false;
}

let observer: ResizeObserver | null = null;

function observe() {
  observer?.disconnect();
  observer = null;
  const el = bodyEl.value;
  if (!el || typeof ResizeObserver === 'undefined') return measure();
  observer = new ResizeObserver(measure);
  // The box for its width, and the editor inside it for its height: the box is
  // height-clamped, so it never resizes when the text grows.
  observer.observe(el);
  if (el.firstElementChild) observer.observe(el.firstElementChild);
  measure();
}

watch(
  [() => peekText.value, () => props.collapsedLines, expanded],
  () => nextTick(observe),
  { immediate: true, flush: 'post' },
);

onBeforeUnmount(() => observer?.disconnect());

/** Whether the text carries on past the bottom edge. The shade, and only the shade. */
const isClipped = computed(() => !expanded.value && (hiddenLines.value > 0 || overflows.value));

/*
 * The header says what the shade cannot: how much, and that some of it came off
 * the top. Said in words, the fade is free to be a gradient rather than the
 * only carrier of the fact — which is what it was when a clip landing on a
 * blank line silently said "ends here" to a document with four rules left.
 */
const stateNote = computed(() => {
  if (expanded.value) return `${lines.value.length} lines`;
  const parts: string[] = [];
  if (hiddenPrologue.value > 0) {
    parts.push(`${hiddenPrologue.value} prefix${hiddenPrologue.value === 1 ? '' : 'es'} hidden`);
  }
  // Only when the count knows the answer: where the overflow is the wrap's
  // rather than the line count's, there is no honest number to give.
  if (hiddenLines.value > 0) {
    parts.push(`${hiddenLines.value} more line${hiddenLines.value === 1 ? '' : 's'}`);
  }
  if (parts.length === 0 && !isClipped.value) return '';
  parts.push('click to expand');
  return parts.join(' · ');
});

const language = computed(() => languageExtensionsFor(props.contentType));

const readOnly: Extension[] = [
  EditorState.readOnly.of(true),
  EditorView.editable.of(false),
  rdfSyntaxHighlighting,
];

/*
 * No gutters and no scrolling in the peek.
 *
 * Line numbers are hidden rather than left off: `vue-codemirror` installs its
 * own default set of extensions before the ones given here, so `lineNumbers`
 * is present whether or not it is asked for. It has to go — numbers taken from
 * a document whose prologue has been removed count the wrong lines, and would
 * have a reader looking for line 1 of a file that starts at line 4. A
 * scrollbar goes for a plainer reason: it invites scrolling a preview instead
 * of opening it.
 */
const peekExtensions = computed<Extension[]>(() => [
  ...language.value,
  ...readOnly,
  EditorView.lineWrapping,
  EditorView.theme({
    '&': { backgroundColor: 'transparent' },
    '.cm-gutters': { display: 'none' },
    // A read-only preview has no cursor, so an "active line" band is a
    // highlight over a line nobody picked.
    '.cm-activeLine': { backgroundColor: 'transparent' },
    '.cm-scroller': { overflow: 'hidden' },
    '.cm-content': { cursor: 'pointer', padding: '0' },
    '.cm-line': { padding: '0 var(--space-3)' },
  }),
]);

const fullExtensions = computed<Extension[]>(() => [
  ...language.value,
  ...readOnly,
  // Asked for explicitly rather than relied on from the defaults above: the
  // expanded view is the whole document, so its line numbers are the
  // document's and are worth having.
  lineNumbers(),
  EditorView.lineWrapping,
  EditorView.theme({
    '&': { backgroundColor: 'transparent' },
    '.cm-activeLine': { backgroundColor: 'transparent' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent' },
  }),
]);
</script>

<style scoped>
.code-peek {
  /*
   * One CodeMirror line: `--text-code` at the editors' own 1.4 leading, so
   * `collapsedLines` counts the lines a reader will actually see rather than
   * an approximation of them.
   */
  --peek-line-height: calc(var(--text-code) * 1.4);

  min-width: 0;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  overflow: hidden;
}

.peek-head {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  width: 100%;
  padding: var(--space-2) var(--space-3);
  border: 0;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--surface-subtle);
  color: var(--ink-secondary);
  font-family: inherit;
  font-size: var(--text-micro);
  text-align: left;
  cursor: pointer;
}

.peek-head:hover {
  background: var(--surface-sunken);
}

.peek-chevron {
  flex-shrink: 0;
  color: var(--ink-muted);
}

.peek-label {
  overflow: hidden;
  color: var(--ink);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.peek-meta {
  color: var(--ink-muted);
  font-size: var(--text-micro);
  white-space: nowrap;
}

.peek-spacer {
  flex: 1;
}

.peek-body {
  position: relative;
  overflow: hidden;
  cursor: pointer;
}

.peek-body:focus-visible {
  outline: 2px solid var(--action);
  outline-offset: -2px;
}

/*
 * The shade. Sized to a line and a half so it reads as the text fading out
 * rather than as a band drawn over it, and inert so the click lands on the
 * body underneath.
 */
.peek-shade {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: calc(1.5 * var(--peek-line-height));
  background: linear-gradient(to bottom, transparent, var(--surface));
  pointer-events: none;
}

.peek-full {
  overflow: auto;
}

.peek-empty {
  margin: 0;
}

.code-peek :deep(.cm-editor) {
  background: transparent;
}

.code-peek :deep(.cm-focused) {
  outline: none;
}
</style>
