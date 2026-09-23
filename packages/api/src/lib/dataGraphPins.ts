/**
 * Who pins a data graph, and therefore what deleting it would break.
 *
 * A graph binding on a saved argument set version names a `DataGraphVersion`,
 * and a saved version is immutable — that pin is the whole reason editing the
 * graph is safe (a new version is created; the set keeps its pin and its run
 * does not change). The cost of that safety is this: a pinned graph cannot be
 * deleted out from under the sets that name it, so the delete is **refused**
 * with the list of who is holding on.
 *
 * This is the rule any pinned entity needs. Graphs get there first only because
 * they are the first entity minted from a call.
 */
import { getCacheCoordinator } from './CacheCoordinatorProvider.js';
import type { LdkitDataGraphVersion } from '../persistence/schemas/DataGraphVersionSchema.js';
import type { LdkitArgumentGraphBinding } from '../persistence/schemas/ArgumentGraphBindingSchema.js';
import type { LdkitArgumentSetVersion } from '../persistence/schemas/ArgumentSetVersionSchema.js';
import type { LdkitArgumentSet } from '../persistence/schemas/ArgumentSetSchema.js';

/** One holder of a pin: the set, named, so the refusal can be read. */
export interface DataGraphPin {
  argumentSetId: string;
  argumentSetName: string;
  /** The version of the set that pins it — one set may pin across several. */
  argumentSetVersionId: string;
  dataGraphVersionId: string;
}

function toArray(value: string[] | string | null | undefined): string[] {
  if (Array.isArray(value)) return value;
  return typeof value === 'string' ? [value] : [];
}

/**
 * Every argument set version pinning any version of `dataGraphId`.
 *
 * Walks argument set versions rather than data graph versions because the pin
 * points that way: a version does not know who names it, and there is no
 * back-reference to keep in step (one that could go stale is worse than a scan,
 * since a stale one refuses a delete nobody is holding).
 */
export function pinsOnDataGraph(dataGraphId: string): DataGraphPin[] {
  const cacheCoordinator = getCacheCoordinator();

  const versionIds = new Set(
    (cacheCoordinator.list('DataGraphVersion') as LdkitDataGraphVersion[])
      .filter(version => version.isPartOf === dataGraphId)
      .map(version => version.$id),
  );
  if (versionIds.size === 0) return [];

  const pins: DataGraphPin[] = [];
  for (const setVersion of cacheCoordinator.list('ArgumentSetVersion') as LdkitArgumentSetVersion[]) {
    for (const bindingId of toArray(setVersion.graphBindings)) {
      const binding = cacheCoordinator.get(bindingId) as LdkitArgumentGraphBinding | null;
      const pinned = binding?.dataGraphVersion ?? null;
      if (!pinned || !versionIds.has(pinned)) continue;
      const set = cacheCoordinator.get(setVersion.isPartOf) as LdkitArgumentSet | null;
      pins.push({
        argumentSetId: setVersion.isPartOf,
        argumentSetName: set?.name ?? setVersion.isPartOf,
        argumentSetVersionId: setVersion.$id,
        dataGraphVersionId: pinned,
      });
    }
  }
  return pins;
}

/** The refusal's sentence: who is holding on, named, newest wording first. */
export function describePins(pins: DataGraphPin[]): string {
  const names = [...new Set(pins.map(pin => pin.argumentSetName))];
  const listed = names.slice(0, 5).join(', ');
  const rest = names.length > 5 ? `, and ${names.length - 5} more` : '';
  return `This data graph is pinned by ${names.length === 1 ? 'argument set' : 'argument sets'} ${listed}${rest}. `
    + 'Saved versions are immutable, so the pin cannot be repointed: unlink it there, or delete those sets first.';
}
