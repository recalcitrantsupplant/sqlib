/**
 * Browser defaults: what the web app selects when a callable opens.
 *
 * A query and a query group may name a default argument set; a query group and
 * a rule set may name a default data graph for each data graph input. The web
 * app applies them. `/execute`, rule set execute, tests, benchmarks and MCP
 * never read them: an empty call already means "no arguments", and a default
 * someone changes in the UI must not change what a script computes. A caller
 * that wants the default reads it here and sends it.
 *
 * Written only through `PUT /:id/browser-defaults`, which is why the pointer
 * properties are `@readOnly` to the generic `PUT`: this is where the
 * same-library rule is checked. See `docs/proposals/browser-defaults.md`.
 */
import { getCacheCoordinator } from './CacheCoordinatorProvider.js';
import { mintId } from './id.js';
import { orderByPosition } from '@sparql-query-lib/types';
import { resolveOwningLibrary } from '../auth/enforce.js';
import { toLdkit } from '../persistence/utils/id-adapter.js';
import type { LdkitBrowserDefaultDataGraph } from '../persistence/schemas/BrowserDefaultDataGraphSchema.js';

/** The entity kinds that carry browser defaults. */
export type BrowserDefaultsOwnerType = 'Query' | 'QueryGroup' | 'RuleSet';

/** The wire shape, for read and write alike. */
export interface BrowserDefaults {
  argumentSet: string | null;
  /** By data graph input: entry N is the default for input N, or `null`. */
  dataGraphs: Array<string | null>;
}

/** A body the caller has to change; the route answers 400. */
export class BrowserDefaultsError extends Error {}

/** What each owner kind takes. A query's store is its backend; a rule set takes one graph. */
const ACCEPTS: Record<BrowserDefaultsOwnerType, { argumentSet: boolean; maxDataGraphs: number }> = {
  Query: { argumentSet: true, maxDataGraphs: 0 },
  QueryGroup: { argumentSet: true, maxDataGraphs: Number.POSITIVE_INFINITY },
  RuleSet: { argumentSet: false, maxDataGraphs: 1 },
};

interface OwnerRecord {
  $id: string;
  '@type'?: string;
  browserDefaultArgumentSet?: string | null;
  browserDefaultDataGraphs?: string[] | string | null;
}

function toArray(value: string[] | string | null | undefined): string[] {
  if (Array.isArray(value)) return value;
  return typeof value === 'string' && value ? [value] : [];
}

function childrenOf(owner: OwnerRecord): LdkitBrowserDefaultDataGraph[] {
  const cache = getCacheCoordinator();
  return orderByPosition(toArray(owner.browserDefaultDataGraphs)
    .map(id => cache.get(id) as LdkitBrowserDefaultDataGraph | null)
    .filter((child): child is LdkitBrowserDefaultDataGraph => !!child && typeof child.dataGraph === 'string'));
}

/** The defaults an owner carries, with holes for inputs that have none. */
export function readBrowserDefaults(owner: OwnerRecord): BrowserDefaults {
  const dataGraphs: Array<string | null> = [];
  for (const child of childrenOf(owner)) {
    const position = Number.isInteger(child.position) && child.position >= 0 ? child.position : dataGraphs.length;
    while (dataGraphs.length < position) dataGraphs.push(null);
    dataGraphs[position] = child.dataGraph;
  }
  return {
    argumentSet: owner.browserDefaultArgumentSet ?? null,
    dataGraphs,
  };
}

/** Normalise a body: `undefined` fields clear, trailing holes go. */
function normalise(input: Partial<BrowserDefaults>): BrowserDefaults {
  const dataGraphs = [...(input.dataGraphs ?? [])].map(entry => (typeof entry === 'string' && entry.trim() ? entry.trim() : null));
  while (dataGraphs.length && dataGraphs[dataGraphs.length - 1] === null) dataGraphs.pop();
  const argumentSet = typeof input.argumentSet === 'string' && input.argumentSet.trim() ? input.argumentSet.trim() : null;
  return { argumentSet, dataGraphs };
}

/**
 * Check a body against the owner, and return it normalised.
 *
 * Every target must exist, be of a type the slot takes, and belong to the
 * owner's library. Same-library also settles read access: the route guard has
 * already required Write on that library.
 */
export function validateBrowserDefaults(
  ownerType: BrowserDefaultsOwnerType,
  owner: OwnerRecord,
  input: Partial<BrowserDefaults>,
): BrowserDefaults {
  const body = normalise(input);
  const accepts = ACCEPTS[ownerType];
  const cache = getCacheCoordinator();
  const library = resolveOwningLibrary(owner);
  if (!library) {
    throw new BrowserDefaultsError(`${ownerType} ${owner.$id} belongs to no library`);
  }

  const check = (id: string, types: readonly string[], what: string) => {
    const target = cache.get(id) as { '@type'?: string } | null;
    if (!target || !types.includes(target['@type'] ?? '')) {
      throw new BrowserDefaultsError(`${what} ${id} is not a ${types.join(' or ')}`);
    }
    if (resolveOwningLibrary(target) !== library) {
      throw new BrowserDefaultsError(`${what} ${id} is not in this ${ownerType}'s library`);
    }
  };

  if (body.argumentSet) {
    if (!accepts.argumentSet) {
      throw new BrowserDefaultsError(`A ${ownerType} takes no argument set`);
    }
    check(body.argumentSet, ['ArgumentSet', 'ArgumentSetVersion'], 'Argument set');
  }

  if (body.dataGraphs.length > accepts.maxDataGraphs) {
    throw new BrowserDefaultsError(accepts.maxDataGraphs === 0
      ? `A ${ownerType} takes no data graph: its store is its backend`
      : `A ${ownerType} takes at most ${accepts.maxDataGraphs} data graph`);
  }
  for (const id of body.dataGraphs) {
    if (id) check(id, ['DataGraph', 'DataGraphVersion'], 'Data graph');
  }

  return body;
}

async function deleteChildren(owner: OwnerRecord): Promise<void> {
  const cache = getCacheCoordinator();
  for (const id of toArray(owner.browserDefaultDataGraphs)) {
    if (cache.get(id)) await cache.delete('BrowserDefaultDataGraph', id);
  }
}

/** Replace an owner's defaults with a body `validateBrowserDefaults` returned. */
export async function writeBrowserDefaults(
  ownerType: BrowserDefaultsOwnerType,
  owner: OwnerRecord,
  body: BrowserDefaults,
): Promise<BrowserDefaults> {
  const cache = getCacheCoordinator();
  await deleteChildren(owner);

  const childIds: string[] = [];
  for (const [position, dataGraph] of body.dataGraphs.entries()) {
    if (!dataGraph) continue;
    const id = mintId('browserDefaultDataGraph');
    await cache.create('BrowserDefaultDataGraph', toLdkit({
      $id: id,
      '@type': 'BrowserDefaultDataGraph',
      isPartOf: owner.$id,
      position,
      dataGraph,
    }));
    childIds.push(id);
  }

  const dataGraphs = childIds.length ? childIds : null;
  let updated: OwnerRecord | null;
  switch (ownerType) {
    case 'Query':
      updated = await cache.update('Query', owner.$id, { browserDefaultArgumentSet: body.argumentSet });
      break;
    case 'QueryGroup':
      updated = await cache.update('QueryGroup', owner.$id, {
        browserDefaultArgumentSet: body.argumentSet,
        browserDefaultDataGraphs: dataGraphs,
      });
      break;
    case 'RuleSet':
      updated = await cache.update('RuleSet', owner.$id, { browserDefaultDataGraphs: dataGraphs });
      break;
  }
  if (!updated) throw new Error(`${ownerType} ${owner.$id} not found`);
  return readBrowserDefaults(updated);
}

/** Delete an owner's children, on the owner's delete. */
export async function deleteBrowserDefaultsOf(owner: OwnerRecord | null): Promise<void> {
  if (owner) await deleteChildren(owner);
}

/**
 * Drop every default that names one of `ids`, on the target's delete.
 *
 * Cleared rather than refused: a default is a starting selection, not a pin,
 * so losing one costs a pick and breaks no run.
 */
export async function clearBrowserDefaultsNaming(ids: ReadonlySet<string>): Promise<void> {
  if (ids.size === 0) return;
  const cache = getCacheCoordinator();

  const names = (owner: OwnerRecord) => !!owner.browserDefaultArgumentSet && ids.has(owner.browserDefaultArgumentSet);
  for (const owner of cache.list('Query') as OwnerRecord[]) {
    if (names(owner)) await cache.update('Query', owner.$id, { browserDefaultArgumentSet: null });
  }
  for (const owner of cache.list('QueryGroup') as OwnerRecord[]) {
    if (names(owner)) await cache.update('QueryGroup', owner.$id, { browserDefaultArgumentSet: null });
  }

  for (const child of cache.list('BrowserDefaultDataGraph') as LdkitBrowserDefaultDataGraph[]) {
    if (!ids.has(child.dataGraph)) continue;
    const owner = cache.get(child.isPartOf) as OwnerRecord | null;
    await cache.delete('BrowserDefaultDataGraph', child.$id);
    if (!owner) continue;
    const remaining = toArray(owner.browserDefaultDataGraphs).filter(id => id !== child.$id);
    const browserDefaultDataGraphs = remaining.length ? remaining : null;
    if (owner['@type'] === 'QueryGroup') {
      await cache.update('QueryGroup', owner.$id, { browserDefaultDataGraphs });
    } else if (owner['@type'] === 'RuleSet') {
      await cache.update('RuleSet', owner.$id, { browserDefaultDataGraphs });
    }
  }
}

/**
 * Clear an owner's defaults when an update moved it to another library.
 *
 * Its defaults name entities in the library it left, and a default must be in
 * the owner's own library. Cleared rather than kept: the alternative is a
 * default that a fresh `PUT` of the same value would refuse.
 *
 * Returns the owner as it now stands when it cleared anything, else `null`.
 */
export async function clearBrowserDefaultsIfMoved<T extends OwnerRecord>(
  ownerType: BrowserDefaultsOwnerType,
  before: OwnerRecord,
  after: T,
): Promise<T | null> {
  const current = readBrowserDefaults(after);
  if (!current.argumentSet && current.dataGraphs.length === 0) return null;
  if (resolveOwningLibrary(before) === resolveOwningLibrary(after)) return null;
  await writeBrowserDefaults(ownerType, after, { argumentSet: null, dataGraphs: [] });
  return getCacheCoordinator().get(after.$id) as T | null;
}
