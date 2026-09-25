<template>
  <div class="save-bar" data-testid="save-bar">
    <!--
      The title is read-only here. Name and description are edited in one place
      — the Details tab — because two editable copies of the same field is how
      one of them silently loses. Saving still needs a name, so a click
      while the item is unnamed sends you to that field rather than growing a
      second one here (nav doc §3).

      Nor is the version comment collected here. Save saves; the note goes on
      the version row in the Details tab, where it is also read.
    -->
    <span class="query-title" :class="{ scratch: isScratch }" :title="title">{{ title || `Untitled ${noun}` }}</span>

    <span v-if="isScratch" class="chip chip-scratch" data-testid="scratch-chip">
      <FlaskConical :size="11" />Scratch
    </span>
    <template v-else>
      <span v-if="currentVersionNumber" class="chip chip-version" data-testid="version-pill">
        v{{ currentVersionNumber }}<span class="chip-sub">current</span>
      </span>
      <!--
        "Unsaved" rather than "Draft": beside a button reading Save v2 the word
        that matters is whether these edits are in a version yet, and one
        phrase says that and how many. Where the edits are being kept in the
        meantime is not the user's problem and is no longer mentioned.
      -->
      <span v-if="editCount > 0" class="chip chip-draft" data-testid="draft-pill">
        <PencilLine :size="11" />{{ editCount }} unsaved {{ editCount === 1 ? 'edit' : 'edits' }}
      </span>
    </template>

    <span class="bar-spacer" />

    <!--
      Format, and the prefix conversions under it, are off by default now and
      every work area passes `show-format="false"`: both editors that have a
      formatter put these in the editor's own header row instead, beside
      Expand, where they sit with the other things done to the document. The
      capability stays because the shape is right for a section whose body has
      no header row of its own — but nothing renders it today.

      Format's title names no shortcut: the one it used to advertise was never
      bound to anything.
    -->
    <button
      v-if="showFormat"
      class="bar-button bar-icon"
      data-testid="format-query"
      title="Format"
      :disabled="!canFormat"
      @click="emit('format')"
    >
      <WandSparkles :size="13" />
    </button>
    <!--
      The prefix conversions, beside Format because they are the same kind of
      control: one press, whole body rewritten. They show themselves only when
      the section passes a body and a content type the app has a grammar for,
      so the bars carrying no convertible document get nothing.
    -->
    <PrefixConversionButtons
      v-if="code !== undefined"
      :code="code"
      :content-type="contentType"
      @update:code="(value: string) => emit('update:code', value)"
    />
    <!--
      Import, for a section that can build its body out of something already in
      the library. Beside the body icons rather than in a menu: it edits the
      document you are about to save, exactly as Format does.
    -->
    <button
      v-if="showImport"
      class="bar-button bar-icon"
      data-testid="import-body"
      :title="importTitle"
      @click="emit('import')"
    >
      <FileInput :size="13" />
    </button>
    <button
      v-if="showDiff && !isScratch"
      class="bar-button bar-icon"
      :class="{ 'bar-icon-active': diffActive }"
      data-testid="diff-query"
      :title="currentVersionNumber ? `Diff draft vs v${currentVersionNumber}` : 'Diff draft'"
      @click="emit('toggle-diff')"
    >
      <GitCompare :size="13" />
    </button>
    <!--
      Share copies a link. A saved item's link is its address; a scratch item
      has no address anyone else can open, so its link carries the item itself
      and opens as a new scratch copy — offered only where the section says
      its body can travel that way (see lib/shareLink.ts).
    -->
    <button
      v-if="canShare"
      class="bar-button bar-icon"
      data-testid="share-link"
      :title="shareTitle"
      @click="share"
    >
      <Link2 :size="13" />
    </button>
    <button
      v-if="editCount > 0 && !isScratch"
      class="bar-button"
      data-testid="discard-draft"
      title="Throw away the unsaved edits and go back to the saved version"
      @click="emit('discard')"
    >
      Discard
    </button>
    <!--
      Save is absent, not disabled, on a read-only deployment: the server
      refuses every write to its own state, so this button could only ever
      report that. Discard and the body icons above stay — they act on the
      browser-local record, which is the one thing a visitor there does own.
    -->
    <button
      v-if="canWrite"
      class="bar-button bar-primary"
      data-testid="save"
      :disabled="saveDisabled"
      :title="saveTitle"
      @click="startSave"
    >
      {{ saveLabel }}
    </button>

    <!--
      The mockup's ⋮ More. It exists because removing the metadata panel from
      above the editor took the only Delete affordance with it. "Edit details…"
      is only for the sections that still keep a dialog of their own: where
      Details edits every field the dialog did — name, description, default
      backend, current version — a second editor of the same four is a second
      copy that can disagree with the first.
      A scratch item has neither entry: it has no server identity to delete and
      nothing to edit on the server, so the menu is saved-only.

      A read-only deployment leaves the menu only where a section put something
      of its own in it — the rules screen's "Preview changes…", which reads.
      Both standing entries write to the server, so a ⋮ holding nothing but
      those is a menu that opens onto two refusals.
    -->
    <DropdownMenu v-if="showMore && !isScratch && (canWrite || hasMenuItems)">
      <DropdownMenuTrigger as-child>
        <button class="bar-button bar-icon" data-testid="query-more" title="More actions">
          <EllipsisVertical :size="13" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <!-- Section-specific entries: the rules screen's "Preview changes…". -->
        <slot name="menu-items" />
        <DropdownMenuItem v-if="showEdit && canWrite" data-testid="query-edit-details" @select="emit('edit')">
          Edit details…
        </DropdownMenuItem>
        <DropdownMenuItem v-if="canWrite" data-testid="query-delete" @select="emit('delete')">
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
</template>

<script setup lang="ts">
/**
 * The bar above the body: what this item is, and the button that turns it into
 * a version.
 *
 * Scratch chip, version pill, draft pill, Discard, Save — the same five
 * decisions whether the body is SPARQL, a canvas or an ETL pipeline. What
 * varies is the noun and which of the body-specific icons are worth drawing:
 * a canvas has nothing to format and nothing to diff.
 */
import { computed, useSlots } from 'vue';
import {
  FlaskConical,
  PencilLine,
  EllipsisVertical,
  FileInput,
  WandSparkles,
  GitCompare,
  Link2,
} from '@lucide/vue';
import { toast } from 'vue-sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import PrefixConversionButtons from './PrefixConversionButtons.vue';
import { useDeploymentMode } from '../../composables/useDeploymentMode';
import { savedShareUrl, scratchShareUrl, type ScratchSharePayload } from '../../lib/shareLink';

const props = withDefaults(defineProps<{
  title: string;
  isScratch: boolean;
  /** Lower-case singular for the fallback title and the hover text. */
  noun?: string;
  /** False where the body has no formatter — a canvas, a pipeline. */
  showFormat?: boolean;
  /** False where there is nothing to diff a draft against. */
  showDiff?: boolean;
  /** False where the section keeps Delete and Edit somewhere of its own. */
  showMore?: boolean;
  /** True for a section that can build its body from something else. */
  showImport?: boolean;
  /** What that import does, in words — there is no guessing it from an icon. */
  importTitle?: string;
  /** False where the Details tab is the only editor of the entity's fields. */
  showEdit?: boolean;
  /** The saved entity's current version number; null before v1 exists. */
  currentVersionNumber: number | null;
  /** Autosaves held in the browser and not yet saved. */
  editCount: number;
  saving: boolean;
  /** False when there is nothing to save — an empty body, or no changes. */
  canSave: boolean;
  /**
   * True when this item still carries its fallback name, so saving has to
   * collect one. A scratch query the user has already named saves without
   * being asked twice.
   */
  needsName?: boolean;
  /** Nothing to tidy in an empty editor. */
  canFormat?: boolean;
  /**
   * The body itself, for the prefix conversions beside Format. Omitted by
   * sections whose body is not a document those buttons can rewrite — they are
   * then not rendered at all.
   */
  code?: string;
  /** What `code` is, which decides whether a conversion is offered. */
  contentType?: string | null;
  diffActive?: boolean;
  /** False where the item has nothing a link could point at. */
  showShare?: boolean;
  /**
   * A scratch item's contents, for a link that carries them. Only sections
   * whose scratch body can travel pass it; without it a scratch item has no
   * Share button, since its `?scratch=` address resolves only in this browser.
   */
  shareScratch?: () => ScratchSharePayload | null;
}>(), {
  showShare: true,
  noun: 'query',
  showFormat: true,
  showDiff: true,
  showMore: true,
  showEdit: true,
  showImport: false,
  importTitle: 'Import',
});

/**
 * Whether this deployment keeps anything at all.
 *
 * Read here rather than passed in by each work area: it is a property of the
 * deployment, not of the item on screen, and a dozen screens each remembering
 * to forward it is a dozen places to forget. Same reason `RunBar` reads the
 * feature flags itself.
 */
const deployment = useDeploymentMode();
const canWrite = computed(() => !deployment.isReadOnly.value);

const slots = useSlots();
const hasMenuItems = computed(() => Boolean(slots['menu-items']));

const emit = defineEmits<{
  (e: 'save'): void;
  /** Save was pressed while the item still carries its fallback name. */
  (e: 'needs-name'): void;
  (e: 'discard'): void;
  (e: 'edit'): void;
  (e: 'delete'): void;
  (e: 'format'): void;
  (e: 'update:code', value: string): void;
  (e: 'import'): void;
  (e: 'toggle-diff'): void;
}>();

/*
 * Save saves. One click, no prompt, no mode.
 *
 * The version comment used to be collected here, by an input that took over
 * the title on the far left while the button you pressed was on the far right.
 * It is now edited on the version row in the Details tab — the place the
 * comment is displayed, so there is one field rather than a write-only one
 * here and a read-only one there, and a note can still be added (or fixed)
 * after the version exists.
 *
 * The name is not collected here either: it has exactly one editor — the
 * Details tab — and an item still wearing its fallback name sends you there.
 */
function startSave() {
  if (props.needsName) {
    emit('needs-name');
    return;
  }
  emit('save');
}

// Saving is always "create the next version": a versioned entity cannot be
// edited in place, so the label is the version the click will produce.
const saveLabel = computed(() => `Save v${(props.currentVersionNumber ?? 0) + 1}`);

const canShare = computed(() => props.showShare && (!props.isScratch || Boolean(props.shareScratch)));

const shareTitle = computed(() => {
  if (props.isScratch) return `Copy a link that opens a copy of this ${props.noun}`;
  return props.editCount > 0
    ? `Copy a link to this ${props.noun} — unsaved edits are not included`
    : `Copy a link to this ${props.noun}`;
});

/*
 * Past this a link starts getting cut off by the places people paste it —
 * chat previews, issue trackers, some mail clients. Still copied: a long link
 * that works in a browser is better than none.
 */
const LONG_LINK = 8000;

async function share() {
  let url: string;
  try {
    if (props.isScratch) {
      const payload = props.shareScratch?.();
      if (!payload) return;
      url = await scratchShareUrl(window.location, payload);
    } else {
      url = savedShareUrl(window.location);
    }
    await navigator.clipboard.writeText(url);
  } catch {
    toast.error('Could not copy the link');
    return;
  }
  if (!props.isScratch) {
    toast.success('Link copied');
  } else if (url.length > LONG_LINK) {
    toast.warning(`Link copied — it is long (${Math.round(url.length / 1000)}k characters) and may be cut off where you paste it`);
  } else {
    toast.success(`Link copied — it opens as a scratch copy of this ${props.noun}`);
  }
}

const saveDisabled = computed(() => props.saving || !props.canSave);

const saveTitle = computed(() => {
  if (props.saving) return 'Saving…';
  if (!props.canSave) {
    return props.isScratch
      ? `Write a ${props.noun} first — there is nothing to save yet`
      : 'No unsaved edits';
  }
  if (props.needsName) return 'Give it a name in the Details tab first';
  return props.isScratch
    ? 'Save it into the current library as v1'
    : saveLabel.value;
});

</script>

<style scoped>
.save-bar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  box-sizing: border-box;
  height: var(--panel-bar-h);
  flex-shrink: 0;
  padding: 0 var(--space-4);
  overflow: hidden;
  background: var(--surface-subtle);
  border-bottom: 1px solid var(--border-default);
}

.query-title {
  flex: 0 1 auto;
  min-width: 96px;
  overflow: hidden;
  color: var(--ink);
  font-size: var(--text-content);
  font-weight: var(--weight-semibold);
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* Italic and grey: not yet a thing the library contains. */
.query-title.scratch {
  /* Trailing room so the italic lean is not clipped by the title's overflow: hidden. */
  padding-right: 0.12em;
  color: var(--ink-muted);
  font-style: italic;
}

.chip {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 5px;
  height: 20px;
  padding: 0 var(--space-4);
  border-radius: var(--radius-full);
  font-size: var(--text-label);
  font-weight: var(--weight-semibold);
  white-space: nowrap;
}

.chip-sub {
  font-weight: var(--weight-normal);
  opacity: 0.75;
}

.chip-version {
  background: var(--action-surface);
  border: 1px solid var(--action-border);
  color: var(--action-ink);
}

.chip-draft {
  background: var(--warning-surface);
  border: 1px solid var(--warning-border);
  color: var(--warning-ink);
}

.chip-scratch {
  background: var(--surface);
  border: 1px dashed var(--border-strong);
  color: var(--ink-muted);
}


.bar-spacer {
  flex: 1;
  min-width: var(--space-2);
}

.bar-button {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 var(--space-5);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink-secondary);
  font-family: inherit;
  font-size: var(--text-content);
  white-space: nowrap;
  cursor: pointer;
}

.bar-button:hover:not(:disabled) {
  border-color: var(--border-strong);
  color: var(--ink);
}

.bar-primary {
  border-color: var(--action);
  background: var(--action);
  color: var(--action-fg);
  font-weight: var(--weight-semibold);
}

.bar-primary:hover:not(:disabled) {
  border-color: var(--action-hover);
  background: var(--action-hover);
  color: var(--action-fg);
}

.bar-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Square, so the ⋮ sits centred rather than in a text-width pill. */
.bar-icon {
  justify-content: center;
  width: 28px;
  padding: 0;
}

.bar-icon-active {
  border-color: var(--action);
  color: var(--action);
}
</style>
