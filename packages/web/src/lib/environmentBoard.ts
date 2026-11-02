/**
 * The pointer board on the Library page: one row per query, query group and
 * rule set, one column per environment, with `latest` first.
 *
 * Pure, so the rules that colour a cell are tested without a page. A cell is
 * `behind` when it holds an older version than the column to its left; the
 * leftmost environment compares with `latest`. A cell with no pointer is
 * `missing`: a run that names that environment is refused.
 */
import type { EnvironmentPointer } from '@/composables/useApiClient';

export type PromotableKind = 'Query' | 'QueryGroup' | 'RuleSet';

export interface PromotableEntity {
  id: string;
  name: string;
  kind: PromotableKind;
  currentVersion: string | null;
  currentVersionNumber: number | null;
  groupOnly: boolean;
}

export interface BoardEnvironment {
  id: string;
  name: string;
}

export interface BoardCell {
  /** The environment id, or null for `latest`. */
  environment: string | null;
  version: string | null;
  versionNumber: number | null;
  state: 'current' | 'behind' | 'missing';
}

export interface BoardRow {
  entity: PromotableEntity;
  /** `latest` first, then each environment in chain order. */
  cells: BoardCell[];
}

export type BoardFilter = 'all' | 'behind' | 'missing';

/** The pointers of each environment, keyed by environment id, then by entity id. */
export type PointerIndex = Map<string, Map<string, EnvironmentPointer>>;

export function indexPointers(byEnvironment: Record<string, EnvironmentPointer[]>): PointerIndex {
  const index: PointerIndex = new Map();
  for (const [environment, pointers] of Object.entries(byEnvironment)) {
    index.set(environment, new Map(pointers.map((pointer) => [pointer.entity, pointer])));
  }
  return index;
}

export function buildBoard(
  entities: readonly PromotableEntity[],
  environments: readonly BoardEnvironment[],
  pointers: PointerIndex,
): BoardRow[] {
  return entities.map((entity) => {
    const cells: BoardCell[] = [{
      environment: null,
      version: entity.currentVersion,
      versionNumber: entity.currentVersionNumber,
      state: entity.currentVersion ? 'current' : 'missing',
    }];
    for (const environment of environments) {
      const pointer = pointers.get(environment.id)?.get(entity.id) ?? null;
      const left = cells[cells.length - 1];
      const number = pointer?.versionNumber ?? null;
      const behind = number !== null && left.versionNumber !== null && number < left.versionNumber;
      cells.push({
        environment: environment.id,
        version: pointer?.version ?? null,
        versionNumber: number,
        state: !pointer ? 'missing' : behind ? 'behind' : 'current',
      });
    }
    return { entity, cells };
  });
}

/** The rows a filter keeps. `missing` means "not in the last environment of the chain". */
export function filterBoard(rows: readonly BoardRow[], filter: BoardFilter, text = ''): BoardRow[] {
  const needle = text.trim().toLowerCase();
  return rows.filter((row) => {
    if (needle && !row.entity.name.toLowerCase().includes(needle)) return false;
    if (filter === 'behind') return row.cells.some((cell) => cell.state === 'behind');
    if (filter === 'missing') return row.cells.length > 1 && row.cells[row.cells.length - 1].state === 'missing';
    return true;
  });
}

export function countBoard(rows: readonly BoardRow[]): Record<BoardFilter, number> {
  return {
    all: rows.length,
    behind: filterBoard(rows, 'behind').length,
    missing: filterBoard(rows, 'missing').length,
  };
}

/** How many entities an environment holds, out of how many can be promoted. */
export function holdsCount(rows: readonly BoardRow[], environment: string): number {
  return rows.filter((row) => row.cells.some((cell) => cell.environment === environment && cell.version)).length;
}

/**
 * The version the cell to the left holds, when moving this cell to it is a
 * real move: the quick action in a cell's menu ("Move prod to v4").
 */
export function catchUpTarget(row: BoardRow, column: number): BoardCell | null {
  if (column < 1) return null;
  const left = row.cells[column - 1];
  const cell = row.cells[column];
  if (!left?.version || left.version === cell?.version) return null;
  return left;
}

export const KIND_LABELS: Record<PromotableKind, string> = {
  Query: 'query',
  QueryGroup: 'group',
  RuleSet: 'rule set',
};

/** The column of an environment on the board: `latest` is 0. */
export function columnOf(rows: readonly BoardRow[], environment: string): number {
  return rows[0]?.cells.findIndex((cell) => cell.environment === environment) ?? -1;
}

/**
 * One environment against the one before it in the chain: the rows a move
 * would change, and the rest. Group-only queries move with their group, so
 * they are in neither list.
 */
export function environmentView(rows: readonly BoardRow[], column: number): { differing: BoardRow[]; inStep: BoardRow[] } {
  const differing: BoardRow[] = [];
  const inStep: BoardRow[] = [];
  for (const row of rows) {
    if (row.entity.groupOnly) continue;
    (catchUpTarget(row, column) ? differing : inStep).push(row);
  }
  return { differing, inStep };
}

/** The Library page's selection for the whole board rather than one environment. */
export const COMPARE_ALL = 'compare';

/** One pointer move, with `from` the version the screen showed (compare-and-set). */
export interface PointerMove {
  environment: string;
  entity: PromotableEntity;
  version: string | null;
  from: string | null;
}
