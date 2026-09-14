/**
 * What a versioned editor may be, and what may happen to it next.
 *
 * A specification with a checker, not a rewrite. The work areas keep their
 * refs; this module states what those refs are allowed to add up to, so the
 * properties that matter — a route that agrees with the editor, a draft that
 * survives a failed save, a body that is never replaced silently — are
 * things a test can assert rather than things a reviewer has to notice.
 *
 * **One model, every section.** Queries, groups, rulesets, data graphs,
 * benchmarks, tests and ETL pipelines are not variations on a lifecycle, they
 * are the same one: each keeps unsaved edits as a browser-local draft, and
 * each saves by minting the next version. There is no configuration here
 * to get wrong, because there is nothing left for a section to differ about.
 *
 * It was configurable until #190. `LifecycleCapabilities` carried three flags;
 * #191 deleted `overwrite` when versions became snapshots, `concurrency`
 * described how a write was sent rather than what states exist, and `drafts`
 * was true of five sections and false of two only because Tests and ETL had
 * never been wired to the drafts store. Wiring them left a one-entry
 * abstraction, and a one-entry abstraction is a worse description than none.
 *
 * **A version is a snapshot.** Nothing edits one in place. Groups used to,
 * through a confirm dialog that warned the write was partial, and that is gone:
 * compatibility between a group and the query versions it composes — or a query
 * and its argument set versions — can only be established *for a given version*,
 * and a version that can change under a reference makes every such check
 * provisional. The `immutable` flag the version schemas already carry is the
 * mechanism; making the API enforce it is issue #192.
 *
 * The shape is `queryGroupCommands.ts`'s, with the two additions asynchrony
 * needs: effects are returned as data, and a request's resolution arrives as
 * an event carrying the generation it was issued under, so a reply to a
 * request the screen has moved past cannot apply.
 *
 * A version is identified by its number here. The real code carries IRIs too,
 * but nothing in these rules reads one — versions are dense and ordered, which
 * is the property the API guarantees and the matrix relies on.
 */

export type Persistence = 'scratch' | 'saved';
export type Inflight = 'idle' | 'loading' | 'saving';

/** Where the text in the editor came from, which decides what typing means. */
export type BodySource = 'hydrated' | 'draft' | 'typed';

export interface EntityDraft {
  body: string;
  /** Autosaves since the draft began — what the `Draft · 3 edits` pill counts. */
  edits: number;
}

export interface EntityLifecycleState {
  persistence: Persistence;
  /** Bodies of the saved versions, by version number, densely from 1. */
  savedBodies: Record<number, string>;
  currentVersion: number | null;
  selectedVersion: number | null;
  draft: EntityDraft | null;
  body: string;
  bodySource: BodySource;
  /** What the URL carries: a number only while a non-current version is shown. */
  routeVersion: number | null;
  inflight: Inflight;
  generation: number;
  lastGeneration: number;
  lastError: string | null;
  /** A write has landed elsewhere since this screen last read the entity. */
  etagStale: boolean;
}

export type LifecycleCommand =
  | { type: 'type'; body: string }
  | { type: 'save' }
  | { type: 'save-resolved'; generation: number; version: number }
  | { type: 'save-failed'; generation: number; message: string }
  | { type: 'discard-draft' }
  | { type: 'show-version-body' }
  | { type: 'restore-draft-body' }
  | { type: 'select-version'; version: number }
  | { type: 'load-resolved'; generation: number; version: number }
  | { type: 'load-failed'; generation: number; message: string }
  | { type: 'external-change' };

export type LifecycleEffect =
  | { type: 'create-version'; generation: number; body: string }
  | { type: 'load-version'; generation: number; version: number }
  | { type: 'emit-route-version'; version: number | null }
  | { type: 'save-draft'; body: string; edits: number }
  | { type: 'remove-draft' }
  | { type: 'refresh-entity' };

export interface Diagnostic {
  level: 'error' | 'warning' | 'info';
  code: string;
  message: string;
}

export interface CommandResult {
  state: EntityLifecycleState;
  effects: LifecycleEffect[];
  diagnostics: Diagnostic[];
  /** False when a precondition failed: `state` is the input, untouched. */
  applied: boolean;
}

export const LIFECYCLE_COMMAND_TYPES = [
  'type',
  'save',
  'save-resolved',
  'save-failed',
  'discard-draft',
  'show-version-body',
  'restore-draft-body',
  'select-version',
  'load-resolved',
  'load-failed',
  'external-change',
] as const;

/**
 * Coarse legality, as data.
 *
 * The guards below are the fine grain — a draft that exists, a version that
 * does not — but which commands a screen offers at all is a table, so "what
 * can happen from here" is read rather than derived. Rows are keyed by
 * persistence and what is in flight, because those two decide the offer.
 */
export const LIFECYCLE_TRANSITIONS: Record<string, Record<string, boolean>> = {
  'scratch/idle': {
    type: true,
    save: true,
    'save-resolved': false,
    'save-failed': false,
    'discard-draft': false,
    'show-version-body': false,
    'restore-draft-body': false,
    'select-version': false,
    'load-resolved': false,
    'load-failed': false,
    'external-change': false,
  },
  'scratch/saving': {
    type: false,
    save: false,
    'save-resolved': true,
    'save-failed': true,
    'discard-draft': false,
    'show-version-body': false,
    'restore-draft-body': false,
    'select-version': false,
    'load-resolved': false,
    'load-failed': false,
    'external-change': false,
  },
  'scratch/loading': {
    type: false,
    save: false,
    'save-resolved': false,
    'save-failed': false,
    'discard-draft': false,
    'show-version-body': false,
    'restore-draft-body': false,
    'select-version': false,
    'load-resolved': false,
    'load-failed': false,
    'external-change': false,
  },
  'saved/idle': {
    type: true,
    save: true,
    'save-resolved': false,
    'save-failed': false,
    'discard-draft': true,
    'show-version-body': true,
    'restore-draft-body': true,
    'select-version': true,
    'load-resolved': false,
    'load-failed': false,
    'external-change': true,
  },
  'saved/saving': {
    // Typing during a save is allowed — the editor is not locked — but it
    // is the case that used to lose work, so it has its own row rather than
    // being folded into `idle`.
    type: true,
    save: false,
    'save-resolved': true,
    'save-failed': true,
    'discard-draft': false,
    'show-version-body': false,
    'restore-draft-body': false,
    'select-version': false,
    'load-resolved': false,
    'load-failed': false,
    'external-change': true,
  },
  'saved/loading': {
    type: false,
    save: false,
    'save-resolved': false,
    'save-failed': false,
    'discard-draft': false,
    'show-version-body': false,
    'restore-draft-body': false,
    'select-version': false,
    'load-resolved': true,
    'load-failed': true,
    'external-change': true,
  },
};

export function rowKey(state: EntityLifecycleState): string {
  return `${state.persistence}/${state.inflight}`;
}

export function initialScratch(body = ''): EntityLifecycleState {
  return {
    persistence: 'scratch',
    savedBodies: {},
    currentVersion: null,
    selectedVersion: null,
    draft: null,
    body,
    bodySource: 'typed',
    routeVersion: null,
    inflight: 'idle',
    generation: 0,
    lastGeneration: 0,
    lastError: null,
    etagStale: false,
  };
}

export function savedWith(
  bodies: string[],
  options: { current?: number } = {}
): EntityLifecycleState {
  const savedBodies: Record<number, string> = {};
  bodies.forEach((body, index) => {
    savedBodies[index + 1] = body;
  });
  const current = options.current ?? bodies.length;
  return {
    persistence: 'saved',
    savedBodies,
    currentVersion: bodies.length ? current : null,
    selectedVersion: bodies.length ? current : null,
    draft: null,
    body: bodies.length ? savedBodies[current] : '',
    bodySource: 'hydrated',
    routeVersion: null,
    inflight: 'idle',
    generation: 0,
    lastGeneration: 0,
    lastError: null,
    etagStale: false,
  };
}

const refuse = (state: EntityLifecycleState, code: string, message: string): CommandResult => ({
  state,
  effects: [],
  diagnostics: [{ level: 'error', code, message }],
  applied: false,
});

const ignore = (state: EntityLifecycleState, code: string, message: string): CommandResult => ({
  state,
  effects: [],
  diagnostics: [{ level: 'info', code, message }],
  applied: false,
});

/**
 * The body the editor is measured against: what the *shown* version holds.
 *
 * The shown version, not the current one. Measuring against current would make
 * "I am looking at v1 while v2 is current" indistinguishable from "I have
 * unsaved edits" — the editor would report changes nobody made, and a
 * draftless section would report them permanently. `QueryWorkArea` has always
 * compared against the loaded version's text; this is that rule, written down.
 */
function savedBody(state: EntityLifecycleState): string {
  const shown = state.selectedVersion ?? state.currentVersion;
  if (shown === null) return '';
  return state.savedBodies[shown] ?? '';
}

/**
 * Are there edits that no version holds yet?
 *
 * The draft record *is* the answer — it exists exactly while the body diverges
 * from the version on screen, which is invariant I2. There used to be a second
 * answer for the sections that kept no draft, comparing the body against the
 * version directly; it is gone with them (#190), and with it the possibility of
 * the two disagreeing about the same state.
 *
 * A scratch record is unsaved in its entirety and holds no draft, so it
 * answers `false` here and `save` handles it on its own.
 */
export function hasUnsavedEdits(state: EntityLifecycleState): boolean {
  return state.draft !== null;
}

/**
 * The route's convention, in one place.
 *
 * A number only while a version *other than the current one* is being shown.
 * Written down here because it was previously implied by two call sites that
 * disagreed (design §7.1).
 */
export function routeVersionFor(state: EntityLifecycleState): number | null {
  if (state.persistence !== 'saved') return null;
  return routeVersionForSelection(state.selectedVersion, state.currentVersion);
}

/**
 * The convention as a primitive, so a screen can apply it without building a
 * model state.
 *
 * Both work areas call this rather than reimplementing the comparison, which
 * is the whole remedy for §7.1: the rule had been implied by call sites that
 * disagreed — the group's emitted the number unconditionally, so saving v3
 * left `?version=3` in the URL and every bookmark silently pinned itself to
 * whatever was current when it was taken.
 */
export function routeVersionForSelection(
  selected: number | null,
  current: number | null
): number | null {
  if (selected === null || selected === current) return null;
  return selected;
}

function withRoute(state: EntityLifecycleState): { state: EntityLifecycleState; effects: LifecycleEffect[] } {
  const next = routeVersionFor(state);
  if (next === state.routeVersion) return { state, effects: [] };
  return {
    state: { ...state, routeVersion: next },
    effects: [{ type: 'emit-route-version', version: next }],
  };
}

export function applyCommand(state: EntityLifecycleState, command: LifecycleCommand): CommandResult {
  const row = LIFECYCLE_TRANSITIONS[rowKey(state)];
  if (!row || !row[command.type]) {
    return refuse(
      state,
      'command-illegal-here',
      `${command.type} is not offered while ${rowKey(state)}.`
    );
  }

  if ('generation' in command && command.generation !== state.generation) {
    return ignore(
      state,
      'generation-stale',
      `Reply for generation ${command.generation}; ${state.generation} is in flight.`
    );
  }

  switch (command.type) {
    case 'type': {
      if (state.persistence === 'scratch') {
        return {
          state: { ...state, body: command.body, bodySource: 'typed' },
          effects: [],
          diagnostics: [],
          applied: true,
        };
      }

      // Typing back to what is saved is an undo, not an edit: it must
      // leave no draft behind, or the sidebar dot never clears.
      if (command.body.trim() === savedBody(state).trim()) {
        return {
          state: { ...state, body: command.body, bodySource: 'typed', draft: null },
          effects: state.draft ? [{ type: 'remove-draft' }] : [],
          diagnostics: [],
          applied: true,
        };
      }

      const edits = (state.draft?.edits ?? 0) + 1;
      return {
        state: {
          ...state,
          body: command.body,
          bodySource: 'typed',
          draft: { body: command.body, edits },
        },
        effects: [{ type: 'save-draft', body: command.body, edits }],
        diagnostics: [],
        applied: true,
      };
    }

    case 'save': {
      if (!state.body.trim()) {
        return refuse(state, 'body-empty', 'There is nothing to save.');
      }
      if (state.persistence === 'saved' && !hasUnsavedEdits(state)) {
        // Saving an unchanged body would mint a version identical to the
        // last one. Nothing to save is not an error, it is a disabled
        // button — but it is still a refusal with a reason, never a no-op.
        return refuse(state, 'nothing-to-save', 'No unsaved edits.');
      }
      const generation = state.lastGeneration + 1;
      return {
        state: { ...state, inflight: 'saving', generation, lastGeneration: generation, lastError: null },
        effects: [{ type: 'create-version', generation, body: state.body }],
        diagnostics: [],
        applied: true,
      };
    }

    case 'save-resolved': {
      const savedBodies = { ...state.savedBodies, [command.version]: state.body };
      const settled: EntityLifecycleState = {
        ...state,
        persistence: 'saved',
        savedBodies,
        currentVersion: command.version,
        selectedVersion: command.version,
        // The draft became the version; keeping it would show unsaved
        // edits against a version that already contains them.
        draft: null,
        bodySource: 'hydrated',
        inflight: 'idle',
        etagStale: false,
      };
      const routed = withRoute(settled);
      return {
        state: routed.state,
        effects: [{ type: 'remove-draft' }, ...routed.effects],
        diagnostics: [],
        applied: true,
      };
    }

    case 'save-failed':
      // The draft is left exactly as it was. A save that failed and took
      // the edits with it is the one outcome that loses work outright.
      return {
        state: { ...state, inflight: 'idle', lastError: command.message },
        effects: [],
        diagnostics: [],
        applied: true,
      };

    case 'discard-draft': {
      if (!state.draft) return refuse(state, 'no-draft', 'There are no unsaved edits.');
      const shown = state.selectedVersion === null ? '' : state.savedBodies[state.selectedVersion] ?? '';
      return {
        state: { ...state, draft: null, body: shown, bodySource: 'hydrated' },
        effects: [{ type: 'remove-draft' }],
        diagnostics: [],
        applied: true,
      };
    }

    case 'show-version-body': {
      if (state.selectedVersion === null) return refuse(state, 'no-version', 'No version to show.');
      // Hydrating, not typing: looking at the saved text must not count as
      // editing back to it and quietly discard the draft.
      return {
        state: {
          ...state,
          body: state.savedBodies[state.selectedVersion] ?? '',
          bodySource: 'hydrated',
        },
        effects: [],
        diagnostics: [],
        applied: true,
      };
    }

    case 'restore-draft-body': {
      if (!state.draft) return refuse(state, 'no-draft', 'There is no draft to go back to.');
      return {
        state: { ...state, body: state.draft.body, bodySource: 'draft' },
        effects: [],
        diagnostics: [],
        applied: true,
      };
    }

    case 'select-version': {
      if (!(command.version in state.savedBodies)) {
        return refuse(state, 'version-unknown', `There is no version ${command.version}.`);
      }
      if (command.version === state.selectedVersion) {
        return refuse(state, 'version-already-selected', 'That version is already shown.');
      }
      const generation = state.lastGeneration + 1;
      return {
        state: { ...state, inflight: 'loading', generation, lastGeneration: generation },
        effects: [{ type: 'load-version', generation, version: command.version }],
        diagnostics: [],
        applied: true,
      };
    }

    case 'load-resolved': {
      const loaded: EntityLifecycleState = {
        ...state,
        selectedVersion: command.version,
        body: state.savedBodies[command.version] ?? '',
        bodySource: 'hydrated',
        inflight: 'idle',
      };
      const routed = withRoute(loaded);
      return { state: routed.state, effects: routed.effects, diagnostics: [], applied: true };
    }

    case 'load-failed':
      return {
        state: { ...state, inflight: 'idle', lastError: command.message },
        effects: [],
        diagnostics: [],
        applied: true,
      };

    case 'external-change':
      // Someone else wrote. The screen's concurrency token is stale until it
      // refetches; the draft is untouched, because it is this browser's.
      return {
        state: { ...state, etagStale: true },
        effects: [{ type: 'refresh-entity' }],
        diagnostics: [],
        applied: true,
      };

    default:
      return refuse(state, 'command-unknown', 'Unrecognised command.');
  }
}

export interface InvariantViolation {
  code: string;
  message: string;
}

/**
 * What must be true of the editor after any command.
 *
 * I1 and I2 are the two the §7 defects broke. The rest are the structural
 * facts everything else assumes.
 */
export function checkInvariants(state: EntityLifecycleState): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const versions = Object.keys(state.savedBodies).map(Number).sort((a, b) => a - b);

  // I1. The route carries a version exactly while a non-current one is shown.
  if (state.inflight === 'idle' && state.routeVersion !== routeVersionFor(state)) {
    violations.push({
      code: 'route-out-of-sync',
      message: `route says ${state.routeVersion}, showing ${state.selectedVersion} of current ${state.currentVersion}.`,
    });
  }

  // I2. One notion of modified: a draft exists exactly when the unsaved
  // body differs from what the current version saves.
  if (state.draft && state.draft.body.trim() === savedBody(state).trim()) {
    violations.push({ code: 'draft-not-divergent', message: 'A draft records no change.' });
  }
  if (state.draft && state.draft.edits < 1) {
    violations.push({ code: 'draft-edits-invalid', message: `A draft counts ${state.draft.edits} edits.` });
  }

  // I3. Version numbers are dense from 1 — the API's guarantee, relied on here.
  for (let index = 0; index < versions.length; index++) {
    if (versions[index] !== index + 1) {
      violations.push({ code: 'versions-not-dense', message: `Version numbering jumps at ${versions[index]}.` });
      break;
    }
  }

  // I4. Selection and current point at versions that exist.
  for (const [label, value] of [
    ['currentVersion', state.currentVersion],
    ['selectedVersion', state.selectedVersion],
    ['routeVersion', state.routeVersion],
  ] as const) {
    if (value !== null && !(value in state.savedBodies)) {
      violations.push({ code: 'version-dangling', message: `${label} points at missing version ${value}.` });
    }
  }

  // I5. A scratch query has no server identity to have versions of.
  if (state.persistence === 'scratch') {
    if (versions.length || state.currentVersion !== null || state.selectedVersion !== null) {
      violations.push({ code: 'scratch-has-versions', message: 'A scratch query carries version state.' });
    }
    if (state.routeVersion !== null) {
      violations.push({ code: 'scratch-has-route', message: 'A scratch query carries a route version.' });
    }
  }

  // I6. Only a saved entity holds a draft: a scratch record is the body,
  // so there is nothing for a draft to be layered on.
  if (state.draft && state.persistence !== 'saved') {
    violations.push({ code: 'draft-without-entity', message: 'A draft on a record with nothing to draft against.' });
  }

  // I8. A generation is in flight exactly while something is.
  if (state.inflight !== 'idle' && state.generation === 0) {
    violations.push({ code: 'inflight-without-generation', message: `${state.inflight} with no generation.` });
  }

  return violations;
}

/**
 * Did this transition lose unsaved work?
 *
 * Not an invariant on a single state — losing a draft is only visible across a
 * pair — so the matrix calls it per transition. Saving and discarding are
 * the two commands allowed to end a draft, and they are named here rather than
 * inferred, so a new command that swallows one has to be added deliberately.
 */
export function lostWork(
  before: EntityLifecycleState,
  after: EntityLifecycleState,
  command: LifecycleCommand
): boolean {
  if (!before.draft) return false;
  if (after.draft) return false;
  if (command.type === 'discard-draft' || command.type === 'save-resolved') return false;
  // Typing back to the saved body ends the draft because there is nothing
  // left to record, which is an undo rather than a loss.
  if (command.type === 'type' && command.body.trim() === savedBody(before).trim()) return false;
  return true;
}
