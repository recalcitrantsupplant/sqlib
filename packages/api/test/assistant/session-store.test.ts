import { describe, expect, it } from 'vitest';
import {
  createMemorySessionStore,
  trimTurns,
  type SessionStore,
} from '../../src/assistant/session-store.js';
import { createSession, type AssistantSession } from '../../src/assistant/service.js';
import type { ModelMessage } from '../../src/assistant/model.js';

/**
 * The store §6 asks for, and the four things it says the store must decide.
 */

/** A clock the test drives, so nothing here sleeps. */
function fakeClock(start = 1_000_000) {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

function seed(store: SessionStore, libraryId: string | null = null): AssistantSession {
  const session = createSession(libraryId);
  store.set(session);
  return session;
}

describe('trimTurns', () => {
  const message = (text: string): ModelMessage => ({ role: 'user', content: text });

  it('leaves a conversation under the cap alone', () => {
    const messages = [message('one'), message('two')];
    expect(trimTurns(messages, 10)).toEqual(messages);
  });

  it('drops the oldest and says how many, rather than summarising', () => {
    const messages = [message('one'), message('two'), message('three'), message('four')];
    const trimmed = trimTurns(messages, 2);

    // The marker is the whole point: history that shortened without saying so
    // reads as a model that forgot.
    expect(trimmed).toHaveLength(3);
    expect(trimmed[0]).toEqual({
      role: 'system',
      content: '[2 earlier messages dropped to stay within the session cap.]',
    });
    expect(trimmed.slice(1)).toEqual([message('three'), message('four')]);
  });

  it('counts one dropped message in the singular', () => {
    const trimmed = trimTurns([message('a'), message('b')], 1);
    expect(trimmed[0]?.content).toContain('1 earlier message dropped');
  });
});

describe('createMemorySessionStore', () => {
  it('round-trips a session and reports a miss as null', () => {
    const store = createMemorySessionStore();
    const session = seed(store);

    expect(store.get(session.id)?.id).toBe(session.id);
    expect(store.get('session-nope')).toBeNull();
  });

  it('deletes, and says whether there was anything to delete', () => {
    const store = createMemorySessionStore();
    const session = seed(store);

    expect(store.delete(session.id)).toBe(true);
    expect(store.delete(session.id)).toBe(false);
    expect(store.get(session.id)).toBeNull();
  });

  it('enumerates, because session history will need it', () => {
    const store = createMemorySessionStore();
    const first = seed(store, 'urn:lib:1');
    const second = seed(store, 'urn:lib:2');

    expect(store.list().map((session) => session.id).sort()).toEqual([first.id, second.id].sort());
  });

  it('evicts a session left idle past its TTL', () => {
    const clock = fakeClock();
    const store = createMemorySessionStore({ ttlMs: 1000, now: clock.now });
    const session = seed(store);

    clock.advance(1001);
    expect(store.get(session.id)).toBeNull();
  });

  it('measures idleness, not age, so a session in use survives', () => {
    const clock = fakeClock();
    const store = createMemorySessionStore({ ttlMs: 1000, now: clock.now });
    const session = seed(store);

    // Used just under the TTL, three times over: total age is past it.
    for (let i = 0; i < 3; i += 1) {
      clock.advance(900);
      expect(store.get(session.id)?.id).toBe(session.id);
    }

    clock.advance(1001);
    expect(store.get(session.id)).toBeNull();
  });

  it('touch keeps a session alive without reading it', () => {
    const clock = fakeClock();
    const store = createMemorySessionStore({ ttlMs: 1000, now: clock.now });
    const session = seed(store);

    clock.advance(900);
    store.touch(session.id);
    clock.advance(900);

    expect(store.get(session.id)?.id).toBe(session.id);
  });

  it('never evicts a running session', () => {
    const clock = fakeClock();
    const store = createMemorySessionStore({ ttlMs: 1000, now: clock.now });
    const session = seed(store);

    /*
     * `running` means an AbortController is live and a turn is mid-flight.
     * Evicting it would strand the turn and lose the drafts it had staged, so
     * the TTL does not apply while it is true — §6 makes this unconditional.
     */
    session.running = true;
    session.abort = new AbortController();
    clock.advance(10_000);

    expect(store.get(session.id)?.id).toBe(session.id);

    // ...and it becomes evictable again the moment the turn ends.
    session.running = false;
    clock.advance(10_000);
    expect(store.get(session.id)).toBeNull();
  });

  it('keeps a session whose history is being trimmed', () => {
    const store = createMemorySessionStore({ turnCap: 2 });
    const session = seed(store);
    session.messages = [
      { role: 'user', content: 'one' },
      { role: 'user', content: 'two' },
      { role: 'user', content: 'three' },
    ];

    const read = store.get(session.id);
    expect(read?.messages).toHaveLength(3); // 2 kept + the marker
    expect(String(read?.messages[0]?.content)).toContain('dropped');
  });

  it('treats a zero TTL as no expiry rather than instant expiry', () => {
    const clock = fakeClock();
    const store = createMemorySessionStore({ ttlMs: 0, now: clock.now });
    const session = seed(store);

    clock.advance(10_000_000);
    expect(store.get(session.id)?.id).toBe(session.id);
  });
});
