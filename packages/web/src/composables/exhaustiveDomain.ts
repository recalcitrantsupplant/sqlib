/**
 * Compile-time proof that a runtime array lists every member of its union.
 *
 * The matrices in `test/lib/canvas*.test.ts` enumerate the canvas state space
 * by iterating runtime arrays of what are otherwise type-only unions. That
 * makes the arrays load-bearing in a way that fails silently: adding a node
 * kind or an entity kind without extending the array does not break anything,
 * it just quietly shrinks every matrix built from it, and the suite stays green
 * while covering less. Coverage that can shrink without saying so is the same
 * vacuity trap the phase 2 harness documents on the API side.
 *
 * `as const satisfies readonly T[]` already catches the easy direction - a
 * value that is not a member of the union. `Covers` catches the direction that
 * matters here: a union member the array forgot.
 *
 * These live in `src/` rather than beside the tests on purpose. `packages/web`
 * typechecks `src/**` only (see tsconfig `include`), so a guard written in a
 * test file would never be evaluated by CI.
 *
 * Usage:
 *
 * ```ts
 * export const GRAPH_NODE_KINDS = ['start', 'query'] as const satisfies readonly GraphNodeKind[];
 * export const _graphNodeKindsCover: Covers<GraphNodeKind, (typeof GRAPH_NODE_KINDS)[number]> = true;
 * ```
 *
 * A missing member turns the annotation into a tuple type, so `= true` stops
 * compiling and the error names the members that were left out.
 */
export type Covers<Union, Listed extends Union> = [Exclude<Union, Listed>] extends [never]
  ? true
  : ['domain array is missing union members:', Exclude<Union, Listed>];
