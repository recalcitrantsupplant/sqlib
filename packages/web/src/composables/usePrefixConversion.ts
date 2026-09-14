/**
 * The two whole-document prefix conversions, as the toolbar sees them.
 *
 * `lib/prefixRewrite` owns what a conversion *is*; this owns what a button
 * press *does* — which mappings to convert against, what to say when nothing
 * changed, and what counts as a document worth touching. Keeping the split
 * means the rewrite rules are tested against strings rather than against a
 * mounted toolbar.
 *
 * Both directions are always offered. A document is rarely all one or all the
 * other: people paste a full IRI into a query that already declares half a
 * dozen prefixes, so "expand" and "contract" are both live at once and neither
 * is the inverse of a state the user is currently in.
 */

import { computed, type MaybeRefOrGetter, toValue } from 'vue';
import { toast } from 'vue-sonner';
import { usePrefixManager } from '@/composables/usePrefixManager';
import { prefixGrammarFor } from '@/lib/codeLanguage';
import { toPrefixedNames, toFullIris } from '@/lib/prefixRewrite';

/**
 * @param contentType What the document is. A language the app has no grammar
 *   of its own for converts nothing and reports `supported` false, so a caller
 *   can leave the buttons out rather than offer an approximate rewrite.
 */
export function usePrefixConversion(contentType: MaybeRefOrGetter<string | null | undefined>) {
  const { effectivePairs, prefixSettings } = usePrefixManager();

  const parser = computed(() => prefixGrammarFor(toValue(contentType)));
  const supported = computed(() => parser.value !== null);

  function namespaceFor(prefix: string): string | undefined {
    return prefixSettings.value.mappings.find((m) => m.enabled && m.prefix === prefix)?.namespace;
  }

  /**
   * Full IRIs down to prefixed names.
   *
   * Returns the rewritten document, or null when nothing changed — the caller
   * then leaves its own state alone rather than pushing an identical value
   * back through the editor and marking the document dirty for nothing.
   */
  function toPrefixed(code: string): string | null {
    if (parser.value === null || !code.trim()) {
      if (parser.value !== null) toast.error('Nothing to convert');
      return null;
    }

    const result = toPrefixedNames(code, effectivePairs(), parser.value);

    if (result.converted === 0) {
      toast.info(
        result.skippedShadowed > 0
          ? 'No IRIs shortened — this document already binds those prefixes to other namespaces'
          : 'No IRIs matched a known prefix',
      );
      return null;
    }

    const declared = result.added.length > 0
      ? `, declaring ${result.added.map((p) => `${p.prefix}:`).join(', ')}`
      : '';
    toast.success(`Shortened ${count(result.converted, 'IRI')}${declared}`);
    return result.text;
  }

  /**
   * Prefixed names back out to full IRIs, sweeping the declarations that then
   * name nothing.
   *
   * Only the ones the manager can put back are swept, so the round trip stays
   * lossless: contracting re-declares them. A prefix the manager does not know
   * keeps its declaration — see `toFullIris`.
   */
  function toIris(code: string): string | null {
    if (parser.value === null || !code.trim()) {
      if (parser.value !== null) toast.error('Nothing to convert');
      return null;
    }

    const result = toFullIris(code, namespaceFor, parser.value);

    if (result.converted === 0) {
      toast.info('No prefixed names to expand');
      return null;
    }

    const swept = result.removed.length > 0
      ? `, removing ${count(result.removed.length, 'unused declaration')}`
      : '';
    toast.success(`Expanded ${count(result.converted, 'prefixed name')}${swept}`);
    return result.text;
  }

  return { toPrefixed, toIris, supported };
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}
