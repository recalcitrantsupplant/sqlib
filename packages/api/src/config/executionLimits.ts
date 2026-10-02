/**
 * How long, and how far, one execution may run.
 *
 * Read from the environment on every call rather than once at import, so a
 * test (or an operator restarting with a new value) sees the value in force.
 *
 * What these bound, and what they cannot:
 *
 * - The **deadline** is checked before every node of a group and every rule
 *   and DATA block of a rule set, and aborts in-flight HTTP requests to a
 *   backend. It cannot interrupt a single in-process Oxigraph query or
 *   update: `Store.query` is synchronous and holds the event loop until it
 *   returns. A run over in-process stores therefore stops at the first
 *   boundary after the deadline, not at the deadline itself (decision D4 in
 *   `docs/proposals/2026-09-review-work-packages.md` chose caps over moving
 *   Oxigraph onto worker threads).
 * - The **iteration cap** bounds how far a rule set's fixpoint may iterate,
 *   whatever a request asks for.
 * - The **ETL node row cap** bounds what one ETL node in a group may read; a
 *   source with more rows fails the node rather than being truncated.
 */

function positiveInteger(name: string, fallback: number, { allowZero = false } = {}): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0 || (value === 0 && !allowZero)) return fallback;
  return value;
}

/**
 * `SQLIB_EXECUTION_TIMEOUT_MS`: the most one execution (a query group run, a
 * rule set run) may take, in milliseconds. `0` turns the deadline off.
 */
export function executionDeadlineMs(): number {
  return positiveInteger('SQLIB_EXECUTION_TIMEOUT_MS', 300_000, { allowZero: true });
}

/**
 * `SQLIB_MAX_RULE_ITERATIONS`: the most fixpoint iterations a rule set run may
 * take per stratum. A request asking for more is refused by the route schema.
 */
export function maxRuleIterations(): number {
  return positiveInteger('SQLIB_MAX_RULE_ITERATIONS', 1000);
}

/**
 * `SQLIB_ETL_NODE_MAX_ROWS`: the most rows an ETL node inside a query group
 * may read from its source before the node fails.
 */
export function etlNodeMaxRows(): number {
  return positiveInteger('SQLIB_ETL_NODE_MAX_ROWS', 1_000_000);
}
