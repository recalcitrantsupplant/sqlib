import type { SrlAggregate } from '../ast.js';
import { collectVars } from '../wellformed.js';

/**
 * The variables an `AGGREGATE`'s inner pattern sees from the outer body.
 *
 * For `PER ?x …` and `GROUP BY ?x …` that is the list as written. For `PER *`
 * it is every variable the inner pattern mentions that is bound by the
 * elements before the aggregate, in the order the inner pattern mentions them.
 *
 * Shared by the compiler and the well-formedness checks, which must agree on
 * it: a key the checks did not see would be a correlation nobody was told of.
 */
export function aggregateKeys(item: SrlAggregate, boundBefore: ReadonlySet<string>): string[] {
  if (item.mode !== 'per-all') return [...item.keys];
  const inner = new Set<string>();
  collectVars(item.body, inner);
  return [...inner].filter((name) => boundBefore.has(name));
}
