/**
 * A query group's `LIMIT` / `OFFSET` parameters: the union of its members'.
 *
 * `/execute` used to refuse these for a group outright, on the grounds that
 * there is "no unambiguous single query to which a global LIMIT/OFFSET can be
 * applied". That is true of a *global* value, and the answer is not to make one:
 * a `LIMIT` placeholder is already named (`LIMIT 00010`), so a value reaches
 * exactly those nodes whose query declares that name. Two nodes sharing a name
 * share the value — which is what sharing a name means — and a node that must
 * page independently names its parameter differently, the same way two `VALUES`
 * clauses over the same variables are told apart.
 *
 * A name is digits: `detectInputs` matches `LIMIT 000(\d+)`, so `00010` names
 * the parameter `10`. Narrower than `substituteLimitOffset`, which accepts any
 * `[A-Za-z0-9_]+` — a mismatch that predates this and is left alone, since
 * widening detection would change what every stored query is found to declare.
 *
 * Computed here once, server-side, and served on the group version detail, so
 * the screen offering the fields and the engine applying them cannot disagree
 * about what the group declares. See `docs/concepts.md`.
 *
 * Derived from each member's *query text* rather than from the
 * `limitParameters` / `offsetParameters` entity lists on its version. Both are
 * written from the same detection at save, but the text is what
 * `substituteLimitOffset` actually rewrites and what `ExecutionEngine` filters
 * by, so reading it is the spelling that cannot drift.
 */

import { getCacheCoordinator } from './CacheCoordinatorProvider.js';
import { SparqlQueryParser } from './parser.js';
import { getNodeQueryId } from './type-guards.js';
import type { LdkitQueryGroupVersion } from '../persistence/schemas/QueryGroupVersionSchema.js';
import type { LdkitQueryVersion } from '../persistence/schemas/QueryVersionSchema.js';
import type { AnyNodeType } from './type-guards.js';

export interface QueryGroupPageParameters {
  limitParameters: string[];
  offsetParameters: string[];
}

const EMPTY: QueryGroupPageParameters = { limitParameters: [], offsetParameters: [] };

export class QueryGroupSignatureService {
  constructor(private readonly parser = new SparqlQueryParser()) {}

  /**
   * The page parameters a group version declares, sorted and deduplicated.
   *
   * Never throws: this is asked on a read path (a version detail) and on a
   * validation path, and neither should turn a malformed node into a 500. A
   * node whose query cannot be resolved or parsed simply contributes nothing —
   * the run itself will fail on that node with a better message than this
   * could give.
   */
  pageParametersFor(groupVersionId: string): QueryGroupPageParameters {
    const cacheCoordinator = getCacheCoordinator();
    const version = cacheCoordinator.get(groupVersionId) as LdkitQueryGroupVersion | null;
    if (!version || version['@type'] !== 'QueryGroupVersion') return EMPTY;

    const limits = new Set<string>();
    const offsets = new Set<string>();

    for (const nodeId of version.executionNodes ?? []) {
      const node = cacheCoordinator.get(nodeId) as AnyNodeType | null;
      if (!node) continue;
      /*
       * A DynamicQueryNode has no `queryId` — its text arrives at run time — so
       * it declares nothing here. That is not a gap: a group cannot offer a
       * field for a placeholder nobody can see until the run is under way.
       */
      const queryVersionId = getNodeQueryId(node);
      if (!queryVersionId) continue;
      const queryVersion = cacheCoordinator.get(queryVersionId) as LdkitQueryVersion | null;
      if (!queryVersion || queryVersion['@type'] !== 'QueryVersion') continue;
      const queryString = typeof queryVersion.queryString === 'string' ? queryVersion.queryString : null;
      if (!queryString) continue;

      try {
        const detected = this.parser.detectInputs(queryString);
        for (const name of detected.limitParameters) limits.add(name);
        for (const name of detected.offsetParameters) offsets.add(name);
      } catch {
        continue;
      }
    }

    return {
      limitParameters: [...limits].sort(),
      offsetParameters: [...offsets].sort(),
    };
  }
}
