import type { SlotPolicy } from '@sparql-query-lib/runtime';
import { getCacheCoordinator } from './CacheCoordinatorProvider.js';
import { WHEN_EMPTY_MODES, type WhenEmptyMode } from '../persistence/schemas/QueryEdgeSchema.js';

type VersionInputs = { inferredInputs?: readonly (string | null | undefined)[] | null } | null | undefined;

/**
 * The query author's empty-input policy for each of a version's parameter
 * slots, read from its input tuples (`QueryInputTuple.whenEmpty`).
 *
 * Every path that runs a stored version hands these to the parser, so a slot
 * marked `require` is refused the same way from `/execute`, a test, a
 * benchmark, a group node or an exported bundle. A tuple with no mode
 * contributes nothing, and the slot keeps the built-in reading. An unknown
 * value is ignored rather than failing the run: the writer refuses one, so a
 * stored one predates that check.
 *
 * `getEntity` is the lookup, so an export source that is not the live cache
 * can answer too.
 */
export function slotPoliciesOf(version: VersionInputs, getEntity: (id: string) => unknown): SlotPolicy[] {
  const policies: SlotPolicy[] = [];
  for (const tupleId of version?.inferredInputs ?? []) {
    if (!tupleId) continue;
    const tuple = getEntity(tupleId) as { whenEmpty?: string | null; memberEntries?: string[] | null } | null;
    const mode = tuple?.whenEmpty;
    if (!isWhenEmptyMode(mode)) continue;
    const members: Array<{ position: number; name: string }> = [];
    for (const memberId of tuple?.memberEntries ?? []) {
      const member = getEntity(memberId) as { variable?: string; position?: number } | null;
      const variable = member?.variable ? getEntity(member.variable) as { variableName?: string } | null : null;
      if (variable?.variableName) members.push({ position: member?.position ?? 0, name: variable.variableName });
    }
    members.sort((a, b) => a.position - b.position);
    if (members.length > 0) policies.push({ vars: members.map(member => member.name), whenEmpty: mode });
  }
  return policies;
}

/** {@link slotPoliciesOf} against the live cache. */
export function versionSlotPolicies(version: VersionInputs): SlotPolicy[] {
  if (!version?.inferredInputs?.length) return [];
  const cache = getCacheCoordinator();
  return slotPoliciesOf(version, id => cache.get(id));
}

export function isWhenEmptyMode(value: unknown): value is WhenEmptyMode {
  return typeof value === 'string' && (WHEN_EMPTY_MODES as readonly string[]).includes(value);
}
