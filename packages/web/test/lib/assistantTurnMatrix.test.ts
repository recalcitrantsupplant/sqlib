/**
 * The assistant turn's transition layer, enumerated.
 *
 * Every reachable state class x every event instance the state's own
 * vocabulary offers, including events issued under a generation that is no
 * longer live — which is the dimension the old `await`-shaped implementation
 * had no way to express, and where §7.2, §7.3 and §7.6 lived.
 *
 * The oracle is the command contract `queryGroupCommands.ts` established and
 * this model adopts:
 *
 * - **Refused means untouched and explained.** `applied: false` returns the
 *   same state object — callers keep identity — and at least one diagnostic.
 *   A refusal with no reason is the silent no-op that loses a prompt.
 * - **Applied means no new damage.** Invariant codes after ⊆ codes before.
 *
 * Realizability is asserted, never assumed: a cell that cannot be built is
 * counted, not skipped, because a silently skipped cell is the vacuity trap
 * `packages/api/test/phase2/README.md` documents.
 */
import { describe, it, expect } from 'vitest';

import {
  applyEvent,
  checkInvariants,
  initialState,
  ASSISTANT_EVENT_TYPES,
  ASSISTANT_TRANSITIONS,
  TURN_STATUSES,
  type AssistantEvent,
  type AssistantTurnState,
  type ServerFrame,
  type TurnStatus,
} from '@/lib/assistantTurnModel';

const FRAME_TYPES = ['token', 'receipt', 'changed', 'discarded', 'done'] as const;

const draft = {
  id: 'urn:ui-temp:draft-1',
  kind: 'draft' as const,
  section: 'query' as const,
  name: 'A query',
  description: null,
  body: 'SELECT * WHERE { ?s ?p ?o }',
  basedOn: 'urn:sqlib:query:1',
  libraryId: 'urn:sqlib:library:1',
  createdAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-08-20T00:00:00.000Z',
};

function frameOf(type: (typeof FRAME_TYPES)[number], reason = 'complete'): ServerFrame {
  switch (type) {
    case 'token':
      return { type: 'token', text: 'hi' };
    case 'receipt':
      return { type: 'receipt', tool: 'create_query', status: 'ok', artifacts: [] };
    case 'changed':
      return { type: 'changed', draft };
    case 'discarded':
      return { type: 'discarded', draftId: draft.id };
    case 'done':
      return { type: 'done', reason };
  }
}

/**
 * The state discriminators the transitions actually read.
 *
 * `completed` only exists while streaming (a `done` frame arrives mid-stream
 * and the stream then ends), and `hasContent` only distinguishes anything once
 * an assistant turn exists — so the product is conditioned, not uniform.
 */
interface Cell {
  status: TurnStatus;
  completed: boolean;
  hasContent: boolean;
}

type Realization =
  | { status: 'realized'; state: AssistantTurnState }
  | { status: 'unrealizable'; reason: string };

function allCells(): Cell[] {
  const cells: Cell[] = [];
  for (const status of TURN_STATUSES) {
    for (const completed of [false, true]) {
      for (const hasContent of [false, true]) {
        cells.push({ status, completed, hasContent });
      }
    }
  }
  return cells;
}

function describeCell(cell: Cell): string {
  return `${cell.status}/completed=${cell.completed}/content=${cell.hasContent}`;
}

/** Build a cell by driving the model, never by hand-writing a state object. */
function realize(cell: Cell): Realization {
  if (cell.completed && cell.status !== 'streaming') {
    return { status: 'unrealizable', reason: '`completed` is cleared when a turn lands' };
  }
  let state = initialState();
  const step = (event: AssistantEvent) => {
    const result = applyEvent(state, event);
    if (!result.applied) throw new Error(`could not realize: ${event.type} refused`);
    state = result.state;
  };

  if (cell.status === 'idle' && !cell.hasContent) return { status: 'realized', state };

  step({ type: 'send', prompt: 'do a thing', libraryId: 'urn:sqlib:library:1' });
  if (cell.status === 'opening') {
    if (cell.hasContent) {
      return { status: 'unrealizable', reason: 'no assistant turn exists while opening' };
    }
    return { status: 'realized', state };
  }

  const generation = state.lastGeneration;
  step({ type: 'session-opened', generation, sessionId: 'session-1' });
  if (cell.hasContent) step({ type: 'frame', generation, frame: frameOf('token') });
  if (cell.completed) step({ type: 'frame', generation, frame: frameOf('done') });

  if (cell.status === 'streaming') return { status: 'realized', state };

  if (cell.status === 'idle') {
    // Only a turn that reported `done` lands as `idle`; one whose stream
    // simply stopped settles as `failed`, and is realized further down.
    step({ type: 'frame', generation, frame: frameOf('done') });
    step({ type: 'stream-ended', generation });
    const kept = state.session.turns.at(-1)?.role === 'assistant';
    if (kept !== cell.hasContent) {
      return { status: 'unrealizable', reason: 'a settled turn with no content drops its empty bubble' };
    }
    return { status: 'realized', state };
  }

  // failed
  step({ type: 'stream-failed', generation, message: 'the connection dropped' });
  if (cell.hasContent !== (state.session.turns.at(-1)?.role === 'assistant')) {
    return { status: 'unrealizable', reason: 'a failed turn with no content drops its empty bubble' };
  }
  return { status: 'realized', state };
}

/** Every event the vocabulary offers from a state, fresh and stale. */
function eventInstances(state: AssistantTurnState): Array<{ label: string; event: AssistantEvent }> {
  const live = state.liveGeneration;
  const stale = (live ?? state.lastGeneration) + 7;
  const instances: Array<{ label: string; event: AssistantEvent }> = [
    { label: 'send(text)', event: { type: 'send', prompt: 'another thing', libraryId: 'urn:sqlib:library:1' } },
    { label: 'send(blank)', event: { type: 'send', prompt: '   ', libraryId: null } },
    { label: 'interrupt', event: { type: 'interrupt' } },
    { label: 'new-session', event: { type: 'new-session' } },
  ];

  for (const generation of [live, stale]) {
    if (generation === null) continue;
    const tag = generation === live ? 'live' : 'stale';
    instances.push(
      { label: `session-opened(${tag})`, event: { type: 'session-opened', generation, sessionId: 'session-2' } },
      { label: `session-failed(${tag})`, event: { type: 'session-failed', generation, message: 'nope' } },
      { label: `stream-ended(${tag})`, event: { type: 'stream-ended', generation } },
      { label: `stream-failed(${tag})`, event: { type: 'stream-failed', generation, message: 'dropped' } }
    );
    for (const frameType of FRAME_TYPES) {
      instances.push({
        label: `frame:${frameType}(${tag})`,
        event: { type: 'frame', generation, frame: frameOf(frameType) },
      });
    }
  }

  // A `done` that is not `complete` is its own outcome, not a variant of one.
  if (live !== null) {
    instances.push({
      label: 'frame:done(cap)',
      event: { type: 'frame', generation: live, frame: frameOf('done', 'max-steps') },
    });
  }

  return instances;
}

describe('assistant turn matrix', () => {
  it('the transition table covers every status and every event type', () => {
    // Reflection over the exported vocabulary is what makes this future-proof:
    // adding an event without a row fails here by name rather than silently
    // joining the untested set.
    for (const status of TURN_STATUSES) {
      const row = ASSISTANT_TRANSITIONS[status];
      expect(Object.keys(row).sort()).toEqual([...ASSISTANT_EVENT_TYPES].sort());
    }
  });

  it('every cell is realized or explained', () => {
    const cells = allCells();
    const realized = cells.filter((cell) => realize(cell).status === 'realized');
    const unrealizable = cells.filter((cell) => realize(cell).status === 'unrealizable');

    expect(realized.length + unrealizable.length).toBe(cells.length);
    // Pinned, so a change that quietly makes a class of state unreachable — or
    // reachable — has to be acknowledged here.
    expect(cells.length).toBe(16);
    expect(realized.length).toBe(9);
  });

  it('every event holds the contract on every realized cell', () => {
    const failures: string[] = [];
    let transitions = 0;

    for (const cell of allCells()) {
      const realization = realize(cell);
      if (realization.status !== 'realized') continue;
      const { state } = realization;
      const before = new Set(checkInvariants(state).map((violation) => violation.code));

      for (const instance of eventInstances(state)) {
        transitions++;
        const result = applyEvent(state, instance.event);
        const where = `${describeCell(cell)} :: ${instance.label}`;

        if (!result.applied) {
          if (result.state !== state) {
            failures.push(`${where} :: refused but returned a different state`);
          }
          if (result.effects.length > 0) {
            failures.push(`${where} :: refused but asked for ${result.effects.length} effect(s)`);
          }
          if (result.diagnostics.length === 0) {
            failures.push(`${where} :: refused with no diagnostic`);
          }
          continue;
        }

        for (const violation of checkInvariants(result.state)) {
          if (!before.has(violation.code)) {
            failures.push(`${where} :: introduced ${violation.code}`);
          }
        }
      }
    }

    expect(failures).toEqual([]);
    // A property that never generates a case passes vacuously; this is the
    // guard against the whole sweep quietly becoming empty.
    expect(transitions).toBeGreaterThan(150);
  });

  it('a stale generation never produces an effect (§5.4.3)', () => {
    const failures: string[] = [];

    for (const cell of allCells()) {
      const realization = realize(cell);
      if (realization.status !== 'realized') continue;
      const { state } = realization;
      const stale = state.lastGeneration + 7;

      const staleEvents: AssistantEvent[] = [
        { type: 'session-opened', generation: stale, sessionId: 'ghost' },
        { type: 'session-failed', generation: stale, message: 'ghost' },
        { type: 'stream-ended', generation: stale },
        { type: 'stream-failed', generation: stale, message: 'ghost' },
        ...FRAME_TYPES.map((type): AssistantEvent => ({ type: 'frame', generation: stale, frame: frameOf(type) })),
      ];

      for (const event of staleEvents) {
        const result = applyEvent(state, event);
        if (result.applied) failures.push(`${describeCell(cell)} :: ${event.type} applied from a stale generation`);
        if (result.effects.length) failures.push(`${describeCell(cell)} :: ${event.type} produced an effect`);
      }
    }

    expect(failures).toEqual([]);
  });

  it('a send is never a silent no-op (§5.4.4)', () => {
    for (const cell of allCells()) {
      const realization = realize(cell);
      if (realization.status !== 'realized') continue;
      const result = applyEvent(realization.state, {
        type: 'send',
        prompt: 'a real prompt',
        libraryId: null,
      });
      if (result.applied) continue;
      expect(
        result.diagnostics.some((diagnostic) => diagnostic.level === 'error'),
        `${describeCell(cell)} refused a send with no error diagnostic`
      ).toBe(true);
    }
  });

  it('abandoning a turn always asks for the abort (§7.2, §7.3)', () => {
    for (const cell of allCells()) {
      const realization = realize(cell);
      if (realization.status !== 'realized') continue;
      const { state } = realization;
      const result = applyEvent(state, { type: 'new-session' });

      expect(result.applied).toBe(true);
      expect(result.state.liveGeneration).toBeNull();
      expect(result.state.session.turns).toEqual([]);

      const aborts = result.effects.filter((effect) => effect.type === 'abort');
      // Exactly when there was something to abort, and never for a generation
      // that is not the one in flight.
      expect(aborts.length).toBe(state.liveGeneration === null ? 0 : 1);
      if (state.liveGeneration !== null) {
        expect(aborts[0]).toEqual({ type: 'abort', generation: state.liveGeneration });
      }
    }
  });

  it('stopping is offered for the whole of `sending`, and always lands', () => {
    // The stop button is on screen from `send` onwards, so both in-flight
    // states have to accept it. They differ in what stopping means: with a
    // session open the server ends the stream and the partial answer survives;
    // without one there is nothing to end, so the request is dropped here.
    for (const cell of allCells()) {
      const realization = realize(cell);
      if (realization.status !== 'realized') continue;
      const { state } = realization;
      if (state.status !== 'opening' && state.status !== 'streaming') continue;

      const result = applyEvent(state, { type: 'interrupt' });
      expect(result.applied, describeCell(cell)).toBe(true);

      if (state.status === 'streaming') {
        expect(result.effects, describeCell(cell)).toContainEqual({
          type: 'interrupt-session',
          sessionId: state.session.id,
        });
      } else {
        expect(result.state.status, describeCell(cell)).toBe('idle');
        expect(result.state.liveGeneration, describeCell(cell)).toBeNull();
        expect(result.state.lastError, describeCell(cell)).toBeNull();
      }
    }
  });

  it('generations are never reused, so an abandoned turn stays distinguishable', () => {
    let state = initialState();
    const seen = new Set<number>();

    for (let turn = 0; turn < 5; turn++) {
      const sent = applyEvent(state, { type: 'send', prompt: `turn ${turn}`, libraryId: null });
      expect(sent.applied).toBe(true);
      state = sent.state;
      expect(seen.has(state.lastGeneration)).toBe(false);
      seen.add(state.lastGeneration);
      state = applyEvent(state, { type: 'new-session' }).state;
    }
  });
});
