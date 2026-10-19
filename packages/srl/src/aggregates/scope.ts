import type { SrlAggregate, SrlBodyItem } from '../ast.js';
import { collectVars } from '../wellformed.js';

/**
 * Every variable a `GROUP`'s pattern mentions, `SET` targets included.
 *
 * `collectVars` finds variables by walking term nodes, and a `SET` names its
 * target as a plain string, so a pattern `{ ?s :p ?o SET (?z := ?o + 1) }`
 * would otherwise lose `?z`. The compiler renames these variables and the
 * well-formedness checks scope them, and the two have to agree on the set: a
 * variable one of them missed would be shared with the outer body unnoticed.
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
