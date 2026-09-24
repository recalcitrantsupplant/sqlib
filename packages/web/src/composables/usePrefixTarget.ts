import { computed, onScopeDispose, shallowRef, toValue, watchEffect, type MaybeRefOrGetter } from 'vue';
import { prefixGrammarFor } from '@/lib/codeLanguage';
import { addDeclarations } from '@/lib/prefixRewrite';
import type { PrefixPair } from '@/lib/curie';

/**
 * Which editor the Prefix Manager's "Add to editor" writes into.
 *
 * The manager opens from the nav rail, so it is a sibling of whatever work
 * area is on screen rather than a descendant of it — there is no ancestor to
 * hang a provide off without wrapping every section in one. So the destination
 * is a module singleton, the same shape and for the same reason as
 * `useEditorExpand`: one screen, one editor that is being written in.
 *
 * A screen with no such editor registers nothing, and the button is disabled
 * rather than absent — the manager is reachable from everywhere, and a control
 * that vanishes per screen is harder to find than one that explains itself.
 */

export interface PrefixTarget {
  /** Names the destination in the message that reports the result: "the query". */
  label: string;
  /** Declares what is not declared yet; returns how that went. */
  add(pairs: readonly PrefixPair[]): { added: number; skipped: number };
}

const target = shallowRef<PrefixTarget | null>(null);

export function usePrefixTarget() {
  return { target: computed(() => target.value) };
}

/**
 * Register the calling component's editor as the destination, for as long as
 * that component is alive.
 *
 * `contentType` decides the grammar the document's own declarations are read
 * with, and it is a getter because a screen can change what it is holding —
 * the test screen's expectation is Turtle for a graph and JSON for bindings.
 * A language `prefixGrammarFor` has no grammar for cannot be written into
 * safely, so the editor stops being a destination rather than being guessed
 * at.
 */
export function useEditorAsPrefixTarget(options: {
  label: MaybeRefOrGetter<string>;
  contentType: MaybeRefOrGetter<string | null | undefined>;
  read: () => string;
  write: (text: string) => void;
}): void {
  const parser = computed(() => prefixGrammarFor(toValue(options.contentType)));

  const entry: PrefixTarget = {
    get label() {
      return toValue(options.label);
    },
    add(pairs) {
      if (!parser.value) return { added: 0, skipped: pairs.length };

      const result = addDeclarations(options.read(), pairs, parser.value);
      if (result.added.length > 0) options.write(result.text);
      return { added: result.added.length, skipped: result.skipped.length };
    },
  };

  watchEffect(() => {
    if (parser.value) target.value = entry;
    else if (target.value === entry) target.value = null;
  });

  onScopeDispose(() => {
    // Only if it is still ours: the next screen registers before this one is
    // torn down, and clearing then would leave the new editor unreachable.
    if (target.value === entry) target.value = null;
  });
}
