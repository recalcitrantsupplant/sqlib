/**
 * Which IRIs in a flat group-version payload have to resolve, and to what.
 *
 * See `docs/guides/query-groups.md`. This is the one declaration of the rules,
 * shared by the writer's staging phase and
 * `GET /query-groups/:id/v/:version/validate`, so the two cannot drift.
 *
 * The `allowedTypes` column is no longer written out here: an entity property
 * now declares what its IRI may point at (`@references`, issue #65 Phase B3),
 * so this file reads the model instead of restating it. What stays hand-written
 * is what the model has no way to say — the `category` column, which is a
 * property of a *flat write payload* (some IRIs in it are minted by the payload
 * itself) rather than of the RDF shape, and `DynamicQueryNode`'s deliberate
 * omission of `queryId`.
 */

import { referenceTypesOf, type SchemaProperty } from './entityReferences.js';
import type { EntityType } from './EntityRegistry.js';

/** Anything an edge may treat as one of its endpoints. */
export const NODE_REFERENCE_TYPES = [
  'StartNode',
  'EndNode',
  'QueryNode',
  'DynamicQueryNode',
  'RuleSetNode',
  'PatchNode',
] as const satisfies readonly EntityType[];

/**
 * Anything that can sit on either end of a data-flow edge, or in a node's
 * inputs/outputs. Broad because a node's arrays legitimately mix tuples,
 * scalars and RDF ports.
 */
export const IO_REFERENCE_TYPES = [
  'QueryInputTuple',
  'QueryOutputTuple',
  'QueryInputVariable',
  'QueryOutputVariable',
  'TriplesQuadsIO',
  'BooleanIO',
  'QueryIdInput',
  'TupleMember',
] as const satisfies readonly EntityType[];

/** The node reference targets, taken from the entity model. */
export const QUERY_VERSION_TYPES = referenceTypesOf('QueryNode', 'queryId');
export const BACKEND_TYPES = referenceTypesOf('QueryNode', 'backendId');
export const RULESET_VERSION_TYPES = referenceTypesOf('RuleSetNode', 'ruleSetVersion');

/**
 * How a reference is allowed to resolve.
 *
 * A two-way minted/external split does not fit: node I/O arrays, edge endpoints
 * and tuple members all legitimately mix IRIs minted by this payload with
 * pre-existing ones — the seeded I/O taken from `queryVersion.inferredInputs`
 * are existing store IRIs flowing into the same arrays as freshly minted ports.
 */
export type ReferenceCategory =
  /** Must have been minted by this payload. */
  | 'minted'
  /** Must already exist in the store. */
  | 'external'
  /** Either. */
  | 'mintedOrExternal';

export interface ReferenceRule {
  category: ReferenceCategory;
  /** Acceptable `@type`s. Existence alone is not enough: without this a
   *  RuleSetNode can point at a Backend and be written. */
  allowedTypes: readonly EntityType[];
}

/**
 * The external references carried by an execution node, by node type.
 *
 * Each entry says only what the entity model cannot: the `category`, and the
 * property the flat payload's field name corresponds to. The allowed types come
 * from that property's `@references`.
 *
 * `DynamicQueryNode` deliberately omits `queryId`: its query arrives at
 * execution time through a `QueryIdInput`, which is the entire point of the
 * node type. A blanket "queryId must resolve" would reject every dynamic-node
 * payload. If one is supplied anyway it still has to resolve.
 */
const NODE_REFERENCE_SOURCES = {
  QueryNode: {
    queryId: { category: 'external', property: 'queryId' },
    backendId: { category: 'external', property: 'backendId' },
  },
  DynamicQueryNode: {
    backendId: { category: 'external', property: 'backendId' },
  },
  RuleSetNode: {
    ruleSetVersion: { category: 'external', property: 'ruleSetVersion' },
  },
  /**
   * A PatchNode names the update it derives and the store it derives against,
   * exactly as a QueryNode names the query it runs and where it runs it. Its
   * two output ports are *not* here: they are minted by the same payload as
   * `rdfOutputs`, so they resolve through `IO_REF` like every other port, and
   * the extra rule they need — that both are declared and appear in `outputs` —
   * is a relationship between three fields rather than a property of one.
   */
  PatchNode: {
    queryId: { category: 'external', property: 'queryId' },
    backendId: { category: 'external', property: 'backendId' },
  },
} as const satisfies {
  [T in 'QueryNode' | 'DynamicQueryNode' | 'RuleSetNode' | 'PatchNode']: Record<
    string,
    { category: ReferenceCategory; property: SchemaProperty<T> }
  >;
};

export const NODE_REFERENCE_RULES: Record<string, Record<string, ReferenceRule>> =
  Object.fromEntries(
    Object.entries(NODE_REFERENCE_SOURCES).map(([nodeType, fields]) => [
      nodeType,
      Object.fromEntries(
        Object.entries(fields as Record<string, { category: ReferenceCategory; property: string }>).map(
          ([field, { category, property }]) => [
            field,
            {
              category,
              allowedTypes: referenceTypesOf(
                nodeType as 'QueryNode' | 'DynamicQueryNode' | 'RuleSetNode' | 'PatchNode',
                property as never,
              ),
            },
          ],
        ),
      ),
    ]),
  );

/** Node fields that must resolve when present but may be omitted entirely. */
export const OPTIONAL_NODE_REFERENCES: Record<string, readonly string[]> = {
  // Supplied only when the author pins a specific query up front.
  DynamicQueryNode: ['queryId'],
};

export const TEMP_ID_PREFIX = 'urn:ui-temp:';

/** One reference that could not be resolved. */
export interface ReferenceFailure {
  /** Where it appeared, e.g. `executionNodes[0].queryId` */
  field: string;
  /** The IRI as the client sent it */
  reference: string;
  reason: string;
}

/**
 * Thrown when staging finds references it cannot resolve.
 *
 * Carries every failure rather than the first: an author fixing a hand-written
 * payload should not need four round trips to find four bad IRIs. The route
 * maps this to 422 — the body is well-formed, it just is not satisfiable.
 */
export class UnresolvableReferencesError extends Error {
  readonly failures: ReferenceFailure[];

  constructor(failures: ReferenceFailure[]) {
    const detail = failures
      .map(f => `${f.field}: ${f.reference} (${f.reason})`)
      .join('; ');
    super(`Unresolvable references: ${detail}`);
    this.name = 'UnresolvableReferencesError';
    this.failures = failures;
  }
}

export function isUnresolvableReferencesError(
  error: unknown
): error is UnresolvableReferencesError {
  return error instanceof UnresolvableReferencesError;
}

/** The subset of CacheCoordinator the resolver needs. */
export interface ReferenceStore {
  resolveExisting(
    id: string,
    candidateTypes?: readonly EntityType[]
  ): Promise<{ type: EntityType; entity: unknown } | null>;
}

/**
 * Resolves the references in one payload, accumulating failures instead of
 * throwing at the first one.
 */
export class ReferenceResolver {
  private readonly failures: ReferenceFailure[] = [];

  constructor(
    private readonly iriMap: Record<string, string>,
    private readonly store: ReferenceStore
  ) {}

  /**
   * Resolve one reference according to its rule.
   *
   * Returns the resolved IRI, or undefined when it could not be resolved — in
   * which case a failure has been recorded and staging will throw before
   * anything is written.
   */
  async resolve(
    field: string,
    reference: string | undefined,
    rule: ReferenceRule
  ): Promise<string | undefined> {
    if (!reference) return undefined;

    const minted = this.iriMap[reference];
    if (minted) return minted;

    // A temp URN that nothing in the payload declared is always a client
    // error, whatever the rule says — there is no store to fall back to.
    if (reference.startsWith(TEMP_ID_PREFIX)) {
      this.fail(field, reference, 'no resource in this payload declares this temporary id');
      return undefined;
    }

    if (rule.category === 'minted') {
      this.fail(field, reference, 'expected an id minted by this payload');
      return undefined;
    }

    const resolved = await this.store.resolveExisting(reference, rule.allowedTypes);
    if (!resolved) {
      this.fail(field, reference, 'does not exist');
      return undefined;
    }

    if (rule.allowedTypes.length > 0 && !rule.allowedTypes.includes(resolved.type)) {
      this.fail(
        field,
        reference,
        `is a ${resolved.type}, expected ${rule.allowedTypes.join(' or ')}`
      );
      return undefined;
    }

    return reference;
  }

  /** Resolve a list, preserving order and dropping what did not resolve. */
  async resolveAll(
    field: string,
    references: readonly (string | undefined)[] | undefined,
    rule: ReferenceRule
  ): Promise<string[]> {
    const out: string[] = [];
    for (const [index, reference] of (references ?? []).entries()) {
      const resolved = await this.resolve(`${field}[${index}]`, reference, rule);
      if (resolved) out.push(resolved);
    }
    return out;
  }

  fail(field: string, reference: string, reason: string): void {
    this.failures.push({ field, reference, reason });
  }

  get hasFailures(): boolean {
    return this.failures.length > 0;
  }

  /** Throw once with everything found, if anything was. */
  throwIfFailed(): void {
    if (this.failures.length > 0) {
      throw new UnresolvableReferencesError(this.failures);
    }
  }
}
