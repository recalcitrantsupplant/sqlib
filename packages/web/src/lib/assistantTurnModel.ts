/**
 * The assistant turn as a value, and the transitions over it.
 *
 * `useAssistantSession` used to be a state machine written in `await`: the
 * turn's whole lifecycle lived inside one async function, so "what happens if
 * the user starts a new session while this is streaming" had no answer you
 * could read, only one you could observe. Four defects lived in that gap.
 *
 * The shape here is the one `queryGroupCommands.ts` already proved: a plain
 * state value, transitions that are pure functions, and effects returned as
 * data rather than performed. Two additions the canvas did not need, because
 * the canvas has no asynchrony:
 *
 * - **Resolutions are events, not returns.** The transport does not `await`
 *   into the model; it feeds `frame`, `stream-ended`, `stream-failed` back in.
 * - **Every transport event carries the generation it was issued under.** A
 *   generation that is no longer live is refused, so an abandoned turn cannot
 *   write drafts, append tokens, or free the composer. That single rule is
 *   what an actor runtime's "the invocation stops when the state exits" buys,
 *   and it is the whole of the cancellation story.
 *
 * The command contract is the canvas's, unchanged: a refused transition
 * returns the *same state object* and at least one error diagnostic, and an
 * applied one adds no invariant violation the state did not already have.
 */
import type { ScreenContext } from './assistantScreenContext';

export type { ScreenContext } from './assistantScreenContext';

export type TurnStatus = 'idle' | 'opening' | 'streaming' | 'failed';

export interface ToolReceiptArtifact {
  type: 'query' | 'group' | 'ruleset';
  name: string;
  /** Null means the write landed as a draft. */
  version: number | null;
}

export interface ToolReceipt {
  tool: string;
  /** Consecutive calls of one tool collapse into one receipt (Build design §4). */
  callCount: number;
  status: 'ok' | 'error';
  error?: string;
  artifacts: ToolReceiptArtifact[];
}

export interface AssistantTurn {
  role: 'user' | 'assistant';
  text: string;
  receipts?: ToolReceipt[];
}

export interface AssistantSession {
  id: string;
  name: string;
  turns: AssistantTurn[];
}

/** The staged draft a `changed` frame carries. Mirrors the server's shape. */
export interface StagedDraft {
  id: string;
  kind: 'draft' | 'scratch';
  section: 'query';
  name: string;
  description: string | null;
  body: string;
  basedOn: string | null;
  libraryId: string;
  createdAt: string;
  updatedAt: string;
}

export type ServerFrame =
  | { type: 'token'; text: string }
  | { type: 'receipt'; tool: string; status: 'ok' | 'error'; error?: string; artifacts?: ToolReceiptArtifact[] }
  | { type: 'changed'; draft: StagedDraft }
  | { type: 'discarded'; draftId: string }
  | { type: 'done'; reason: string; message?: string };

export interface AssistantTurnState {
  session: AssistantSession;
  status: TurnStatus;
  /**
   * The turn the transport may still speak for. Null when nothing is live,
   * which is exactly when `status` is `idle` or `failed` (invariant I1).
   */
  liveGeneration: number | null;
  /** Monotonic; never reused, so a stale event can always be told apart. */
  lastGeneration: number;
  lastError: string | null;
  /** Entity ids touched this turn, for the one refresh at the end of it. */
  changedIds: string[];
  /** Set by a `done` frame. Frames after it are refused (§7.6). */
  completed: boolean;
  /** The library the live turn was started against. */
  libraryId: string | null;
  /**
   * What the screen said when the live turn was sent (#128 item 2).
   *
   * Held on the state for one reason: `post-prompt` is emitted at
   * `session-opened`, a round trip after `send`, and the effect has to carry
   * what the user was looking at when they pressed send rather than what they
   * are looking at now. Cleared with everything else by `new-session`.
   */
  screenContext: ScreenContext | null;
}

export type AssistantEvent =
  | { type: 'send'; prompt: string; libraryId: string | null; screenContext?: ScreenContext | null }
  | { type: 'session-opened'; generation: number; sessionId: string }
  | { type: 'session-failed'; generation: number; message: string }
  | { type: 'frame'; generation: number; frame: ServerFrame }
  | { type: 'stream-ended'; generation: number }
  | { type: 'stream-failed'; generation: number; message: string }
  | { type: 'interrupt' }
  | { type: 'new-session' };

export type AssistantEffect =
  | { type: 'open-session'; generation: number; libraryId: string | null }
  | {
      type: 'post-prompt';
      generation: number;
      sessionId: string;
      prompt: string;
      screenContext: ScreenContext | null;
    }
  | { type: 'abort'; generation: number }
  | { type: 'interrupt-session'; sessionId: string }
  | { type: 'save-draft'; draft: StagedDraft }
  | { type: 'remove-draft'; draftId: string };

export interface Diagnostic {
  level: 'error' | 'warning' | 'info';
  code: string;
  message: string;
}

export interface TransitionResult {
  state: AssistantTurnState;
  effects: AssistantEffect[];
  diagnostics: Diagnostic[];
  /** False when a precondition failed: `state` is the input, untouched. */
  applied: boolean;
}

export const ASSISTANT_EVENT_TYPES = [
  'send',
  'session-opened',
  'session-failed',
  'frame',
  'stream-ended',
  'stream-failed',
  'interrupt',
  'new-session',
] as const;

export const TURN_STATUSES: readonly TurnStatus[] = ['idle', 'opening', 'streaming', 'failed'];

/**
 * Which events a status accepts at all, as data.
 *
 * The reducer's guards are the fine grain — a live generation, a turn already
 * completed — but the coarse legality is a table, so "what can happen from
 * here" is something you read rather than derive by running the matrix. Same
 * move as `phase2/harness/legality-expectations.ts`, one layer up.
 */
export const ASSISTANT_TRANSITIONS: Record<TurnStatus, Record<string, boolean>> = {
  idle: {
    send: true,
    'session-opened': false,
    'session-failed': false,
    frame: false,
    'stream-ended': false,
    'stream-failed': false,
    interrupt: false,
    'new-session': true,
  },
  failed: {
    send: true,
    'session-opened': false,
    'session-failed': false,
    frame: false,
    'stream-ended': false,
    'stream-failed': false,
    interrupt: false,
    'new-session': true,
  },
  opening: {
    send: false,
    'session-opened': true,
    'session-failed': true,
    frame: false,
    'stream-ended': false,
    'stream-failed': true,
    // The stop button is on screen for the whole of `sending`, which includes
    // this state. Refusing it here would put an error on a button the user was
    // invited to press.
    interrupt: true,
    'new-session': true,
  },
  streaming: {
    send: false,
    'session-opened': false,
    'session-failed': false,
    frame: true,
    'stream-ended': true,
    'stream-failed': true,
    interrupt: true,
    'new-session': true,
  },
};

export function emptySession(): AssistantSession {
  return { id: '', name: 'New session', turns: [] };
}

export function initialState(): AssistantTurnState {
  return {
    session: emptySession(),
    status: 'idle',
    liveGeneration: null,
    lastGeneration: 0,
    lastError: null,
    changedIds: [],
    completed: false,
    libraryId: null,
    screenContext: null,
  };
}

const refuse = (
  state: AssistantTurnState,
  code: string,
  message: string
): TransitionResult => ({
  state,
  effects: [],
  diagnostics: [{ level: 'error', code, message }],
  applied: false,
});

/**
 * A refusal the user has no business seeing.
 *
 * A stale frame is the *expected* outcome of abandoning a turn, not a fault.
 * It still refuses — nothing is applied, and the matrix checks the state is
 * untouched — but at `info`, so the interpreter does not turn every abandoned
 * turn into an error banner.
 */
const ignore = (
  state: AssistantTurnState,
  code: string,
  message: string
): TransitionResult => ({
  state,
  effects: [],
  diagnostics: [{ level: 'info', code, message }],
  applied: false,
});

const withTurns = (state: AssistantTurnState, turns: AssistantTurn[]): AssistantTurnState => ({
  ...state,
  session: { ...state.session, turns },
});

function patchLastTurn(
  state: AssistantTurnState,
  patch: (turn: AssistantTurn) => AssistantTurn
): AssistantTurnState {
  const turns = [...state.session.turns];
  const last = turns.at(-1);
  if (!last) return state;
  turns[turns.length - 1] = patch(last);
  return withTurns(state, turns);
}

/**
 * Drop a trailing assistant turn that never received anything.
 *
 * An empty bubble beside an error message reads as "the assistant answered
 * with silence", which is worse than no bubble: it is the failure mode the
 * error banner exists to prevent, rendered right next to the banner.
 */
function dropEmptyTrailingTurn(state: AssistantTurnState): AssistantTurnState {
  const last = state.session.turns.at(-1);
  if (!last || last.role !== 'assistant') return state;
  if (last.text.trim() || (last.receipts?.length ?? 0) > 0) return state;
  return withTurns(state, state.session.turns.slice(0, -1));
}

/**
 * Fold a receipt into the list, collapsing a repeat of the tool just seen.
 *
 * The Build design (§4) asks for `create_query ×3`, not three identical cards.
 * Only *consecutive* same-tool, same-status receipts merge: a tool that runs,
 * then another, then the first again is three things that happened in an
 * order, and flattening that would misreport the turn.
 */
function foldReceipt(receipts: ToolReceipt[], incoming: ToolReceipt): ToolReceipt[] {
  const previous = receipts.at(-1);
  if (previous && previous.tool === incoming.tool && previous.status === incoming.status) {
    const merged: ToolReceipt = {
      ...previous,
      callCount: previous.callCount + incoming.callCount,
      artifacts: [...previous.artifacts, ...incoming.artifacts],
    };
    return [...receipts.slice(0, -1), merged];
  }
  return [...receipts, incoming];
}

function applyFrame(state: AssistantTurnState, frame: ServerFrame): TransitionResult {
  switch (frame.type) {
    case 'token':
      return {
        state: patchLastTurn(state, (turn) => ({ ...turn, text: turn.text + frame.text })),
        effects: [],
        diagnostics: [],
        applied: true,
      };

    case 'receipt':
      return {
        state: patchLastTurn(state, (turn) => ({
          ...turn,
          receipts: foldReceipt(turn.receipts ?? [], {
            tool: frame.tool,
            callCount: 1,
            status: frame.status,
            error: frame.error,
            artifacts: frame.artifacts ?? [],
          }),
        })),
        effects: [],
        diagnostics: [],
        applied: true,
      };

    case 'changed':
      return {
        state: {
          ...state,
          changedIds: frame.draft.basedOn && !state.changedIds.includes(frame.draft.basedOn)
            ? [...state.changedIds, frame.draft.basedOn]
            : state.changedIds,
        },
        effects: [{ type: 'save-draft', draft: frame.draft }],
        diagnostics: [],
        applied: true,
      };

    case 'discarded':
      return {
        state,
        effects: [{ type: 'remove-draft', draftId: frame.draftId }],
        diagnostics: [],
        applied: true,
      };

    case 'done':
      return {
        state: {
          ...state,
          completed: true,
          // A cap or an interrupt is the user's business — silence here is the
          // failure mode where the assistant appears to stop mid-thought.
          lastError: frame.reason === 'complete'
            ? state.lastError
            : (frame.message ?? `The turn ended: ${frame.reason}.`),
        },
        effects: [],
        diagnostics: [],
        applied: true,
      };

    default:
      return refuse(state, 'frame-unknown', 'Unrecognised frame type.');
  }
}

/**
 * Land a live turn: nothing may speak for it afterwards.
 *
 * `completed` is scratch belonging to the turn in flight — it exists so frames
 * arriving after `done` can be refused — so it is cleared here rather than
 * left to describe a turn that is over. Keeping it would make "done" and "not
 * streaming" two ways of saying the same thing, and they would drift.
 */
function settle(state: AssistantTurnState, error: string | null): AssistantTurnState {
  return dropEmptyTrailingTurn({
    ...state,
    status: error ? 'failed' : 'idle',
    liveGeneration: null,
    completed: false,
    lastError: error ?? state.lastError,
  });
}

export function applyEvent(state: AssistantTurnState, event: AssistantEvent): TransitionResult {
  if (!ASSISTANT_TRANSITIONS[state.status][event.type]) {
    return refuse(
      state,
      'event-illegal-for-status',
      `${event.type} is not accepted while ${state.status}.`
    );
  }

  // Anything the transport says about a generation that is no longer live is
  // an abandoned turn talking. Refused before it can touch a draft.
  if ('generation' in event && event.generation !== state.liveGeneration) {
    return ignore(
      state,
      'generation-stale',
      `Event from generation ${event.generation}; ${state.liveGeneration ?? 'none'} is live.`
    );
  }

  switch (event.type) {
    case 'send': {
      if (!event.prompt.trim()) {
        return refuse(state, 'prompt-empty', 'Nothing to send.');
      }
      const generation = state.lastGeneration + 1;
      const turns: AssistantTurn[] = [...state.session.turns, { role: 'user', text: event.prompt }];
      return {
        state: {
          ...withTurns(state, turns),
          status: 'opening',
          liveGeneration: generation,
          lastGeneration: generation,
          lastError: null,
          changedIds: [],
          completed: false,
          libraryId: event.libraryId,
          screenContext: event.screenContext ?? null,
        },
        effects: [{ type: 'open-session', generation, libraryId: event.libraryId }],
        diagnostics: [],
        applied: true,
      };
    }

    case 'session-opened': {
      // The assistant turn appears now rather than at `send`, so a turn that
      // never opened leaves no bubble behind (§7.5).
      const turns: AssistantTurn[] = [...state.session.turns, { role: 'assistant', text: '', receipts: [] }];
      return {
        state: {
          ...state,
          session: { ...state.session, id: event.sessionId, turns },
          status: 'streaming',
        },
        effects: [
          {
            type: 'post-prompt',
            generation: event.generation,
            sessionId: event.sessionId,
            prompt: lastUserPrompt(state) ?? '',
            screenContext: state.screenContext,
          },
        ],
        diagnostics: [],
        applied: true,
      };
    }

    case 'session-failed':
      return { state: settle(state, event.message), effects: [], diagnostics: [], applied: true };

    case 'frame': {
      if (state.completed) {
        return ignore(state, 'turn-completed', 'The turn already reported done.');
      }
      return applyFrame(state, event.frame);
    }

    case 'stream-ended': {
      // A stream that stops without `done` is a dropped connection, not a
      // finished turn. Saying so is the honest client-side position until the
      // stream carries resumable event ids (design §6).
      const error = state.completed
        ? null
        : 'The connection to the assistant ended before the turn finished.';
      return { state: settle(state, error), effects: [], diagnostics: [], applied: true };
    }

    case 'stream-failed':
      // A turn that already reported `done` is finished; the server writes
      // that frame and then ends the response, so a transport error arriving
      // afterwards is the socket closing, not the turn failing. Reporting it
      // would put an error banner on a turn the user watched succeed.
      return {
        state: settle(state, state.completed ? null : event.message),
        effects: [],
        diagnostics: [],
        applied: true,
      };

    case 'interrupt': {
      if (state.status === 'streaming' && state.session.id) {
        // No abort: the server ends the stream on interrupt, and letting it
        // end gracefully is what keeps the partial answer already on screen.
        return {
          state,
          effects: [{ type: 'interrupt-session', sessionId: state.session.id }],
          diagnostics: [],
          applied: true,
        };
      }
      // Stopped before the turn had a session to stop: there is nothing for
      // the server to end, so the request is dropped here and the composer
      // comes straight back.
      const abort: AssistantEffect[] =
        state.liveGeneration === null ? [] : [{ type: 'abort', generation: state.liveGeneration }];
      return { state: settle(state, null), effects: abort, diagnostics: [], applied: true };
    }

    case 'new-session': {
      const abort: AssistantEffect[] =
        state.liveGeneration === null ? [] : [{ type: 'abort', generation: state.liveGeneration }];
      return {
        state: { ...initialState(), lastGeneration: state.lastGeneration },
        effects: abort,
        diagnostics: [],
        applied: true,
      };
    }

    default:
      return refuse(state, 'event-unknown', 'Unrecognised event.');
  }
}

function lastUserPrompt(state: AssistantTurnState): string | null {
  for (let index = state.session.turns.length - 1; index >= 0; index--) {
    const turn = state.session.turns[index];
    if (turn.role === 'user') return turn.text;
  }
  return null;
}

export interface InvariantViolation {
  code: string;
  message: string;
}

/**
 * What must be true of the session after any transition.
 *
 * These are the properties whose violation produced the §7 defects: a composer
 * locked by a turn nobody is watching, a bubble with nothing in it, a draft
 * written on behalf of a dismissed session.
 */
export function checkInvariants(state: AssistantTurnState): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const live = state.status === 'opening' || state.status === 'streaming';

  // I1. A live generation exactly while a turn is in flight.
  if (live && state.liveGeneration === null) {
    violations.push({ code: 'live-without-generation', message: `${state.status} with no live generation.` });
  }
  if (!live && state.liveGeneration !== null) {
    violations.push({ code: 'generation-without-live', message: `${state.status} still holds a live generation.` });
  }

  // I2. `done` describes the turn in flight and nothing else.
  if (state.completed && state.status !== 'streaming') {
    violations.push({ code: 'completed-without-stream', message: `completed while ${state.status}.` });
  }

  // I3. Generations are never reused.
  if (state.liveGeneration !== null && state.liveGeneration > state.lastGeneration) {
    violations.push({ code: 'generation-not-monotonic', message: 'Live generation exceeds the last issued.' });
  }

  const turns = state.session.turns;
  for (let index = 0; index < turns.length; index++) {
    const turn = turns[index];
    // I3. No assistant turn without a user turn before it.
    if (turn.role === 'assistant' && index === 0) {
      violations.push({ code: 'assistant-turn-unprompted', message: 'Session opens with an assistant turn.' });
    }
    if (turn.role === 'assistant' && turns[index - 1]?.role === 'assistant') {
      violations.push({ code: 'assistant-turn-doubled', message: `Two assistant turns at ${index}.` });
    }
  }

  // I4. No empty assistant bubble once the turn has landed.
  const last = turns.at(-1);
  if (!live && last?.role === 'assistant' && !last.text.trim() && (last.receipts?.length ?? 0) === 0) {
    violations.push({ code: 'empty-assistant-turn', message: 'A settled turn left an empty assistant bubble.' });
  }

  // I5. A receipt counts at least the call it was made from.
  for (const turn of turns) {
    for (const receipt of turn.receipts ?? []) {
      if (receipt.callCount < 1) {
        violations.push({ code: 'receipt-count-invalid', message: `${receipt.tool} has callCount ${receipt.callCount}.` });
      }
    }
  }

  return violations;
}
