/**
 * Argument sets on a callable that has not been saved yet.
 *
 * A scratch query or group has no server identity — its work area holds `''`
 * where the entity id would be — and the sets were keyed on that id, so
 * `createScratch` returned null and the switcher's "New scratch set" did
 * nothing at all: no request, no error, no set. Values could only be entered
 * on a query that had already been saved, which on a read-only deployment is
 * no query at all, since nothing there can be saved.
 *
 * So local records key on the scratch id while it is the only id there is, and
 * move to the server id when the callable is saved. What must not change: the
 * server still only ever hears about ids it minted.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ref, nextTick } from 'vue';

const api = vi.hoisted(() => ({
  listArgumentSets: vi.fn(),
  listLibraryArgumentSets: vi.fn(),
  listArgumentSetVersions: vi.fn(),
  getArgumentSet: vi.fn(),
  createArgumentSet: vi.fn(),
  createArgumentSetVersion: vi.fn(),
  updateArgumentSet: vi.fn(),
}));

vi.mock('@/composables/useApiClient', () => ({ useApiClient: () => api }));
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { useArgumentSets } = await import('@/composables/useArgumentSets');
const { useArgumentSetDrafts } = await import('@/composables/useArgumentSetDrafts');

const SCRATCH = 'urn:ui-temp:query-1';
const OTHER_SCRATCH = 'urn:ui-temp:query-2';
const SAVED = 'urn:sqlib:query:q1';
const LIBRARY = 'urn:sqlib:library:lib1';

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useArgumentSetDrafts().reload();
  api.listArgumentSets.mockResolvedValue([]);
  api.listLibraryArgumentSets.mockResolvedValue([]);
  api.listArgumentSetVersions.mockResolvedValue([]);
});

/** A work area showing a scratch callable: no server id, a scratch record id. */
function onScratch(scratchId: string = SCRATCH) {
  return useArgumentSets(ref(''), 'query', () => LIBRARY, {
    scratchTargetId: () => scratchId,
  });
}

/**
 * Let the load the target watcher queued actually run.
 *
 * It is deferred by a microtask on purpose — a screen's `libraryId` getter
 * reads state declared further down its own setup — so a test that asserts on
 * `error` has to get past it first: the load clears the error as it starts,
 * and would otherwise wipe whatever the assertion is about.
 */
const settled = () => Promise.resolve().then(() => {});

describe('a scratch callable', () => {
  it('creates a scratch set, which is what the panel then shows', () => {
    const args = onScratch();

    const id = args.createScratch();

    expect(id).not.toBeNull();
    expect(args.selection.value).toEqual({ kind: 'scratch', id });
    expect(args.stateLabel.value).toBe('Scratch');
  });

  it('lists the sets it made, newest first, as the switcher draws them', () => {
    const args = onScratch();
    args.createScratch('First');
    args.createScratch('Second');

    expect(args.scratchSets.value.map((entry) => entry.name)).toEqual(['Second', 'First']);
  });

  it('keeps one scratch callable\'s sets off another\'s switcher', () => {
    onScratch().createScratch('Mine');

    expect(onScratch(OTHER_SCRATCH).scratchSets.value).toEqual([]);
  });

  it('persists edited values against the scratch id', async () => {
    const args = onScratch();
    args.createScratch();

    args.scalarBindings.value = [
      { parameterName: 'pageSize', parameterKind: 'limit', numericValue: 25 },
    ];
    await nextTick();
    args.persistLocal();

    const stored = useArgumentSetDrafts().scratchFor(SCRATCH);
    expect(stored).toHaveLength(1);
    expect(stored[0].scalarBindings[0].numericValue).toBe(25);
  });

  /*
   * The values are in the browser either way, so refusing to save is not
   * refusing to run: `visibleValuesPayload` is what a draft query executes
   * with, and it reads the same refs the panel edits.
   */
  it('hands its values to a run without going near the server', () => {
    const args = onScratch();
    args.createScratch();
    args.scalarBindings.value = [
      { parameterName: 'pageSize', parameterKind: 'limit', numericValue: 10 },
    ];

    expect(args.visibleValuesPayload()).toEqual({ limits: [{ name: 'pageSize', value: 10 }] });
    expect(args.executionArgumentSetId.value).toBeNull();
  });

  it('refuses to save, naming what has to happen first', async () => {
    const args = onScratch();
    await settled();
    args.createScratch();
    args.name.value = 'Cities';

    expect(await args.save()).toBe(false);
    expect(api.createArgumentSet).not.toHaveBeenCalled();
    expect(args.error.value).toBe('Save the query first');
  });

  it('says "group" when that is what is open', async () => {
    const args = useArgumentSets(ref(''), 'queryGroup', () => LIBRARY, {
      scratchTargetId: () => SCRATCH,
    });
    await settled();
    args.createScratch();
    args.name.value = 'Cities';

    expect(await args.save()).toBe(false);
    expect(args.error.value).toBe('Save the group first');
  });
});

describe('when the callable is saved', () => {
  it('moves its sets to the server id, so the switcher still lists them', () => {
    const local = useArgumentSetDrafts();
    onScratch().createScratch('Made while scratch');

    expect(local.rekeyTarget(SCRATCH, SAVED)).toBe(1);

    expect(local.scratchFor(SCRATCH)).toEqual([]);
    expect(local.scratchFor(SAVED).map((entry) => entry.name)).toEqual(['Made while scratch']);
  });

  it('leaves another callable\'s sets where they are', () => {
    const local = useArgumentSetDrafts();
    onScratch().createScratch('Mine');
    onScratch(OTHER_SCRATCH).createScratch('Theirs');

    local.rekeyTarget(SCRATCH, SAVED);

    expect(local.scratchFor(OTHER_SCRATCH).map((entry) => entry.name)).toEqual(['Theirs']);
  });

  /* Re-filing a record is not an edit to it, and the header pill counts edits. */
  it('does not count the move as an edit', () => {
    const local = useArgumentSetDrafts();
    const args = onScratch();
    args.createScratch();
    args.scalarBindings.value = [
      { parameterName: 'pageSize', parameterKind: 'limit', numericValue: 5 },
    ];
    args.persistLocal();
    const before = local.scratchFor(SCRATCH)[0].edits;

    local.rekeyTarget(SCRATCH, SAVED);

    expect(local.scratchFor(SAVED)[0].edits).toBe(before);
  });

  it('is a no-op when the ids are the same', () => {
    const local = useArgumentSetDrafts();
    onScratch().createScratch();

    expect(local.rekeyTarget(SCRATCH, SCRATCH)).toBe(0);
    expect(local.scratchFor(SCRATCH)).toHaveLength(1);
  });
});
