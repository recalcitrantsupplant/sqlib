<template>
  <!--
    The positioning context is this plain `div`, not `ComboboxRoot`.

    reka's `ComboboxRoot` renders through a primitive that drops the scoped
    style attribute Vue stamps on this component's markup, so
    `.search-select[data-v-…]` never matched it and `position: relative` was
    silently absent. The inline menu then resolved `position: absolute` against
    the initial containing block: a full-viewport-width strip pinned to the
    bottom of the page, which also pushed the page sideways. An element we
    render ourselves keeps its scope attribute, so the rule lands.
  -->
  <div class="search-select" @keydown.capture="keepCaretKeys">
    <ComboboxRoot
      class="search-select__root"
      :model-value="selectedValue"
      :open="open"
      :disabled="disabled"
      ignore-filter
      open-on-click
      @update:model-value="onSelect"
      @update:open="onOpenChange"
    >
      <ComboboxAnchor class="search-select__anchor">
        <ComboboxInput
          v-model="searchTerm"
          class="search-select__input"
          :class="{ 'search-select__input--bare': variant === 'bare' }"
          :display-value="labelFor"
          :placeholder="placeholder"
          :disabled="disabled"
          :data-testid="testId"
          :aria-label="ariaLabel"
          autocomplete="off"
          @keydown.enter.prevent
        />
        <ComboboxTrigger class="search-select__toggle" :disabled="disabled" tabindex="-1" aria-label="Show options">
          <ChevronsUpDown :size="13" aria-hidden="true" />
        </ComboboxTrigger>
      </ComboboxAnchor>

      <ComboboxContent class="search-select__menu" position="inline">
        <ComboboxViewport class="search-select__viewport">
          <ComboboxEmpty class="search-select__empty">No matches.</ComboboxEmpty>
          <!--
            The way back to "nothing chosen", for the callers that have one. It
            is not a member of `options` because it is not a value: it never
            competes for a fuzzy rank, and it stays put at the top so the
            keyboard reaches it in the same place every time.
          -->
          <ComboboxItem
            v-if="emptyLabel !== undefined && !searchTerm.trim()"
            class="search-select__option search-select__option--empty"
            :value="EMPTY_VALUE"
            :text-value="emptyLabel"
            :data-testid="testId ? `${testId}-option` : undefined"
          >
            <span class="search-select__label">{{ emptyLabel }}</span>
            <ComboboxItemIndicator class="search-select__indicator">
              <Check :size="13" aria-hidden="true" />
            </ComboboxItemIndicator>
          </ComboboxItem>
          <ComboboxItem
            v-for="match in matches"
            :key="match.item.value"
            class="search-select__option"
            :value="match.item.value"
            :disabled="match.item.disabled"
            :text-value="match.item.label"
            :title="match.item.label"
            :data-testid="testId ? `${testId}-option` : undefined"
          >
            <span class="search-select__label">
              <template v-for="(segment, index) in match.segments" :key="index">
                <mark v-if="segment.matched" class="search-select__hit">{{ segment.text }}</mark>
                <template v-else>{{ segment.text }}</template>
              </template>
            </span>
            <ComboboxItemIndicator class="search-select__indicator">
              <Check :size="13" aria-hidden="true" />
            </ComboboxItemIndicator>
          </ComboboxItem>
        </ComboboxViewport>
      </ComboboxContent>
    </ComboboxRoot>
  </div>
</template>

<script setup lang="ts">
/**
 * A `<select>` with a text box where its button would be: type to fuzzy-filter
 * the options (ranked, matched characters highlighted), arrows and Enter to
 * choose, exactly one value at the end. For the dropdowns whose option lists
 * outgrow scanning — subjects, backends, anything named by hand — where the
 * native control makes the user read the whole list to find the row they can
 * already half-spell.
 *
 * Built on reka-ui's Combobox for the keyboard and ARIA behaviour, with the
 * filtering done here (`ignore-filter`) through `fuzzyFilter`, because reka's
 * built-in filter is substring-only and unranked. Renders inline rather than
 * in a portal so it needs no floating-ui and behaves under happy-dom — which
 * is why the menu's geometry is this component's problem rather than a
 * positioning library's, and why the CSS below is so insistent about it.
 *
 * Enter is swallowed rather than allowed through: reka has already acted on it
 * (it takes the highlighted option), and the native default — submitting the
 * form the field sits in — would send a dialog while its chooser was open. The
 * `<select>` this replaces carried the same guard by hand.
 *
 * Deliberately value-shaped like the native select it replaces: strings in,
 * string out, options given flat. `emptyLabel` adds back the native select's
 * leading blank option — "None", "Choose a graph…" — for the callers whose
 * value is genuinely optional; it emits `''`, which is what those callers
 * already read off a `<select>`'s `value`. Omit it and there is no way back to
 * empty, which is right where the choice is mandatory.
 */
import { computed, nextTick, ref } from 'vue';
import {
  ComboboxAnchor,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxRoot,
  ComboboxTrigger,
  ComboboxViewport,
} from 'reka-ui';
import { Check, ChevronsUpDown } from '@lucide/vue';
import { fuzzyFilter } from '../../lib/fuzzy';

export interface SearchSelectOption {
  value: string;
  label: string;
  /**
   * Listed but not chooseable — the option a native `<select>` greys out. It
   * still matches the filter and still shows its label, because the label is
   * usually where the reason lives ("… — no prefix service").
   */
  disabled?: boolean;
}

/*
 * reka treats `''` as "no selection", so an option carrying it can be
 * highlighted but never becomes the model value — the empty row would look
 * chooseable and do nothing. The row carries this sentinel instead and
 * `onSelect` translates it back to `''` on the way out; it is not a legal
 * entity id, so no caller's option can collide with it.
 */
const EMPTY_VALUE = '\u0000search-select-empty';

const props = withDefaults(
  defineProps<{
    modelValue: string | null;
    options: SearchSelectOption[];
    placeholder?: string;
    disabled?: boolean;
    testId?: string;
    /** Label for the row that clears the value. Omitted: no such row. */
    emptyLabel?: string;
    /** For the fields whose label is not adjacent text (a bare toolbar row). */
    ariaLabel?: string;
    /**
     * `bare` drops the box — no border, no background, no fixed height — for
     * the callers that already draw one around the field (a header strip with
     * its own icons). The menu is unchanged either way.
     */
    variant?: 'default' | 'bare';
  }>(),
  {
    placeholder: 'Choose…',
    disabled: false,
    testId: undefined,
    emptyLabel: undefined,
    ariaLabel: undefined,
    variant: 'default',
  },
);

const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const open = ref(false);
const searchTerm = ref('');

const matches = computed(() => fuzzyFilter(searchTerm.value, props.options, (option) => option.label));

/** `''` and `null` are the same state — nothing chosen — however a caller spells it. */
const selectedValue = computed(() =>
  props.modelValue ? props.modelValue : props.emptyLabel !== undefined ? EMPTY_VALUE : '',
);

const labelFor = (value: unknown): string => {
  if (value === EMPTY_VALUE) return props.emptyLabel ?? '';
  return props.options.find((option) => option.value === value)?.label ?? '';
};

/**
 * Home and End belong to the text box, not to the list.
 *
 * reka's `ListboxFilter` binds both (and Up/Down) on the input and calls
 * `preventDefault`, so in a chooser you could not jump the caret to either end
 * of what you had typed, and Shift+Home / Shift+End — select to the start, to
 * the end, the ordinary way to wipe a filter and retype it — did nothing at
 * all. This is the editable-combobox behaviour the ARIA pattern asks for: the
 * arrows walk the options, Home and End move the caret.
 *
 * Stopping it here, in a capture listener on the wrapper, is what makes that
 * possible: the event is stopped before it reaches the input's own listeners,
 * so reka never sees it — and because nothing calls `preventDefault`, the
 * browser still does the caret move or the selection itself.
 */
const keepCaretKeys = (event: KeyboardEvent) => {
  if (event.key === 'Home' || event.key === 'End') event.stopPropagation();
};

/**
 * reka seeds the input with the chosen option's label when the menu opens, and
 * that text lands in `searchTerm` through the `v-model` — so a chooser that
 * already had a value opened filtered down to that one row, with no way to
 * browse to another without hand-deleting the text first. Clearing on open
 * (on the tick after reka's own write) puts the whole list back; the chosen
 * row still carries its tick, and the label returns when the menu closes.
 */
const onOpenChange = (value: boolean) => {
  open.value = value;
  if (value) void nextTick(() => (searchTerm.value = ''));
  else searchTerm.value = '';
};

const onSelect = (value: unknown) => {
  if (value === EMPTY_VALUE) emit('update:modelValue', '');
  else if (typeof value === 'string' && value) emit('update:modelValue', value);
  searchTerm.value = '';
};
</script>

<style scoped>
.search-select {
  position: relative;
  min-width: 0;
}

/*
 * `ComboboxRoot` cannot be styled from here (see the template), so it is given
 * nothing to do: the wrapper above owns the box and this fills it.
 */
.search-select__root {
  min-width: 0;
}

.search-select__anchor {
  position: relative;
  display: flex;
  min-width: 0;
  align-items: center;
}

/*
 * The control's own appearance, rather than the `control` class it used to
 * carry.
 *
 * That class is defined in the *callers'* scoped stylesheets, which cannot
 * reach an element inside this component: the input rendered with no border,
 * no padding and the browser's default 24px height, so the subject field did
 * not look like the Name and Group fields beside it. The same tokens, stated
 * where they can apply.
 *
 * `min-width: 0` matters as much as the paint: an `<input>`'s intrinsic
 * minimum width is its `size` attribute — about 262px — so in a flex row it
 * refuses to shrink and pushes the panel wider than its column. That column
 * scrolls, and reka scrolling a highlighted option into view then drags the
 * whole panel sideways, cutting the section labels off.
 */
.search-select__input {
  width: 100%;
  min-width: 0;
  height: var(--control-h-sm);
  padding: 0 var(--grid-1) 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink);
  font-family: inherit;
  font-size: var(--text-label);
  text-overflow: ellipsis;
}

.search-select__input--bare {
  height: auto;

  /* Room on the right for the toggle, which stays where it is. */
  padding: 0 var(--space-6) 0 0;
  border: 0;
  background: none;
}

.search-select__input:disabled {
  color: var(--ink-disabled);
}

.search-select__input::placeholder {
  color: var(--ink-muted);
}

.search-select__toggle {
  position: absolute;
  right: var(--space-2);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-1);
  border: 0;
  background: none;
  color: var(--ink-muted);
  cursor: pointer;
}

.search-select__toggle:disabled {
  color: var(--ink-disabled);
  cursor: default;
}

.search-select__menu {
  position: absolute;
  z-index: var(--z-dropdown);
  top: calc(100% + var(--space-1));

  /*
   * Exactly the field's width.
   *
   * It is tempting to let the menu grow to its longest label, and that is what
   * a native `<select>` does — but a native menu is drawn by the browser
   * outside the page. This one is an ordinary absolutely-positioned element,
   * so anything it sticks out past becomes scrollable overflow of the nearest
   * scroll container: a panel that could suddenly be dragged sideways, which
   * is what reka does when it scrolls a highlighted row into view. A row that
   * is too long to read is a smaller problem than a panel that moves, and the
   * `title` on each row gives the full text back.
   */
  right: 0;
  left: 0;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  box-shadow: var(--shadow-md);
}

.search-select__viewport {
  max-height: var(--grid-8);
  padding: var(--space-1);
  overflow-x: hidden;
  overflow-y: auto;
}

.search-select__empty {
  padding: var(--space-2) var(--space-3);
  color: var(--ink-muted);
  font-size: var(--text-label);
}

.search-select__option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  color: var(--ink);
  font-size: var(--text-label);
  cursor: pointer;
}

.search-select__option[data-highlighted] {
  background: var(--surface-sunken);
}

.search-select__option[data-disabled] {
  color: var(--ink-disabled);
  cursor: default;
}

/* Not a value: reads as the absence of one, the way a blank option did. */
.search-select__option--empty {
  color: var(--ink-muted);
}

.search-select__option[data-state='checked'] {
  font-weight: var(--weight-semibold);
}

.search-select__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.search-select__hit {
  background: none;
  color: var(--action);
  font-weight: var(--weight-semibold);
}

.search-select__indicator {
  display: inline-flex;
  flex-shrink: 0;
  color: var(--ink-muted);
}
</style>
