/**
 * The library Activity feed, from the records it reads (`lib/libraryActivity.ts`).
 */
import { describe, it, expect } from 'vitest';
import { libraryActivity, type Entity } from '../../src/lib/libraryActivity.js';

const LIB = 'urn:lib';
const ALICE = 'urn:sqlib:principal:user:alice';
const BO = 'urn:sqlib:principal:user:bo';

function sourceOf(entities: Entity[], readable: (item: Entity) => boolean = () => true) {
  const byId = new Map(entities.map((entity) => [entity.$id, entity]));
  return {
    get: (id: string) => byId.get(id) ?? null,
    list: (type: string) => entities.filter((entity) => entity['@type'] === type),
    readable: <T extends Entity>(items: T[]) => items.filter(readable),
  };
}

const library: Entity = { $id: LIB, '@type': 'Library', name: 'Lib' };
const query: Entity = {
  $id: 'urn:q', '@type': 'Query', name: 'heights', isPartOf: [LIB],
  dateCreated: '2026-11-01T10:00:00.000Z', createdBy: ALICE,
  dateModified: '2026-11-03T09:00:00.500Z', modifiedBy: ALICE,
};
const v1: Entity = { $id: 'urn:q:v1', '@type': 'QueryVersion', isPartOf: 'urn:q', version: 1, dateCreated: '2026-11-01T10:00:01.000Z', createdBy: ALICE };
const v2: Entity = { $id: 'urn:q:v2', '@type': 'QueryVersion', isPartOf: 'urn:q', version: 2, dateCreated: '2026-11-03T09:00:00.000Z', createdBy: BO };

describe('libraryActivity', () => {
  it('reads a version save as one item, and the parent edit it caused as none', () => {
    const { items } = libraryActivity(sourceOf([library, query, v1, v2]), { library: LIB, limit: 50 });
    expect(items.map((item) => [item.kind, item.actor, item.versionNumber ?? null])).toEqual([
      ['saved', BO, 2],
      ['saved', ALICE, 1],
      ['created', ALICE, null],
    ]);
  });

  it('lists an edit made apart from any version save, with its editor', () => {
    const edited = { ...query, dateModified: '2026-11-05T12:00:00.000Z', modifiedBy: BO };
    const { items } = libraryActivity(sourceOf([library, edited, v1, v2]), { library: LIB, limit: 50, kind: 'edited' });
    expect(items.map((item) => [item.kind, item.actor])).toEqual([['edited', BO], ['saved', BO], ['saved', ALICE]]);
  });

  it('filters by actor, and leaves out what the caller may not read and other libraries', () => {
    const other: Entity = { ...query, $id: 'urn:other', isPartOf: ['urn:lib2'] };
    const secret: Entity = { ...query, $id: 'urn:secret', name: 'secret' };
    const { items } = libraryActivity(
      sourceOf([library, query, v1, v2, other, secret], (item) => item.$id !== 'urn:secret'),
      { library: LIB, limit: 50, actor: BO },
    );
    expect(items.map((item) => [item.entity, item.kind])).toEqual([['urn:q', 'saved']]);
  });
});

describe('libraryActivity and environments', () => {
  it('reads an environment edit made by a pointer move as the move alone', () => {
    const env: Entity = {
      $id: 'urn:env', '@type': 'Environment', name: 'prod', isPartOf: LIB,
      dateCreated: '2026-11-01T10:00:00.000Z', dateModified: '2026-11-04T10:00:00.100Z',
    };
    const move: Entity = {
      $id: 'urn:move', '@type': 'PointerMove', isPartOf: 'urn:env', movedEntity: 'urn:q', toVersion: 'urn:q:v2',
      dateCreated: '2026-11-04T10:00:00.200Z', createdBy: BO,
    };
    const { items } = libraryActivity(sourceOf([library, query, v1, v2, env, move]), { library: LIB, limit: 50 });
    expect(items.filter((item) => item.entity === 'urn:env').map((item) => item.kind)).toEqual(['created']);
    expect(items[0]).toMatchObject({ kind: 'moved', actor: BO, environmentName: 'prod', toVersionNumber: 2 });
  });
});
