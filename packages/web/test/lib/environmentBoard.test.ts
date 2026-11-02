import { describe, expect, it } from 'vitest';
import {
  buildBoard,
  catchUpTarget,
  countBoard,
  filterBoard,
  holdsCount,
  indexPointers,
  type PromotableEntity,
} from '@/lib/environmentBoard';

const query = (id: string, current: number | null, extra: Partial<PromotableEntity> = {}): PromotableEntity => ({
  id,
  name: id,
  kind: 'Query',
  currentVersion: current === null ? null : `${id}-v${current}`,
  currentVersionNumber: current,
  groupOnly: false,
  ...extra,
});

const pointer = (entity: string, n: number) => ({
  entity,
  entityType: 'Query' as const,
  entityName: entity,
  version: `${entity}-v${n}`,
  versionNumber: n,
});

const environments = [{ id: 'dev', name: 'dev' }, { id: 'prod', name: 'prod' }];

describe('environmentBoard', () => {
  const rows = buildBoard(
    [query('a', 3), query('b', 2), query('c', 1)],
    environments,
    indexPointers({ dev: [pointer('a', 3), pointer('b', 2)], prod: [pointer('a', 1), pointer('b', 2)] }),
  );

  it('puts latest first and one cell per environment', () => {
    expect(rows[0].cells.map((c) => c.versionNumber)).toEqual([3, 3, 1]);
  });

  it('marks a cell behind the column to its left', () => {
    expect(rows[0].cells.map((c) => c.state)).toEqual(['current', 'current', 'behind']);
    expect(rows[1].cells.map((c) => c.state)).toEqual(['current', 'current', 'current']);
  });

  it('marks a cell with no pointer missing', () => {
    expect(rows[2].cells.map((c) => c.state)).toEqual(['current', 'missing', 'missing']);
  });

  it('filters by behind, by missing in the last environment, and by name', () => {
    expect(filterBoard(rows, 'behind').map((r) => r.entity.id)).toEqual(['a']);
    expect(filterBoard(rows, 'missing').map((r) => r.entity.id)).toEqual(['c']);
    expect(filterBoard(rows, 'all', 'B').map((r) => r.entity.id)).toEqual(['b']);
    expect(countBoard(rows)).toEqual({ all: 3, behind: 1, missing: 1 });
  });

  it('counts what an environment holds', () => {
    expect(holdsCount(rows, 'dev')).toBe(2);
    expect(holdsCount(rows, 'prod')).toBe(2);
  });

  it('offers the version to the left as the quick move, only when it differs', () => {
    expect(catchUpTarget(rows[0], 2)?.versionNumber).toBe(3);
    expect(catchUpTarget(rows[1], 2)).toBeNull();
    expect(catchUpTarget(rows[2], 1)?.versionNumber).toBe(1);
    expect(catchUpTarget(rows[0], 0)).toBeNull();
  });
});
