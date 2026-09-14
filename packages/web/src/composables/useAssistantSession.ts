/**
 * The assistant session the chat rail renders, and the transport under it.
 *
 * Door A: the browser posts a prompt and reads back Server-Sent Events —
 * tokens as the model produces them, a receipt per tool call, and a `changed`
 * event carrying the draft the server staged.
 *
 * The receipt is the audit trail, and its one hard rule is that it must always
 * agree with the artifact pane — a receipt that says `draft` beside a row that
 * says v3 is worse than no receipt at all. That rule is now structural rather
 * than a convention: a `changed` event carries the staged draft itself, which
 * is written into `useCallableDrafts`, which is what the rows read. The client
 * no longer infers what changed from tool names.
 *
 * What lives here and what does not: **all** decisions about the turn's
 * lifecycle are in `assistantTurnModel.ts`, as pure transitions over a state
 * value. This file is transport and an effect interpreter, nothing else. The
 * turn used to be a state machine written in `await`, which is how a new
 * session could leave the composer locked and an abandoned stream could still
 * write drafts.
 *
 * Every event fed back from the transport carries the generation it was issued
 * under, and the model refuses stale ones. Aborting is therefore belt *and*
 * braces: the `AbortController` stops the socket (which the API turns into an
 * interrupt — `api/src/routes/assistant.ts` watches the response for `close`),
 * and the generation check means anything already in flight lands harmlessly.
 */
import { computed, ref } from 'vue';
// @ts-ignore - Nuxt auto-import
import { useRuntimeConfig } from '#imports';
import { useCallableDrafts, UNASSIGNED_LIBRARY_ID } from './useCallableDrafts';
import { useAssistantProvider } from './useAssistantProvider';
import { parseSseStream } from '../lib/sse';
import { describeError } from '../lib/errors';
import {
  applyEvent,
  initialState,
  type AssistantEffect,
  type AssistantEvent,
  type AssistantTurnState,
  type ScreenContext,
  type ServerFrame,
  type StagedDraft,
} from '../lib/assistantTurnModel';

export type {
  AssistantSession,
  AssistantTurn,
  StagedDraft,
  ToolReceipt,
  ToolReceiptArtifact,
} from '../lib/assistantTurnModel';

/*
 * Module-level so every consumer sees one session, as before.
 */
const state = ref<AssistantTurnState>(initialState());
/** Live aborts, by generation. Only the live one is ever in here. */
const controllers = new Map<number, AbortController>();
/** Callers of `send` waiting for their generation to land, live or abandoned. */
const pending = new Map<number, Array<() => void>>();

/** Wake anyone waiting on a generation that is no longer in flight. */
function releaseSettled(live: number | null) {
  for (const [generation, waiting] of [...pending.entries()]) {
    if (generation === live) continue;
    pending.delete(generation);
    for (const resolve of waiting) resolve();
  }
}

export function useAssistantSession() {
  const config = useRuntimeConfig();
  const drafts = useCallableDrafts();
  const provider = useAssistantProvider();

  const baseUrl = String(config.public.apiBaseUrl ?? '').replace(/\/$/, '');

  /** Ready to send: a provider is configured. A session is opened on demand. */
  const connected = computed(() => provider.isConfigured.value);

  /**
   * A staged draft becomes a browser draft.
   *
   * Straight into `useCallableDrafts` — the store the sidebar dot, the header
   * pill and the Build rows already read. One store is what stops a receipt
   * and a row disagreeing, and it means an assistant-written query is editable
   * and savable by exactly the same path as a hand-written one.
   */
  function applyChanged(draft: StagedDraft) {
    drafts.save({
      id: draft.id,
      libraryId: draft.libraryId || UNASSIGNED_LIBRARY_ID,
      type: 'query',
      kind: draft.kind,
      section: draft.section,
      name: draft.name,
      description: draft.description,
      queryString: draft.body,
      body: draft.body,
      resultKind: 'BINDINGS',
      inputTuples: [],
      limitParameters: [],
      offsetParameters: [],
      outputs: [],
      basedOn: draft.basedOn,
      createdAt: draft.createdAt,
    });
  }

  /**
   * One transition, then its effects.
   *
   * Effects are performed after the state has been committed, so a handler
   * that dispatches again (a failure landing mid-stream, say) sees the state
   * its own event produced rather than the one before it.
   */
  function dispatch(event: AssistantEvent): boolean {
    const result = applyEvent(state.value, event);
    if (!result.applied) {
      // An `info` refusal is the expected shape of an abandoned turn's
      // leftovers; only a real error is worth putting in front of the user.
      const error = result.diagnostics.find((diagnostic) => diagnostic.level === 'error');
      if (error) state.value = { ...state.value, lastError: error.message };
      return false;
    }
    state.value = result.state;
    releaseSettled(result.state.liveGeneration);
    for (const effect of result.effects) void perform(effect);
    return true;
  }

  async function perform(effect: AssistantEffect): Promise<void> {
    switch (effect.type) {
      case 'open-session':
        return openSession(effect.generation, effect.libraryId);
      case 'post-prompt':
        return postPrompt(effect.generation, effect.sessionId, effect.prompt, effect.screenContext);
      case 'abort': {
        controllers.get(effect.generation)?.abort();
        controllers.delete(effect.generation);
        return;
      }
      case 'interrupt-session': {
        await fetch(`${baseUrl}/assistant/sessions/${encodeURIComponent(effect.sessionId)}/interrupt`, {
          method: 'POST',
        }).catch(() => {
          // Best effort: the stream ending is what actually stops the turn.
        });
        return;
      }
      case 'save-draft':
        applyChanged(effect.draft);
        return;
      case 'remove-draft':
        drafts.remove(effect.draftId);
        return;
    }
  }

  async function openSession(generation: number, libraryId: string | null): Promise<void> {
    // An established session is reused; only the first turn opens one.
    const existing = state.value.session.id;
    if (existing) {
      dispatch({ type: 'session-opened', generation, sessionId: existing });
      return;
    }
    try {
      const response = await fetch(`${baseUrl}/assistant/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ libraryId }),
      });
      if (!response.ok) throw new Error(`Could not start a session (${response.status})`);
      const created = (await response.json()) as { id: string };
      dispatch({ type: 'session-opened', generation, sessionId: created.id });
    } catch (error) {
      console.error('[assistant] the session could not be opened', error);
      dispatch({ type: 'session-failed', generation, message: describeError(error) });
    }
  }

  async function postPrompt(
    generation: number,
    sessionId: string,
    prompt: string,
    screenContext: ScreenContext | null
  ): Promise<void> {
    const credentials = provider.credentials.value;
    if (!credentials) {
      dispatch({ type: 'stream-failed', generation, message: 'No model provider is configured.' });
      return;
    }

    const controller = new AbortController();
    controllers.set(generation, controller);

    try {
      const response = await fetch(
        `${baseUrl}/assistant/sessions/${encodeURIComponent(sessionId)}/messages`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          // `context` is omitted rather than sent as null when the screen had
          // nothing to say, so a turn with no context is byte-identical to one
          // sent before screen context existed.
          body: JSON.stringify({ prompt, ...credentials, ...(screenContext ? { context: screenContext } : {}) }),
          signal: controller.signal,
        }
      );

      if (!response.ok || !response.body) {
        const detail = response.ok ? 'no response body' : `${response.status}`;
        throw new Error(`The assistant could not start that turn (${detail}).`);
      }

      for await (const raw of parseSseStream(response.body)) {
        dispatch({ type: 'frame', generation, frame: raw as unknown as ServerFrame });
      }
      dispatch({ type: 'stream-ended', generation });
    } catch (error) {
      // An abort is this client's own doing — the model has already moved on,
      // and reporting it would put an error banner on a turn the user
      // deliberately walked away from.
      if (controller.signal.aborted) return;
      // The raw value goes to the console because `describeError` is lossy by
      // design: whatever it could not read is still worth having when someone
      // comes to debug this from a screenshot.
      console.error('[assistant] the turn failed', error);
      dispatch({ type: 'stream-failed', generation, message: describeError(error) });
    } finally {
      controllers.delete(generation);
    }
  }

  function newSession() {
    dispatch({ type: 'new-session' });
  }

  /**
   * Send a prompt and wait for the turn to land.
   *
   * Returns whether the prompt was accepted, and the ids touched, so the
   * caller can refresh once at the end rather than after every tool call — the
   * per-turn batching the 2026-02-22 sync design asks for, and the reason it
   * asks: fewer requests, less flicker, and one "changes applied" moment
   * instead of several.
   *
   * `accepted: false` is a refusal with a reason in `lastError`, never a
   * silent no-op: the composer has already been cleared by the time this
   * returns, so a dropped prompt is a lost message.
   *
   * `screenContext` is what the caller has on screen (#128 item 2), snapshotted
   * here at send rather than read again when the request goes out: the user
   * pressed send while looking at something, and that is the something the
   * assistant should be told about.
   */
  async function send(
    prompt: string,
    libraryId: string | null,
    screenContext: ScreenContext | null = null
  ): Promise<{ accepted: boolean; changedIds: string[] }> {
    if (!dispatch({ type: 'send', prompt, libraryId, screenContext })) {
      return { accepted: false, changedIds: [] };
    }
    const generation = state.value.lastGeneration;

    // The turn is driven by events from here; this waits for it to land so the
    // caller can refresh afterwards.
    await settled(generation);
    return {
      accepted: true,
      // A turn that was abandoned rather than finished has no changes to
      // report: the session it belonged to is gone.
      changedIds: state.value.lastGeneration === generation ? [...state.value.changedIds] : [],
    };
  }

  /** Resolves once the given generation is no longer the live one. */
  function settled(generation: number): Promise<void> {
    if (state.value.liveGeneration !== generation) return Promise.resolve();
    return new Promise((resolve) => {
      const waiting = pending.get(generation) ?? [];
      waiting.push(resolve);
      pending.set(generation, waiting);
    });
  }

  function interrupt() {
    dispatch({ type: 'interrupt' });
  }

  return {
    session: computed(() => state.value.session),
    connected,
    sending: computed(() => state.value.status === 'opening' || state.value.status === 'streaming'),
    lastError: computed(() => state.value.lastError),
    newSession,
    send,
    interrupt,
    /** The model's view, for specs that assert on the lifecycle rather than the chat. */
    turnState: computed(() => state.value),
  };
}
