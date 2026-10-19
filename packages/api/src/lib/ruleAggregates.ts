/**
 * The deployment-level gate on `GROUP` aggregation in SRL.
 *
 * `GROUP` is the body element proposed in w3c/data-shapes#1344, with the
 * grammar of w3c/data-shapes#1347. Until that pull request is merged it is not
 * in the specification, so a document using it cannot be read by conformant
 * tooling, and the `ruleAggregates` flag defaults off, as `ruleTuples` does
 * (./ruleTuples.ts).
 *
 * Unlike rule tuples there is no per-version switch. Tuples need one because a
 * rule set version carries seed rows that only mean something with the
 * extension on; a `GROUP` is entirely inside the rule text. With the flag on
 * the server parses `GROUP`; with it off `GROUP` is a syntax error everywhere a
 * rule is parsed, so a rule using it cannot be saved, stratified or run.
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
 * True when an SRL source uses `GROUP`.
 *
 * The executor needs this because parsing is not the only gate it passes
 * through. A rule saved while the flag was on carries a compiled
 * `normalizedInsert`, and its rule set version a stored stratification report,
 * so a run can reach the rule without parsing it again. Asking the parser,
 * rather than searching the text for the word, keeps a comment or a literal
 * containing "group" from counting.
 */
export function usesRuleAggregates(source: string): boolean {
  if (!/group/i.test(source)) return false;
  try {
    parseRuleSet(source, { tuples: true, aggregates: false });
    return false;
  } catch (error) {
    return error instanceof Error && error.message.includes('rule-aggregates extension');
  }
}
