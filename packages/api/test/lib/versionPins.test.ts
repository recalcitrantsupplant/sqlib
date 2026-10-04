/**
 * Who pins a version — the list a refused delete has to be able to name.
 *
 * Deleting an entity whose versions are pinned by a saved version elsewhere is
 * refused, because the pin is what makes editing safe in the first place: a new
 * version is created, and the holder keeps the version it named. The refusal
 * is only usable if it says *who* is holding on, so that is what these cover.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { overrideCacheCoordinatorProvider } from '../../src/lib/CacheCoordinatorProvider.js';

const hoisted = vi.hoisted(() => ({
  entities: new Map<string, Record<string, unknown>>(),
}));

overrideCacheCoordinatorProvider({
  getCacheCoordinator: () => ({
    get: (id: string) => hoisted.entities.get(id) ?? null,
    list: (type: string) =>
      Array.from(hoisted.entities.values()).filter(entity => entity['@type'] === type),
  }),
});

const { pinsOn, describePins } = await import('../../src/lib/versionPins.js');

const GRAPH = 'urn:sqlib:data-graph:seed';
const V1 = 'urn:sqlib:data-graph-version:seed-1';
const V2 = 'urn:sqlib:data-graph-version:seed-2';

function put(entity: Record<string, unknown>) {
  hoisted.entities.set(entity.$id as string, entity);
}

beforeEach(() => {
  hoisted.entities.clear();
  put({ $id: GRAPH, '@type': 'DataGraph', name: 'Seed' });
  put({ $id: V1, '@type': 'DataGraphVersion', isPartOf: GRAPH, version: 1 });
  put({ $id: V2, '@type': 'DataGraphVersion', isPartOf: GRAPH, version: 2 });
});

/** An argument set whose one version pins `versionId`. */
function argumentSetPinning(id: string, name: string, versionId: string) {
  put({ $id: `${id}:binding`, '@type': 'ArgumentGraphBinding', position: 0, dataGraphVersion: versionId });
  put({ $id: id, '@type': 'ArgumentSet', name });
  put({
    $id: `${id}:v1`,
    '@type': 'ArgumentSetVersion',
    isPartOf: id,
    version: 1,
    graphBindings: [`${id}:binding`],
  });
}

describe('pinsOn', () => {
  it('finds nothing when nothing names any of the versions', () => {
    expect(pinsOn([V1, V2])).toEqual([]);
  });

  it('names the holder, the version holding the pin, and what it pins', () => {
    argumentSetPinning('urn:sqlib:argument-set:orders', 'Orders seed', V2);

    expect(pinsOn([V1, V2])).toEqual([
      {
        version: V2,
        heldBy: 'urn:sqlib:argument-set:orders:v1',
        heldByType: 'ArgumentSetVersion',
        holder: 'urn:sqlib:argument-set:orders',
        holderName: 'Orders seed',
      },
    ]);
  });

  /*
   * Any version counts. Deleting the entity deletes all of them, so a holder
   * naming v1 is broken by a delete just as surely as one naming the head.
   */
  it('counts a pin on any version, not only the current one', () => {
    argumentSetPinning('urn:sqlib:argument-set:old', 'Old set', V1);
    expect(pinsOn([V1, V2]).map(pin => pin.version)).toEqual([V1]);
  });

  it('ignores a pin on a version outside the set asked about', () => {
    argumentSetPinning('urn:sqlib:argument-set:elsewhere', 'Elsewhere', 'urn:sqlib:data-graph-version:other');
    expect(pinsOn([V1, V2])).toEqual([]);
  });

  it('finds a rule version named by a rule set version', () => {
    put({ $id: 'urn:rule-set', '@type': 'RuleSet', name: 'Closure' });
    put({ $id: 'urn:rule-set:v1', '@type': 'RuleSetVersion', isPartOf: 'urn:rule-set', hasRule: ['urn:rule:v1'] });
    expect(pinsOn(['urn:rule:v1'])).toMatchObject([{ heldByType: 'RuleSetVersion', holderName: 'Closure' }]);
  });

  it('finds a query version run by a group version node, but not one a dynamic node may choose', () => {
    put({ $id: 'urn:group', '@type': 'QueryGroup', name: 'Pipeline' });
    put({ $id: 'urn:node:1', '@type': 'QueryNode', queryId: 'urn:query:v1' });
    put({ $id: 'urn:node:2', '@type': 'DynamicQueryNode', queryId: 'urn:query:v2' });
    put({ $id: 'urn:group:v1', '@type': 'QueryGroupVersion', isPartOf: 'urn:group', executionNodes: ['urn:node:1', 'urn:node:2'] });
    expect(pinsOn(['urn:query:v1', 'urn:query:v2']).map(pin => pin.version)).toEqual(['urn:query:v1']);
  });

  it('finds a data graph version named by a test case', () => {
    put({ $id: 'urn:test', '@type': 'Test', name: 'Smoke' });
    put({ $id: 'urn:test:v1', '@type': 'TestVersion', isPartOf: 'urn:test' });
    put({ $id: 'urn:case', '@type': 'TestCase', isPartOf: 'urn:test:v1', dataGraphVersion: V1 });
    expect(pinsOn([V1])).toMatchObject([{ heldBy: 'urn:test:v1', heldByType: 'TestVersion', holderName: 'Smoke' }]);
  });
});

describe('describePins', () => {
  it('names the holders so the refusal can be acted on', () => {
    argumentSetPinning('urn:sqlib:argument-set:a', 'Orders seed', V1);
    argumentSetPinning('urn:sqlib:argument-set:b', 'Returns seed', V2);

    const sentence = describePins('data graph', pinsOn([V1, V2]));
    expect(sentence).toContain('Orders seed');
    expect(sentence).toContain('Returns seed');
    expect(sentence).toContain('argument sets');
  });

  it('says "argument set" when exactly one holds it', () => {
    argumentSetPinning('urn:sqlib:argument-set:a', 'Orders seed', V1);
    expect(describePins('data graph', pinsOn([V1]))).toContain('This data graph is pinned by argument set Orders seed');
  });
});
