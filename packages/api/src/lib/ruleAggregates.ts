/**
 * The deployment-level gate on the SRL rule-aggregates extension.
 *
 * The extension adds an `AGGREGATE` body element to SRL, following a proposal
 * in w3c/data-shapes#840 that the specification does not include. Like the
 * rule-tuples extension (./ruleTuples.ts), a document using it cannot be read
 * by conformant tooling, so the `ruleAggregates` flag defaults off.
 *
 * Unlike rule tuples there is no per-version switch. Tuples need one because a
 * rule set version carries seed rows that only mean something with the
 * extension on; an aggregate is entirely inside the rule text. With the flag on
 * the server parses `AGGREGATE`; with it off `AGGREGATE` is a syntax error
 * everywhere a rule is parsed, so a rule using it cannot be saved, stratified
 * or run.
 *
 * The conformance checks (./srlChecks.ts) and the W3C suite seeding never turn
 * it on, for the reason they never turn tuples on.
 */
import { parseRuleSet } from '@sparql-query-lib/srl';
import { getFeatureFlags } from '../config/featureFlags.js';

/** What a run is told when a rule needs the extension this server withholds. */
export const RULE_AGGREGATES_DISABLED_MESSAGE =
  'uses the rule-aggregates extension, which is not enabled on this server';

/** Whether this deployment offers the rule-aggregates extension. */
export function ruleAggregatesAllowed(): boolean {
  return getFeatureFlags().ruleAggregates;
}

/**
 * True when an SRL source uses `AGGREGATE`.
 *
 * The executor needs this because parsing is not the only gate it passes
 * through. A rule saved while the flag was on carries a compiled
 * `normalizedInsert`, and its rule set version a stored stratification report,
 * so a run can reach the rule without parsing it again. Asking the parser,
 * rather than searching the text for the word, keeps a comment or a literal
 * containing "aggregate" from counting.
 */
export function usesRuleAggregates(source: string): boolean {
  if (!/aggregate/i.test(source)) return false;
  try {
    parseRuleSet(source, { tuples: true, aggregates: false });
    return false;
  } catch (error) {
    return error instanceof Error && error.message.includes('rule-aggregates extension');
  }
}
