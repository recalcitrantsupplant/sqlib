import { computed, ref, watch, onScopeDispose, type Ref } from 'vue';
import { useApiClient, type RuleSetSrlAnalysis, type SrlDocumentBlock } from './useApiClient';

/**
 * What the rules editor knows about the document in front of it.
 *
 * The rule set screen shows four things that all come from parsing the same
 * text — whether it is valid SRL, which lines each rule occupies, which stratum
 * each rule lands in, and how the rules depend on one another. Computing them
 * separately would mean four passes that can disagree with each other, so this
 * is one call, debounced, and every consumer reads the same answer.
 *
 * The analysis is server-side because the parser is: the SRL grammar is a
 * Traqula extension living in `@sparql-query-lib/srl`, and shipping it to the
 * browser to duplicate a route that already exists is not worth the bundle.
 * The cost is a round trip per pause in typing, which is why the previous
 * result is *kept* while the next one is in flight — the gutter must not blink
 * empty every time a character lands.
 */
export function useSrlAnalysis(
  document: Ref<string>,
  tuplesEnabled: Ref<boolean>,
  options: { debounceMs?: number; enabled?: Ref<boolean> } = {},
) {
  const apiClient = useApiClient();
  const debounceMs = options.debounceMs ?? 400;

  const analysis = ref<RuleSetSrlAnalysis | null>(null);
  const analyzing = ref(false);
  /** A transport failure, as distinct from a document that does not parse. */
  const requestError = ref<string | null>(null);

  let timer: ReturnType<typeof setTimeout> | null = null;
  /*
   * Only the newest request may write. Responses can land out of order, and an
   * older one overwriting a newer one shows the user a stratification for text
   * they have already changed.
   */
  let seq = 0;

  const run = async (text: string, tuples: boolean) => {
    const current = ++seq;
    if (!text.trim()) {
      analysis.value = null;
      requestError.value = null;
      analyzing.value = false;
      return;
    }
    analyzing.value = true;
    try {
      const result = await apiClient.analyzeRuleSetSrl(text, { tuples });
      if (current !== seq) return;
      analysis.value = result;
      requestError.value = null;
    } catch (error) {
      if (current !== seq) return;
      requestError.value = error instanceof Error ? error.message : 'Could not analyze the document';
    } finally {
      if (current === seq) analyzing.value = false;
    }
  };

  const schedule = () => {
    if (options.enabled && !options.enabled.value) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => run(document.value, tuplesEnabled.value), debounceMs);
  };

  watch([document, tuplesEnabled], schedule, { immediate: true });

  onScopeDispose(() => {
    if (timer) clearTimeout(timer);
    // Nothing may write after the scope is gone.
    seq += 1;
  });

  /** Re-analyze now, skipping the debounce — after a load, say. */
  const refresh = () => {
    if (timer) clearTimeout(timer);
    return run(document.value, tuplesEnabled.value);
  };

  const blocks = computed<SrlDocumentBlock[]>(() => analysis.value?.blocks ?? []);
  const ruleBlocks = computed(() => blocks.value.filter((block) => block.kind === 'rule'));
  const stratification = computed(() => analysis.value?.stratification ?? null);

  /*
   * Idle before the first answer, so the footer says "not checked" rather than
   * claiming a document is valid or invalid before anything has looked at it.
   */
  const validationState = computed<'idle' | 'validating' | 'valid' | 'error'>(() => {
    if (!document.value.trim()) return 'idle';
    if (!analysis.value) return analyzing.value ? 'validating' : 'idle';
    return analysis.value.valid ? 'valid' : 'error';
  });

  const parseError = computed(() => (analysis.value && !analysis.value.valid ? analysis.value.error : null));

  return {
    analysis,
    analyzing,
    requestError,
    blocks,
    ruleBlocks,
    stratification,
    validationState,
    parseError,
    refresh,
  };
}
