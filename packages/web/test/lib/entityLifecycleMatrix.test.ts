/**
 * The versioned editor's lifecycle, enumerated.
 *
 * Every realized cell x every command the state's own vocabulary offers,
 * against the contract `queryGroupCommands.ts` established:
 *
 * - **Refused means untouched and explained.** Same state object back, at
 *   least one diagnostic, no effects. A refusal with no reason is the silent
 *   no-op that loses a prompt or a save.
 * - **Applied means no new damage.** Violation codes after ⊆ codes before.
 *
 * Plus one property that only exists across a pair of states, so it cannot be
 * an invariant on either: no transition loses unsaved work except the two
 * allowed to end a draft.
 *
 * One sweep, because there is now one lifecycle. It used to run seven times,
 * once per capability profile, and that was the right shape while the profiles
 * differed: running the same matrix over all of them is what stopped "queries
 * do it this way" and "groups do it that way" from becoming two sets of rules
 * nobody reconciled. They stopped differing — #191 took the last write-shaped
 * flag and #190 the last state-shaped one — so seven identical sweeps assert
 * nothing seven times. What replaces them is stronger, and lives below in
 * `every section is this lifecycle`: not that the profiles agree, but that no
 * section has a profile to disagree with.
 *
 * Realizability is asserted, never assumed — a cell that cannot be built is
 * counted with its reason, because a silently skipped cell is the vacuity trap
 * `packages/api/test/phase2/README.md` documents.
 */
import { describe, it, expect } from 'vitest';

import {
  applyCommand,
  checkInvariants,
  hasUnsavedEdits,
  initialScratch,
  lostWork,
  savedWith,
  routeVersionFor,
  rowKey,
  LIFECYCLE_COMMAND_TYPES,
  LIFECYCLE_TRANSITIONS,
  type LifecycleCommand,
  type EntityLifecycleState,
} from '@/lib/entityLifecycle';

const V1 = 'SELECT 1';
const V2 = 'SELECT 2';
const EDITED = 'SELECT edited';

/** Pinned so a change that makes a class of state unreachable is noticed. */
const REALIZED_CELLS = 18;

type Selection = 'current' | 'historical';
type EditsClass = 'none' | 'unsaved';
type Inflight = 'idle' | 'saving' | 'loading';

interface Cell {
  persistence: 'scratch' | 'saved';
  versions: 0 | 1 | 2;
  selection: Selection;
  edits: EditsClass;
  inflight: Inflight;
}

type Realization =
  | { status: 'realized'; state: EntityLifecycleState }
  | { status: 'unrealizable'; reason: string };

function allCells(): Cell[] {
  const cells: Cell[] = [];
  for (const persistence of ['scratch', 'saved'] as const) {
    for (const versions of [0, 1, 2] as const) {
      for (const selection of ['current', 'historical'] as const) {
        for (const edits of ['none', 'unsaved'] as const) {
          for (const inflight of ['idle', 'saving', 'loading'] as const) {
            cells.push({ persistence, versions, selection, edits, inflight });
          }
        }
      }
    }
  }
  return cells;
}

const describeCell = (cell: Cell) =>
  `${cell.persistence}/v${cell.versions}/${cell.selection}/edits:${cell.edits}/${cell.inflight}`;

/** Build a cell by driving the model, never by hand-writing a state object. */
function realize(cell: Cell): Realization {
  if (cell.persistence === 'scratch') {
    if (cell.versions !== 0) return { status: 'unrealizable', reason: 'a scratch record has no versions' };
    if (cell.selection !== 'current') return { status: 'unrealizable', reason: 'a scratch record selects nothing' };
    if (cell.edits !== 'none') {
      return { status: 'unrealizable', reason: 'a scratch record is its own body; it has no version to diverge from' };
    }
    if (cell.inflight === 'loading') return { status: 'unrealizable', reason: 'a scratch record has nothing to load' };
    const state = initialScratch('SELECT scratch');
    if (cell.inflight === 'idle') return { status: 'realized', state };
    return { status: 'realized', state: applyCommand(state, { type: 'save' }).state };
  }

  if (cell.versions === 0) {
    // A saved entity with no version yet is real — the first Save is v1
    // — and it *can* carry unsaved edits: the body about to become v1.
    // What it cannot do is select, because there is nothing to select.
    if (cell.selection !== 'current') {
      return { status: 'unrealizable', reason: 'nothing saved to select' };
    }
    if (cell.inflight === 'loading') return { status: 'unrealizable', reason: 'no version to load' };

    let state = savedWith([]);
    if (cell.edits === 'unsaved') {
      state = applyCommand(state, { type: 'type', body: 'SELECT first' }).state;
    }
    if (cell.inflight === 'idle') return { status: 'realized', state };
    const saving = applyCommand(state, { type: 'save' });
    if (!saving.applied) {
      return { status: 'unrealizable', reason: 'an empty body is nothing to save' };
    }
    return { status: 'realized', state: saving.state };
  }

  if (cell.selection === 'historical' && cell.versions < 2) {
    return { status: 'unrealizable', reason: 'an older version needs a newer one to be older than' };
  }

  let state = savedWith(cell.versions === 1 ? [V1] : [V1, V2]);

  if (cell.selection === 'historical') {
    const selected = applyCommand(state, { type: 'select-version', version: 1 });
    state = applyCommand(selected.state, {
      type: 'load-resolved',
      generation: selected.state.generation,
      version: 1,
    }).state;
  }

  if (cell.edits === 'unsaved') {
    const typed = applyCommand(state, { type: 'type', body: EDITED });
    if (!typed.applied) return { status: 'unrealizable', reason: 'typing was refused' };
    state = typed.state;
  }

  if (cell.inflight === 'saving') {
    const saved = applyCommand(state, { type: 'save' });
    if (!saved.applied) return { status: 'unrealizable', reason: 'nothing to save without a draft' };
    state = saved.state;
  }

  if (cell.inflight === 'loading') {
    const target = cell.selection === 'historical' ? 2 : 1;
    const loading = applyCommand(state, { type: 'select-version', version: target });
    if (!loading.applied) return { status: 'unrealizable', reason: 'no other version to load' };
    state = loading.state;
  }

  return { status: 'realized', state };
}

/** Every command the vocabulary offers from a state, fresh and stale. */
function commandInstances(state: EntityLifecycleState): Array<{ label: string; command: LifecycleCommand }> {
  const live = state.generation;
  const stale = state.lastGeneration + 7;
  const instances: Array<{ label: string; command: LifecycleCommand }> = [
    { label: 'type(new)', command: { type: 'type', body: 'SELECT something else' } },
    { label: 'type(blank)', command: { type: 'type', body: '' } },
    { label: 'save', command: { type: 'save' } },
    { label: 'discard-draft', command: { type: 'discard-draft' } },
    { label: 'show-version-body', command: { type: 'show-version-body' } },
    { label: 'restore-draft-body', command: { type: 'restore-draft-body' } },
    { label: 'select-version(1)', command: { type: 'select-version', version: 1 } },
    { label: 'select-version(2)', command: { type: 'select-version', version: 2 } },
    { label: 'select-version(99)', command: { type: 'select-version', version: 99 } },
    { label: 'external-change', command: { type: 'external-change' } },
  ];

  // Typing back to exactly what is saved — the undo that must clear the
  // draft rather than leave a dot behind.
  if (state.currentVersion !== null) {
    instances.push({
      label: 'type(back to saved)',
      command: { type: 'type', body: state.savedBodies[state.currentVersion] ?? '' },
    });
  }

  const nextVersion = Object.keys(state.savedBodies).length + 1;
  for (const [tag, generation] of [['live', live], ['stale', stale]] as const) {
    instances.push(
      { label: `save-resolved(${tag})`, command: { type: 'save-resolved', generation, version: nextVersion } },
      { label: `save-failed(${tag})`, command: { type: 'save-failed', generation, message: 'nope' } },
      { label: `load-resolved(${tag})`, command: { type: 'load-resolved', generation, version: 1 } },
      { label: `load-failed(${tag})`, command: { type: 'load-failed', generation, message: 'nope' } }
    );
  }

  return instances;
}

const versionCount = (state: EntityLifecycleState) => Object.keys(state.savedBodies).length;

describe('entity lifecycle matrix', () => {
  const realizeIn = (cell: Cell) => realize(cell);

  it('the transition table covers every row and every command', () => {
    // Reflection over the exported vocabulary: a command added without a row
    // fails here by name rather than silently joining the untested set.
    for (const [row, offers] of Object.entries(LIFECYCLE_TRANSITIONS)) {
      expect(Object.keys(offers).sort(), row).toEqual([...LIFECYCLE_COMMAND_TYPES].sort());
    }
    for (const cell of allCells()) {
      const realization = realizeIn(cell);
      if (realization.status !== 'realized') continue;
      expect(LIFECYCLE_TRANSITIONS[rowKey(realization.state)], describeCell(cell)).toBeDefined();
    }
  });

  it('every cell is realized or explained', () => {
    const cells = allCells();
    const realized = cells.filter((cell) => realizeIn(cell).status === 'realized');
    const unrealizable = cells.filter((cell) => realizeIn(cell).status === 'unrealizable');

    expect(realized.length + unrealizable.length).toBe(cells.length);
    expect(cells.length).toBe(72);
    expect(realized.length).toBe(REALIZED_CELLS);
  });

  it('a realized cell is actually the cell it claims to be', () => {
    // The realization drives the model rather than hand-writing states, so a
    // rule change can quietly produce something other than the cell asked for
    // — and the sweep would then report coverage it does not have. Checking
    // the discriminators back is what stops the labels lying.
    for (const cell of allCells()) {
      const realization = realizeIn(cell);
      if (realization.status !== 'realized') continue;
      const { state } = realization;
      const where = describeCell(cell);

      expect(state.persistence, where).toBe(cell.persistence);
      expect(Object.keys(state.savedBodies).length, where).toBe(cell.versions);
      expect(state.inflight, where).toBe(cell.inflight === 'idle' ? 'idle' : cell.inflight);
      expect(hasUnsavedEdits(state), where).toBe(cell.edits === 'unsaved');
      if (cell.versions > 0 && cell.persistence === 'saved' && state.inflight === 'idle') {
        const isCurrent = state.selectedVersion === state.currentVersion;
        expect(isCurrent, where).toBe(cell.selection === 'current');
      }
    }
  });

  it('every realized cell is itself clean', () => {
    for (const cell of allCells()) {
      const realization = realizeIn(cell);
      if (realization.status !== 'realized') continue;
      expect(checkInvariants(realization.state), describeCell(cell)).toEqual([]);
    }
  });

  it('every command holds the contract on every realized cell', () => {
    const failures: string[] = [];
    let transitions = 0;

    for (const cell of allCells()) {
      const realization = realizeIn(cell);
      if (realization.status !== 'realized') continue;
      const { state } = realization;
      const before = new Set(checkInvariants(state).map((violation) => violation.code));

      for (const instance of commandInstances(state)) {
        transitions++;
        const result = applyCommand(state, instance.command);
        const where = `${describeCell(cell)} :: ${instance.label}`;

        if (!result.applied) {
          if (result.state !== state) failures.push(`${where} :: refused but returned a different state`);
          if (result.effects.length) failures.push(`${where} :: refused but asked for an effect`);
          if (!result.diagnostics.length) failures.push(`${where} :: refused with no diagnostic`);
          continue;
        }

        for (const violation of checkInvariants(result.state)) {
          if (!before.has(violation.code)) failures.push(`${where} :: introduced ${violation.code}`);
        }

        if (lostWork(state, result.state, instance.command)) {
          failures.push(`${where} :: lost unsaved work`);
        }

        // Only a save changes how many versions there are. Nothing edits
        // one in place, so nothing else may touch the count either.
        const expectedCount = instance.command.type === 'save-resolved'
          ? versionCount(state) + 1
          : versionCount(state);
        if (versionCount(result.state) !== expectedCount) {
          failures.push(`${where} :: changed the number of versions`);
        }
      }
    }

    expect(failures).toEqual([]);
    // A property that never generates a case passes vacuously; this guards
    // against the whole sweep quietly becoming empty.
    expect(transitions).toBeGreaterThan(250);
  });

  it('the route never disagrees with what is on screen (§4.4.1)', () => {
    for (const cell of allCells()) {
      const realization = realizeIn(cell);
      if (realization.status !== 'realized') continue;

      for (const instance of commandInstances(realization.state)) {
        const result = applyCommand(realization.state, instance.command);
        if (!result.applied || result.state.inflight !== 'idle') continue;

        const where = `${describeCell(cell)} :: ${instance.label}`;
        expect(result.state.routeVersion, where).toBe(routeVersionFor(result.state));

        if (result.state.routeVersion !== realization.state.routeVersion) {
          expect(
            result.effects.some(
              (effect) => effect.type === 'emit-route-version' && effect.version === result.state.routeVersion
            ),
            `${where} :: route changed without telling the parent`
          ).toBe(true);
        }
      }
    }
  });

  it('a failed save leaves the draft byte-identical (§4.4.3)', () => {
    for (const cell of allCells()) {
      const realization = realizeIn(cell);
      if (realization.status !== 'realized') continue;
      const { state } = realization;
      if (state.inflight !== 'saving') continue;

      const failed = applyCommand(state, {
        type: 'save-failed',
        generation: state.generation,
        message: 'the server said no',
      });
      expect(failed.applied, describeCell(cell)).toBe(true);
      expect(failed.state.draft, describeCell(cell)).toEqual(state.draft);
      expect(failed.state.body, describeCell(cell)).toBe(state.body);
      expect(failed.state.lastError, describeCell(cell)).toBeTruthy();
    }
  });
});

describe('one lifecycle, every section', () => {
  it('every section is this lifecycle, with nothing left to configure', () => {
    // The claim #190 closes, and the only form it can take once the mechanism
    // is deleted: a state carries no per-section switch, so no section can
    // behave differently from the sweep above. Reflection over the state the
    // constructors actually build, rather than over a list of profiles that
    // would need maintaining alongside the sections it names.
    const built = [initialScratch('SELECT scratch'), savedWith([V1, V2])];
    for (const state of built) {
      expect(Object.keys(state)).not.toContain('capabilities');
    }
    expect(Object.keys(savedWith([V1]))).toEqual(Object.keys(savedWith([V1, V2])));
  });

  it('a draft is what "unsaved edits" means, everywhere', () => {
    // Tests and ETL used to answer this by comparing the body to the version,
    // because they had no draft to point at. One question, one answer now.
    let state = savedWith([V1]);
    expect(hasUnsavedEdits(state)).toBe(false);

    state = applyCommand(state, { type: 'type', body: EDITED }).state;
    expect(state.draft?.body).toBe(EDITED);
    expect(hasUnsavedEdits(state)).toBe(true);

    // Looking at the saved body is not saving it: the draft, and so
    // the answer, is unchanged while the editor shows something else.
    const shown = applyCommand(state, { type: 'show-version-body' });
    expect(shown.state.body).toBe(V1);
    expect(hasUnsavedEdits(shown.state)).toBe(true);
  });

  it('a version is never edited in place, in any section', () => {
    // Groups used to offer this, behind a confirm dialog that warned the write
    // was partial. It is gone: compatibility between a group and the query
    // versions it composes can only be established for a *given* version, and
    // a version that changes under a reference makes every such check
    // provisional. The vocabulary has no word for it any more, which is the
    // strongest form the rule can take.
    expect(LIFECYCLE_COMMAND_TYPES).not.toContain('overwrite');
    for (const row of Object.values(LIFECYCLE_TRANSITIONS)) {
      expect(Object.keys(row)).not.toContain('overwrite');
    }
  });

  it('saving is the only way a version count changes', () => {
    let state = savedWith([V1, V2]);
    state = applyCommand(state, { type: 'type', body: EDITED }).state;

    const saving = applyCommand(state, { type: 'save' });
    expect(saving.effects).toContainEqual({
      type: 'create-version',
      generation: saving.state.generation,
      body: EDITED,
    });

    const resolved = applyCommand(saving.state, {
      type: 'save-resolved',
      generation: saving.state.generation,
      version: 3,
    });

    // The edit becomes v3; v2 is exactly what it was.
    expect(Object.keys(resolved.state.savedBodies)).toHaveLength(3);
    expect(resolved.state.savedBodies[2]).toBe(V2);
    expect(resolved.state.savedBodies[3]).toBe(EDITED);
    expect(resolved.state.currentVersion).toBe(3);
  });

  it('a reply for a superseded request cannot apply', () => {
    const state = savedWith([V1, V2]);
    const typed = applyCommand(state, { type: 'type', body: EDITED });
    const saving = applyCommand(typed.state, { type: 'save' });

    const stale = applyCommand(saving.state, {
      type: 'save-resolved',
      generation: saving.state.generation - 1,
      version: 3,
    });

    expect(stale.applied).toBe(false);
    expect(stale.state).toBe(saving.state);
    expect(stale.effects).toEqual([]);
  });

  it('a save makes its version current, and clears a stale route', () => {
    // The §7.1 scenario end to end: viewing v1 of two, edit, save v3.
    let state = savedWith([V1, V2]);
    const selected = applyCommand(state, { type: 'select-version', version: 1 });
    state = applyCommand(selected.state, {
      type: 'load-resolved',
      generation: selected.state.generation,
      version: 1,
    }).state;
    expect(state.routeVersion).toBe(1);

    state = applyCommand(state, { type: 'type', body: EDITED }).state;
    const saving = applyCommand(state, { type: 'save' });
    const resolved = applyCommand(saving.state, {
      type: 'save-resolved',
      generation: saving.state.generation,
      version: 3,
    });

    expect(resolved.state.currentVersion).toBe(3);
    expect(resolved.state.selectedVersion).toBe(3);
    expect(resolved.state.draft).toBeNull();
    expect(resolved.state.routeVersion).toBeNull();
    expect(resolved.effects).toContainEqual({ type: 'emit-route-version', version: null });
  });

  it('looking at a saved version does not discard the draft', () => {
    let state = savedWith([V1]);
    state = applyCommand(state, { type: 'type', body: EDITED }).state;
    expect(state.draft?.body).toBe(EDITED);

    const shown = applyCommand(state, { type: 'show-version-body' });
    expect(shown.state.body).toBe(V1);
    expect(shown.state.draft?.body).toBe(EDITED);

    const restored = applyCommand(shown.state, { type: 'restore-draft-body' });
    expect(restored.state.body).toBe(EDITED);
  });
});
