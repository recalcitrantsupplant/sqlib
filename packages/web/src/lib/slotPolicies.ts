/**
 * What a query's VALUES parameter means when it receives no bound rows.
 *
 * The mode lives on the version's input tuple (`QueryInputTuple.whenEmpty`) and
 * changes only with a new version. Unset keeps the built-in reading: an omitted
 * slot runs open, zero rows match nothing. See
 * `docs/proposals/required-arguments.md`.
 */
import type { QueryVersionExpanded } from '@sparql-query-lib/contracts';

export type WhenEmptyMode = 'unconstrained' | 'propagateEmpty' | 'require';

/** Worded as the group edge editor words the same modes. */
export const WHEN_EMPTY_OPTIONS: ReadonlyArray<{ value: WhenEmptyMode | ''; label: string }> = [
  { value: '', label: 'Run without this filter (default)' },
  { value: 'propagateEmpty', label: 'Return no results' },
  { value: 'require', label: 'Fail the run' },
  { value: 'unconstrained', label: 'Always run without this filter' },
];

/** A slot's key: its variables, sorted, as slots and argument sets are matched. */
export function slotKey(vars: readonly string[]): string {
  return [...vars].sort().join(' ');
}

export function isWhenEmptyMode(value: unknown): value is WhenEmptyMode {
  return value === 'unconstrained' || value === 'propagateEmpty' || value === 'require';
}

/** The loaded version's modes, by {@link slotKey}. Slots with no mode are absent. */
export function slotPoliciesFromExpanded(
  expanded: Pick<QueryVersionExpanded, 'inputTuples' | 'tupleMembers' | 'inputs'> | null | undefined,
): Record<string, WhenEmptyMode> {
  if (!expanded) return {};
  const memberById = new Map((expanded.tupleMembers ?? []).map((member) => [member.id, member]));
  const inputById = new Map((expanded.inputs ?? []).map((input) => [input.id, input]));
  const policies: Record<string, WhenEmptyMode> = {};
  for (const tuple of expanded.inputTuples ?? []) {
    if (!isWhenEmptyMode(tuple.whenEmpty)) continue;
    const vars = (tuple.memberEntries ?? []).flatMap((memberId) => {
      const member = memberById.get(memberId);
      const name = member ? inputById.get(member.variable)?.variableName : undefined;
      return name ? [name] : [];
    });
    if (vars.length > 0) policies[slotKey(vars)] = tuple.whenEmpty;
  }
  return policies;
}
