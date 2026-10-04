/**
 * Who pins a version, and therefore what deleting it would break.
 *
 * A frozen version that names another version — a rule set version naming its
 * rule versions, a group version's node naming a query version, an argument
 * set version's graph binding naming a data graph version, a test version
 * naming its subject version or a case's argument set version — holds a pin
 * on it. The holder is immutable, so the pin cannot be repointed: deleting
 * what it names would leave a saved snapshot naming content that is gone,
 * discovered at its next run. So a delete that would remove a pinned version
 * is **refused**, with the list of who is holding on, and the generic
 * versioned-entity router applies that to every noun
 * (`routes/versionedEntity.ts`).
 *
 * This generalises what `dataGraphPins.ts` did for data graphs alone, which
 * was the first entity to get the rule; its doc said "this is the rule any
 * pinned entity needs".
 *
 * The scan walks holders rather than the pinned versions because the pin
 * points that way: a version does not know who names it, and a back-reference
 * that could go stale is worse than a scan — a stale one refuses a delete
 * nobody is holding.
 */
import { getCacheCoordinator } from './CacheCoordinatorProvider.js';

/** One holder of a pin. */
export interface VersionPin {
  /** The pinned version. */
  version: string;
  /** The frozen version that names it. */
  heldBy: string;
  /** What kind of version that is, e.g. `ArgumentSetVersion`. */
  heldByType: HolderType;
  /** The stable entity `heldBy` is a version of. */
  holder: string;
  /** Its name, so the refusal can be read. */
  holderName: string;
}

type HolderType = 'ArgumentSetVersion' | 'RuleSetVersion' | 'QueryGroupVersion' | 'TestVersion';

type Entity = Record<string, unknown> & { $id: string; '@type'?: string };

const HOLDER_LABELS: Record<HolderType, [singular: string, plural: string]> = {
  ArgumentSetVersion: ['argument set', 'argument sets'],
  RuleSetVersion: ['rule set', 'rule sets'],
  QueryGroupVersion: ['query group', 'query groups'],
  TestVersion: ['test', 'tests'],
};

function idsOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
  return typeof value === 'string' && value ? [value] : [];
}

/** Every (holder version, pinned id) pair in the deployment. */
function* holdings(): Generator<{ heldBy: Entity; heldByType: HolderType; pinned: string }> {
  const cache = getCacheCoordinator();
  const get = (id: string) => cache.get(id) as Entity | null;
  const list = (type: string) => cache.list(type as never) as Entity[];

  for (const version of list('RuleSetVersion')) {
    for (const pinned of [...idsOf(version.hasRule), ...idsOf(version.hasDataBlock)]) {
      yield { heldBy: version, heldByType: 'RuleSetVersion', pinned };
    }
  }

  for (const version of list('QueryGroupVersion')) {
    for (const nodeId of idsOf(version.executionNodes)) {
      const node = get(nodeId);
      // A dynamic node's `queryId` is chosen at run time, so it pins nothing.
      if (node?.['@type'] === 'QueryNode') {
        for (const pinned of idsOf(node.queryId)) yield { heldBy: version, heldByType: 'QueryGroupVersion', pinned };
      }
      if (node?.['@type'] === 'RuleSetNode') {
        for (const pinned of idsOf(node.ruleSetVersion)) yield { heldBy: version, heldByType: 'QueryGroupVersion', pinned };
      }
    }
  }

  for (const version of list('ArgumentSetVersion')) {
    for (const bindingId of idsOf(version.graphBindings)) {
      for (const pinned of idsOf(get(bindingId)?.dataGraphVersion)) {
        yield { heldBy: version, heldByType: 'ArgumentSetVersion', pinned };
      }
    }
    for (const bindingId of idsOf(version.tupleBindings)) {
      for (const pinned of idsOf(get(bindingId)?.tupleSetVersions)) {
        yield { heldBy: version, heldByType: 'ArgumentSetVersion', pinned };
      }
    }
  }

  for (const version of list('TestVersion')) {
    for (const pinned of idsOf(version.subjectVersion)) yield { heldBy: version, heldByType: 'TestVersion', pinned };
  }
  for (const testCase of list('TestCase')) {
    const version = get(String(testCase.isPartOf ?? ''));
    if (!version) continue;
    for (const pinned of [...idsOf(testCase.dataGraphVersion), ...idsOf(testCase.argumentSetVersion)]) {
      yield { heldBy: version, heldByType: 'TestVersion', pinned };
    }
  }
  for (const graph of list('TestCaseDataGraph')) {
    const testCase = get(String(graph.isPartOf ?? ''));
    const version = testCase ? get(String(testCase.isPartOf ?? '')) : null;
    if (!version) continue;
    for (const pinned of idsOf(graph.dataGraphVersion)) yield { heldBy: version, heldByType: 'TestVersion', pinned };
  }
}

/**
 * Every pin on any of `versionIds`, one per holder version and pinned version.
 *
 * Any version counts, not only the current one: deleting an entity deletes all
 * of its versions, so a holder naming v1 is broken as surely as one naming the
 * head.
 */
export function pinsOn(versionIds: Iterable<string>): VersionPin[] {
  const targets = new Set(versionIds);
  if (targets.size === 0) return [];

  const cache = getCacheCoordinator();
  const seen = new Set<string>();
  const pins: VersionPin[] = [];
  for (const { heldBy, heldByType, pinned } of holdings()) {
    if (!targets.has(pinned)) continue;
    const key = `${heldBy.$id} ${pinned}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const holder = String(heldBy.isPartOf ?? heldBy.$id);
    const holderEntity = cache.get(holder) as { name?: string } | null;
    pins.push({
      version: pinned,
      heldBy: heldBy.$id,
      heldByType,
      holder,
      holderName: holderEntity?.name ?? holder,
    });
  }
  return pins;
}

/**
 * The refusal's sentence: who is holding on, named.
 *
 * `subject` is what is being deleted, as the caller would say it: "data graph",
 * "rule version".
 */
export function describePins(subject: string, pins: VersionPin[]): string {
  const byType = new Map<HolderType, string[]>();
  for (const pin of pins) {
    const names = byType.get(pin.heldByType) ?? [];
    if (!names.includes(pin.holderName)) names.push(pin.holderName);
    byType.set(pin.heldByType, names);
  }

  const parts: string[] = [];
  let shown = 0;
  let hidden = 0;
  for (const [type, names] of byType) {
    const room = Math.max(0, 5 - shown);
    const listed = names.slice(0, room);
    hidden += names.length - listed.length;
    shown += listed.length;
    if (listed.length === 0) continue;
    const [singular, plural] = HOLDER_LABELS[type];
    parts.push(`${names.length === 1 ? singular : plural} ${listed.join(', ')}`);
  }
  const rest = hidden > 0 ? `, and ${hidden} more` : '';
  return `This ${subject} is pinned by ${parts.join('; ')}${rest}. `
    + 'Saved versions are immutable, so the pin cannot be repointed: remove it there, or delete those first.';
}
