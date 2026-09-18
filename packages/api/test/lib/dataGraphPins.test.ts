/**
 * Who pins a data graph — the list a refused delete has to be able to name.
 *
 * Deleting a graph whose versions are pinned is refused, because the pin is
 * what makes editing the graph safe in the first place: a new version is
 * created, and the argument set keeps the version it named. The refusal is only
 * usable if it says *who* is holding on, so that is what these cover.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  entities: new Map<string, Record<string, unknown>>(),
}));

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => ({
    get: (id: string) => hoisted.entities.get(id) ?? null,
    list: (type: string) =>
      Array.from(hoisted.entities.values()).filter(entity => entity['@type'] === type),
  }),
}));

const { pinsOnDataGraph, describePins } = await import('../../src/lib/dataGraphPins.js');

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

describe('pinsOnDataGraph', () => {
  it('finds nothing when no set names any of its versions', () => {
    expect(pinsOnDataGraph(GRAPH)).toEqual([]);
  });

  it('names the set holding the pin, and which version it holds', () => {
    argumentSetPinning('urn:sqlib:argument-set:orders', 'Orders seed', V2);

    expect(pinsOnDataGraph(GRAPH)).toEqual([
      {
        argumentSetId: 'urn:sqlib:argument-set:orders',
        argumentSetName: 'Orders seed',
        argumentSetVersionId: 'urn:sqlib:argument-set:orders:v1',
        dataGraphVersionId: V2,
      },
    ]);
  });

  /*
   * Any version counts. Deleting the graph deletes all of them, so a set
   * holding v1 is broken by a delete just as surely as one holding the head.
   */
  it('counts a pin on any version, not only the current one', () => {
    argumentSetPinning('urn:sqlib:argument-set:old', 'Old set', V1);
    expect(pinsOnDataGraph(GRAPH).map(pin => pin.dataGraphVersionId)).toEqual([V1]);
  });

  it('ignores a binding pinning some other graph', () => {
    put({ $id: 'urn:sqlib:data-graph-version:other', '@type': 'DataGraphVersion', isPartOf: 'urn:sqlib:data-graph:other' });
    argumentSetPinning('urn:sqlib:argument-set:elsewhere', 'Elsewhere', 'urn:sqlib:data-graph-version:other');
    expect(pinsOnDataGraph(GRAPH)).toEqual([]);
  });
});

describe('describePins', () => {
  it('names the sets so the refusal can be acted on', () => {
    argumentSetPinning('urn:sqlib:argument-set:a', 'Orders seed', V1);
    argumentSetPinning('urn:sqlib:argument-set:b', 'Returns seed', V2);

    const sentence = describePins(pinsOnDataGraph(GRAPH));
    expect(sentence).toContain('Orders seed');
    expect(sentence).toContain('Returns seed');
    expect(sentence).toContain('argument sets');
  });

  it('says "argument set" when exactly one holds it', () => {
    argumentSetPinning('urn:sqlib:argument-set:a', 'Orders seed', V1);
    expect(describePins(pinsOnDataGraph(GRAPH))).toContain('pinned by argument set Orders seed');
  });
});
