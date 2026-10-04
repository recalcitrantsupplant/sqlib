import { getCacheCoordinator } from '../CacheCoordinatorProvider.js';
import { GraphValidationError } from './GraphValidationError.js';

/**
 * The variable names of an input or output tuple, in member position order.
 *
 * One implementation for the graph builder and the engine, which kept a copy
 * each and differed on what a broken tuple means. The difference is real and
 * is kept, but chosen by the caller rather than by which copy it happened to
 * call:
 *
 * - `strict` (building a graph): a missing tuple is a `TUPLE_MISSING`
 *   validation error and a member without a position is an error, because a
 *   graph that will not route its variables must not be accepted.
 * - lenient (running one): a missing tuple has no names and an unpositioned
 *   member sorts first. The engine asks about ports that may legitimately not
 *   be tuples (a start node's RDF inputs, a dynamic node's query-id port), and
 *   anything structural was refused when the graph was built.
 */
export function tupleVariableNames(
  tupleId: string,
  options: { strict?: boolean; kind?: 'QueryInputTuple' | 'QueryOutputTuple' } = {},
): string[] {
  const cache = getCacheCoordinator();
  const tuple = cache.get(tupleId) as { '@type'?: string; memberEntries?: string[] | null } | null;
  if (!tuple) {
    if (options.strict) {
      throw new GraphValidationError('TUPLE_MISSING', `Missing ${options.kind ?? 'tuple'} ${tupleId}`, 'tuple', tupleId);
    }
    return [];
  }
  const entries: Array<{ pos: number; name: string }> = [];
  for (const memberId of tuple.memberEntries ?? []) {
    const member = cache.get(memberId) as { variable?: string; position?: number } | null;
    if (!member?.variable) continue;
    const variable = cache.get(member.variable) as { variableName?: string } | null;
    if (typeof member.position !== 'number') {
      if (options.strict) throw new Error(`TupleMember ${memberId} missing position`);
    }
    entries.push({ pos: member.position ?? 0, name: variable?.variableName || '' });
  }
  entries.sort((a, b) => a.pos - b.pos);
  return entries.map(entry => entry.name);
}
