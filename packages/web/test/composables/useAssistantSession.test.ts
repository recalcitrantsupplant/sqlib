/**
 * The assistant turn, as a lifecycle rather than a happy path.
 *
 * Frames within one turn are ordered by the transport (one POST, one body), so
 * nothing here tests reordering — that is not a risk the design defends
 * against. What these test is everything around the stream: starting a second
 * turn, abandoning one, a connection that ends early, and a turn that fails
 * before it ever opens.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { nextTick } from 'vue';

import { ASSISTANT_PROVIDER_STORAGE_KEY } from '@/composables/useAssistantProvider';
import { CALLABLE_DRAFTS_STORAGE_KEY } from '@/composables/useCallableDrafts';

const encoder = new TextEncoder();

/** A stream we push frames into, the way the server writes them. */
class StreamHandle {
  private controller!: ReadableStreamDefaultController<Uint8Array>;
  readonly stream: ReadableStream<Uint8Array>;
  closed = false;

  constructor() {
    this.stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.controller = controller;
      },
    });
  }

  push(event: Record<string, unknown>) {
    // An aborted socket swallows what the server writes into it; a test that
    // threw here would be asserting on the harness rather than the client.
    if (this.closed) return;
    this.controller.enqueue(
      encoder.encode(`event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`)
    );
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.controller.close();
  }

  /** What a dropped connection looks like to the reader. */
  fail(reason = 'network error') {
    if (this.closed) return;
    this.closed = true;
    this.controller.error(new Error(reason));
  }
}

interface Harness {
  session: typeof import('@/composables/useAssistantSession');
  drafts: ReturnType<typeof import('@/composables/useCallableDrafts').useCallableDrafts>;
  streams: StreamHandle[];
  openCalls: number;
  interruptCalls: number;
  failNextOpen: boolean;
  /** The parsed body of every turn POST, so a test can assert what was sent. */
  messageBodies: Array<Record<string, unknown>>;
}

let harness: Harness;

async function setup(): Promise<Harness> {
  localStorage.setItem(
    ASSISTANT_PROVIDER_STORAGE_KEY,
    JSON.stringify({ provider: 'anthropic', model: 'claude-opus-5', apiKey: 'sk-test', baseUrl: '' })
  );
  localStorage.setItem(CALLABLE_DRAFTS_STORAGE_KEY, '[]');
  vi.resetModules();

  const state = {
    streams: [] as StreamHandle[],
    openCalls: 0,
    interruptCalls: 0,
    failNextOpen: false,
    messageBodies: [] as Array<Record<string, unknown>>,
  };

  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/assistant/sessions')) {
      state.openCalls += 1;
      if (state.failNextOpen) return { ok: false, status: 500 } as unknown as Response;
      return {
        ok: true,
        status: 201,
        json: async () => ({ id: `session-${state.openCalls}` }),
      } as unknown as Response;
    }
    if (url.includes('/interrupt')) {
      state.interruptCalls += 1;
      return { ok: true, status: 200 } as unknown as Response;
    }

    if (typeof init?.body === 'string') {
      state.messageBodies.push(JSON.parse(init.body) as Record<string, unknown>);
    }
    const handle = new StreamHandle();
    state.streams.push(handle);
    // A real fetch errors the body's reader when the signal aborts.
    init?.signal?.addEventListener('abort', () => handle.fail('aborted'));
    return { ok: true, status: 200, body: handle.stream } as unknown as Response;
  }));

  const sessionModule = await import('@/composables/useAssistantSession');
  const draftsModule = await import('@/composables/useCallableDrafts');
  const drafts = draftsModule.useCallableDrafts();
  drafts.clear();

  harness = { session: sessionModule, drafts, ...state } as Harness;
  Object.defineProperties(harness, {
    streams: { get: () => state.streams },
    openCalls: { get: () => state.openCalls },
    interruptCalls: { get: () => state.interruptCalls },
    failNextOpen: { set: (value: boolean) => { state.failNextOpen = value; }, get: () => state.failNextOpen },
    messageBodies: { get: () => state.messageBodies },
  });
  return harness;
}

/** Let the microtask queue drain so the stream loop can consume what was pushed. */
async function settle(times = 6) {
  for (let i = 0; i < times; i++) {
    await nextTick();
    await Promise.resolve();
  }
}

/** Wait until a stream has actually been opened for the pending send. */
async function streamOpened(index: number) {
  for (let i = 0; i < 60 && harness.streams.length <= index; i++) await settle(2);
  if (harness.streams.length <= index) throw new Error(`stream ${index} never opened`);
  return harness.streams[index];
}

const draftFrame = (id: string, basedOn: string | null = 'urn:sqlib:query:1') => ({
  type: 'changed',
  draft: {
    id,
    kind: 'draft',
    section: 'query',
    name: 'From the assistant',
    description: null,
    body: 'SELECT * WHERE { ?s ?p ?o }',
    basedOn,
    libraryId: 'urn:sqlib:library:1',
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
  },
});

beforeEach(async () => {
  await setup();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('assistant session lifecycle', () => {
  it('§7.2 — a new session while streaming frees the composer for the next turn', async () => {
    const { useAssistantSession } = harness.session;
    const assistant = useAssistantSession();

    const first = assistant.send('first', 'urn:sqlib:library:1');
    await streamOpened(0);
    expect(assistant.sending.value).toBe(true);

    assistant.newSession();
    await settle();

    // The abandoned stream must not hold the composer hostage.
    expect(assistant.sending.value).toBe(false);

    harness.streams[0].close();
    await first;
  });

  it('§7.3 — an abandoned turn writes no drafts', async () => {
    const { useAssistantSession } = harness.session;
    const assistant = useAssistantSession();

    const first = assistant.send('first', 'urn:sqlib:library:1');
    const stream = await streamOpened(0);

    assistant.newSession();
    await settle();

    stream.push(draftFrame('urn:ui-temp:ghost'));
    stream.push({ type: 'done', reason: 'complete' });
    stream.close();
    await first;
    await settle();

    expect(harness.drafts.get('urn:ui-temp:ghost')).toBeNull();
  });

  it('§7.4 — a prompt sent mid-turn is refused out loud, never dropped silently', async () => {
    const { useAssistantSession } = harness.session;
    const assistant = useAssistantSession();

    const first = assistant.send('first', 'urn:sqlib:library:1');
    const stream = await streamOpened(0);

    const second = await assistant.send('second', 'urn:sqlib:library:1');
    expect(second.accepted).toBe(false);
    expect(assistant.lastError.value).toBeTruthy();

    stream.push({ type: 'done', reason: 'complete' });
    stream.close();
    await first;
  });

  it('§7.5 — a turn that never opens leaves no empty assistant bubble', async () => {
    const { useAssistantSession } = harness.session;
    const assistant = useAssistantSession();
    harness.failNextOpen = true;

    await assistant.send('first', 'urn:sqlib:library:1');
    await settle();

    expect(assistant.lastError.value).toBeTruthy();
    const assistantTurns = assistant.session.value.turns.filter((turn) => turn.role === 'assistant');
    expect(assistantTurns.filter((turn) => !turn.text && !turn.receipts?.length)).toHaveLength(0);
  });

  it('§7.6 — frames after done are ignored', async () => {
    const { useAssistantSession } = harness.session;
    const assistant = useAssistantSession();

    const pending = assistant.send('first', 'urn:sqlib:library:1');
    const stream = await streamOpened(0);

    stream.push({ type: 'token', text: 'hello' });
    stream.push({ type: 'done', reason: 'complete' });
    stream.push({ type: 'token', text: ' AFTER' });
    stream.push(draftFrame('urn:ui-temp:after-done'));
    stream.close();
    await pending;
    await settle();

    const last = assistant.session.value.turns.at(-1);
    expect(last?.text).toBe('hello');
    expect(harness.drafts.get('urn:ui-temp:after-done')).toBeNull();
  });

  it('§7.7 — consecutive calls of one tool collapse into a single receipt with a count', async () => {
    const { useAssistantSession } = harness.session;
    const assistant = useAssistantSession();

    const pending = assistant.send('first', 'urn:sqlib:library:1');
    const stream = await streamOpened(0);

    stream.push({ type: 'receipt', tool: 'create_query', status: 'ok', artifacts: [{ type: 'query', name: 'A', version: null }] });
    stream.push({ type: 'receipt', tool: 'create_query', status: 'ok', artifacts: [{ type: 'query', name: 'B', version: null }] });
    stream.push({ type: 'receipt', tool: 'list_queries', status: 'ok', artifacts: [] });
    stream.push({ type: 'done', reason: 'complete' });
    stream.close();
    await pending;
    await settle();

    const receipts = assistant.session.value.turns.at(-1)?.receipts ?? [];
    expect(receipts).toHaveLength(2);
    expect(receipts[0].tool).toBe('create_query');
    expect(receipts[0].callCount).toBe(2);
    expect(receipts[0].artifacts.map((artifact) => artifact.name)).toEqual(['A', 'B']);
    expect(receipts[1].callCount).toBe(1);
  });

  it('a stream that dies mid-turn reports the failure and keeps what arrived', async () => {
    const { useAssistantSession } = harness.session;
    const assistant = useAssistantSession();

    const pending = assistant.send('first', 'urn:sqlib:library:1');
    const stream = await streamOpened(0);

    stream.push({ type: 'token', text: 'partial' });
    await settle();
    stream.fail();
    await pending;
    await settle();

    expect(assistant.sending.value).toBe(false);
    expect(assistant.lastError.value).toBeTruthy();
    expect(assistant.session.value.turns.at(-1)?.text).toBe('partial');
  });

  /**
   * The dropped-connection matrix.
   *
   * One turn's frames, truncated after every prefix. This is where the
   * receipt/row atomicity gap shows up as a fact rather than a worry: the
   * server has already executed the tool by the time the `receipt` frame goes
   * out, so a stream cut between `receipt` and `changed` leaves a receipt with
   * no draft behind it. The client cannot close that — it needs resumable
   * event ids (design §6) — so what is asserted here is the honest position:
   * the turn never claims success, the composer always comes back, and nothing
   * is written that a received frame did not ask for.
   */
  it('every truncation of a turn leaves a usable, honest state', async () => {
    const frames: Array<Record<string, unknown>> = [
      { type: 'token', text: 'working' },
      { type: 'receipt', tool: 'create_query', status: 'ok', artifacts: [{ type: 'query', name: 'A', version: null }] },
      draftFrame('urn:ui-temp:truncation'),
      { type: 'token', text: ' done' },
      { type: 'done', reason: 'complete' },
    ];

    for (let cut = 0; cut <= frames.length; cut++) {
      await setup();
      const { useAssistantSession } = harness.session;
      const assistant = useAssistantSession();

      const pending = assistant.send('first', 'urn:sqlib:library:1');
      const stream = await streamOpened(0);
      for (const frame of frames.slice(0, cut)) stream.push(frame);
      await settle();
      stream.fail('connection reset');
      await pending;
      await settle();

      const where = `cut after ${cut} frame(s)`;

      // The composer always comes back.
      expect(assistant.sending.value, where).toBe(false);

      // A turn that never reported `done` says so; a completed one does not
      // invent a failure out of the socket closing afterwards.
      const sawDone = cut >= frames.length;
      expect(Boolean(assistant.lastError.value), where).toBe(!sawDone);

      // Only what arrived was applied — never a frame the stream never sent.
      const sawDraft = cut >= 3;
      expect(Boolean(harness.drafts.get('urn:ui-temp:truncation')), where).toBe(sawDraft);

      const receipts = assistant.session.value.turns.at(-1)?.receipts ?? [];
      expect(receipts.length, where).toBe(cut >= 2 ? 1 : 0);

      // The gap this cannot close, stated as a fact rather than left implicit:
      // between the receipt and the draft, the two disagree.
      if (cut === 2) {
        expect(receipts[0].artifacts).toHaveLength(1);
        expect(harness.drafts.get('urn:ui-temp:truncation')).toBeNull();
      }
    }
  });

  it('a stream that ends without done is reported, not treated as success', async () => {
    const { useAssistantSession } = harness.session;
    const assistant = useAssistantSession();

    const pending = assistant.send('first', 'urn:sqlib:library:1');
    const stream = await streamOpened(0);
    stream.push({ type: 'token', text: 'partial' });
    stream.close();
    await pending;
    await settle();

    expect(assistant.lastError.value).toBeTruthy();
  });

  /*
   * #128 item 2. The turn carries what the sender had on screen, so the
   * assistant is not asked to guess what "it" means.
   */
  describe('the screen context', () => {
    const context = {
      screen: 'build',
      openEntity: { id: 'urn:sqlib:query:1', type: 'query', name: 'Recent orders' },
    };

    it('sends what the screen said with the turn', async () => {
      const { useAssistantSession } = harness.session;
      const assistant = useAssistantSession();

      const pending = assistant.send('why does it fail?', 'urn:sqlib:library:1', context);
      const stream = await streamOpened(0);
      stream.push({ type: 'done', reason: 'complete' });
      stream.close();
      await pending;

      // The context is committed at `send` but only posted at `session-opened`,
      // a round trip later — this is what proves it survives that gap.
      expect(harness.messageBodies).toHaveLength(1);
      expect(harness.messageBodies[0].context).toEqual(context);
      // Still the same request otherwise: the context is an addition, not a
      // reshaping of the body.
      expect(harness.messageBodies[0]).toMatchObject({ prompt: 'why does it fail?', provider: 'anthropic' });
    });

    it('omits the field entirely when the screen had nothing to say', async () => {
      const { useAssistantSession } = harness.session;
      const assistant = useAssistantSession();

      const pending = assistant.send('hello', 'urn:sqlib:library:1');
      const stream = await streamOpened(0);
      stream.push({ type: 'done', reason: 'complete' });
      stream.close();
      await pending;

      expect('context' in harness.messageBodies[0]).toBe(false);
    });

    it('does not carry one turn’s screen into the next', async () => {
      const { useAssistantSession } = harness.session;
      const assistant = useAssistantSession();

      const first = assistant.send('first', 'urn:sqlib:library:1', context);
      const firstStream = await streamOpened(0);
      firstStream.push({ type: 'done', reason: 'complete' });
      firstStream.close();
      await first;
      await settle();

      const second = assistant.send('second', 'urn:sqlib:library:1');
      const secondStream = await streamOpened(1);
      secondStream.push({ type: 'done', reason: 'complete' });
      secondStream.close();
      await second;

      expect(harness.messageBodies).toHaveLength(2);
      expect('context' in harness.messageBodies[1]).toBe(false);
    });
  });
});
