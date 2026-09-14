<template>
  <component :is="as" class="inline-note" :class="[`inline-note--${tone}`, `inline-note--${size}`]">
    <slot />
  </component>
</template>

<script setup lang="ts">
/**
 * The muted sentence: a hint under a control, a note beside a label, the line
 * that stands where a list would be.
 *
 * `SectionLabel` is the 11px uppercase muted label; this is its lowercase twin,
 * and it was the one of the two nobody had written. An audit of `src` found the
 * same two declarations — `--text-label` on `--ink-muted` — hand-written 64
 * times across 39 files, `FormField` and `InlineField` among them: the two
 * primitives that exist so a labelled control is not drawn by hand each write
 * their own hint. See `docs/reference/ui-design-tokens.md`.
 *
 * Deliberately not the *datum*. Roughly half of those 64 are counts, versions
 * and status words — a value rendered small, related to a note only by its type
 * spec. A count is not a sentence and does not become one by sharing a font
 * size, so those are left where they are.
 *
 * **Margin stays with the parent**, the rule the fifth pass set for `boxed`:
 * where a note sits is a fact about the block above it. Pass a class and keep
 * the margin in the parent's own rule — it lands here, because Vue puts the
 * parent's scope attribute on a child's root element.
 */
withDefaults(
  defineProps<{
    /**
     * The element. Half these sites are a `<span>` in a flex row rather than a
     * paragraph under a field, and a `<p>` there would break the row.
     */
    as?: 'p' | 'span' | 'div' | 'li';
    /**
     * `danger` is the same note in `--danger-ink`. Seven files wrote it as a
     * `--error` modifier over their own note class, and `InlineField` writes
     * `__hint` and `__error` as one spec differing in `color` — so it is a tone
     * of this note rather than a second thing.
     */
    tone?: 'muted' | 'danger';
    /**
     * The dense step. `sm` is `--text-label`, the scale every note the tenth and
     * eleventh passes converted was written at; `xs` is `--text-micro`, the step
     * below it, which an audit of `src` found hand-written eighteen times — in
     * sidebars, table footers, menu rows and tile captions, the chrome that has
     * a note to make and less room than a form has.
     *
     * Named for the scale rather than for its rank here, so `sm` means
     * `--text-label` on this primitive and on `SectionLabel` alike: the two are
     * rendered side by side (a `SectionLabel size="sm"` over a note is the tile
     * caption's own shape), and a `sm` that meant 11px in one and 10px in the
     * other would be a trap at exactly the sites that use both.
     */
    size?: 'sm' | 'xs';
  }>(),
  { as: 'p', tone: 'muted', size: 'sm' },
);
</script>

<style scoped>
/*
 * `line-height` is stated rather than inherited. Twenty-two of the 64 sites set
 * `--leading-normal` and the rest left it to the cascade, which resolves to the
 * same 1.5 from Tailwind's preflight — so stating it moves nothing today and
 * stops a pane that sets a tighter line-height from silently squashing a
 * wrapped hint.
 *
 * There is deliberately NO `margin: 0` here, though ten of the sites wrote one.
 * Preflight already zeroes every element's margin from `*`, so the declaration
 * would be a restatement — and a costly one: a parent's own margin rule
 * (`.arguments-hint`) compiles to one class plus one scope attribute, exactly
 * the specificity of `.inline-note` plus its own, so the two would tie and the
 * winner would be chunk order. The rule the primitive states, it owns; the
 * margin it never mentions stays the parent's to set.
 */
.inline-note {
  line-height: var(--leading-normal);
}

.inline-note--sm {
  font-size: var(--text-label);
}

/*
 * `--leading-normal` is stated for this step too, rather than tightened. Three of
 * the eighteen sites set it explicitly and the other fifteen inherited it from
 * preflight, which resolves to the same 1.5 — so 1.5 is what the dense step
 * already renders at, and `--leading-tight` here would shorten every one of them
 * by 2.5px, which is a shift and not a step.
 */
.inline-note--xs {
  font-size: var(--text-micro);
}

.inline-note--muted {
  color: var(--ink-muted);
}

.inline-note--danger {
  color: var(--danger-ink);
}
</style>
