/**
 * Where sessions live, behind a seam.
 *
 * §6 of the runtime plan asks for this before anything else on the persistence
 * ladder, and for one reason: an inline `Map` in the service means every later
 * rung — SQLite when history becomes real, Redis at multi-instance — is a
 * redesign of the service rather than a second implementation of this file.
 *
 * The in-memory implementation is still the right default. The deployment is
 * single-instance, and chat is explicitly not a library artifact, so nothing
 * here reaches the triplestore.
 */
import type { ModelMessage } from './model.js';
import type { AssistantSession } from './service.js';

export const DEFAULT_SESSION_TTL_MS = 60 * 60 * 1000;
export const DEFAULT_TURN_CAP = 40;

/**
 * `list()` is here even though nothing calls it yet.
 *
 * §6 rung 2 — session history — needs enumeration, and adding a method to an
 * interface after there are two implementations of it is a change to both.
 */
export interface SessionStore {
  get(id: string): AssistantSession | null;
  set(session: AssistantSession): void;
  delete(id: string): boolean;
  /** Mark a session as used, so idle eviction measures idleness rather than age. */
  touch(id: string): void;
  list(): AssistantSession[];
}

export type MemorySessionStoreOptions = {
  ttlMs?: number;
  /** Turns kept per session before the oldest are dropped. */
  turnCap?: number;
  /** Injected so tests do not sleep. Defaults to the wall clock. */
  now?: () => number;
};

/**
 * Drop the oldest turns, and say so where they were.
 *
 * §6 called "summarise or drop the oldest" a fork rather than a decision and
 * then pinned it: drop, with a marker. Summarising would need a model call
 * inside the store, and the store has no provider credential to make one with.
 *
 * The marker is a system message because it is a statement about the
 * conversation rather than a turn in it, and because a model that reads it
 * should treat it as context, not as something someone said.
 */
export function trimTurns(messages: ModelMessage[], turnCap: number): ModelMessage[] {
  if (messages.length <= turnCap) return messages;

  const dropped = messages.length - turnCap;
  const kept = messages.slice(dropped);
  return [
    {
      role: 'system',
      content: `[${dropped} earlier ${dropped === 1 ? 'message' : 'messages'} dropped to stay within the session cap.]`,
    },
    ...kept,
  ];
}

export function createMemorySessionStore(options: MemorySessionStoreOptions = {}): SessionStore {
  const ttlMs = options.ttlMs ?? DEFAULT_SESSION_TTL_MS;
  const turnCap = options.turnCap ?? DEFAULT_TURN_CAP;
  const now = options.now ?? (() => Date.now());

  const sessions = new Map<string, AssistantSession>();
  const lastUsed = new Map<string, number>();

  /*
   * Eviction runs on access rather than on a timer. A timer would keep the
   * process awake and would need tearing down in every test that builds a
   * service; sweeping when someone looks costs nothing when nobody does.
   */
  function evictIdle() {
    if (ttlMs <= 0) return;
    const cutoff = now() - ttlMs;
    for (const [id, session] of sessions) {
      // Never evict a running session: `running` means an AbortController is
      // live and a turn is mid-flight, and dropping it would strand both.
      if (session.running) continue;
      if ((lastUsed.get(id) ?? 0) <= cutoff) {
        sessions.delete(id);
        lastUsed.delete(id);
      }
    }
  }

  return {
    get(id) {
      evictIdle();
      const session = sessions.get(id);
      if (!session) return null;
      lastUsed.set(id, now());
      // Trimming on read keeps the cap enforced for a session that is being
      // used, which is the only one whose history can still grow.
      session.messages = trimTurns(session.messages, turnCap);
      return session;
    },

    set(session) {
      evictIdle();
      sessions.set(session.id, session);
      lastUsed.set(session.id, now());
    },

    delete(id) {
      lastUsed.delete(id);
      return sessions.delete(id);
    },

    touch(id) {
      if (sessions.has(id)) lastUsed.set(id, now());
    },

    list() {
      evictIdle();
      return [...sessions.values()];
    },
  };
}
