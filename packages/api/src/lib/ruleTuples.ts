/**
 * The deployment-level gate on the SRL rule-tuples extension.
 *
 * There are two separate switches on this feature and they answer different
 * questions. A rule set version's `tuplesEnabled` is the *document's* setting:
 * whether this SRL document is written in extended SRL, chosen per version by
 * its author. The `ruleTuples` feature flag here is the *deployment's* setting:
 * whether this server offers the extension at all. The flag sits above the
 * toggle, so with the flag off a request cannot turn the toggle on, supply
 * seed rows, or parse a `TUPLE( … )` — the toggle itself is not drawn.
 *
 * The extension is not conformant SPARQL-RL (w3c/data-shapes#752), so a
 * document written with it on cannot be read by other tooling. That is why the
 * flag defaults off: a build that did not ask for the extension should not
 * offer an author a way to write a document only this server can read.
 *
 * None of this concerns the `TupleSet` entity or the `tupleSets` flag. A tuple
 * set is a saved table of RDF terms spliced into a `VALUES` clause, and it is
 * reachable from queries and argument sets that have nothing to do with rules.
 */
import { getFeatureFlags } from '../config/featureFlags.js';

/** What a caller is told when it asks for an extension this server withholds. */
export const RULE_TUPLES_DISABLED_MESSAGE =
  'The rule-tuples extension is not enabled on this server';

/** Whether this deployment offers the rule-tuples extension. */
export function ruleTuplesAllowed(): boolean {
  return getFeatureFlags().ruleTuples;
}

/**
 * The refusal a request earns by asking for the extension, or null when it may
 * proceed. `asked` is true when the request carries anything that only means
 * something with the extension on: the `tuples` switch, a seed document, a
 * `tuplesEnabled` of true, or a tuple seed input on an execute.
 */
export function ruleTuplesRefusal(asked: boolean): string | null {
  if (!asked) return null;
  return ruleTuplesAllowed() ? null : RULE_TUPLES_DISABLED_MESSAGE;
}

/** True when a value is a seed document with content rather than an empty box. */
export function hasSeedText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}
