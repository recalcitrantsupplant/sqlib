import type { SrlAggregate, SrlBodyItem } from '../ast.js';
import { collectVars } from '../wellformed.js';

/**
 * Every variable a `GROUP`'s pattern mentions, `SET` targets included.
 *
 * `collectVars` finds variables by walking term nodes, and a `SET` names its
 * target as a plain string, so a pattern `{ ?s :p ?o SET (?z := ?o + 1) }`
 * would otherwise lose `?z`. The well-formedness checks scope these
 * variables: a variable they missed could be reused before or after the
 * `GROUP` without an `in-use` error.
 */
export function aggregateInnerVars(item: SrlAggregate): Set<string> {
  const names = new Set<string>();
  collectVars(item.body, names);
  for (const inner of item.body) addSetTargets(inner, names);
  return names;
}

function addSetTargets(item: SrlBodyItem, into: Set<string>): void {
  if (item.kind === 'set') into.add(item.variable);
}
