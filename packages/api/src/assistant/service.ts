/**
 * The turn loop: prompt in, a stream of tokens, receipts and `changed` out.
 *
 * This is door A's entire cost over door B (plan §1). Everything it calls —
 * the tool registry, the API routes — is shared with the MCP door; what lives
 * here is the loop, the session, and the caps that stop a runaway.
 *
 * The design property worth protecting is in §3 of the plan: **the server
 * knows what it wrote**. A draft tool returns a concrete draft id, so the
 * `changed` event is a fact this service holds rather than something the
 * browser inferred by reading tool names. That is what lets the client delete
 * its inference layer.
 */
import { randomUUID } from 'node:crypto';
import { ToolValidationError, schemaFragmentForErrors, type ToolRegistry } from '@sparql-query-lib/tools';
import {
  DRAFT_TOOL_DEFINITIONS,
  DRAFT_TOOL_NAMES,
  callDraftTool,
  createDraftStore,
  type DraftStore,
  type StagedDraft,
} from './draft-tools.js';
import type { ModelClient, ModelMessage, ModelTool } from './model.js';
import {
  RESULT_TOOL_DEFINITIONS,
  RESULT_TOOL_NAMES,
  pageStoredResult,
  shapeResultText,
  type ResultShapingCaps,
  type StoredResult,
} from './result-shaping.js';
import { renderScreenContext, type ScreenContext } from './screen-context.js';
import { createMemorySessionStore, type SessionStore } from './session-store.js';
import {
  ENABLE_TOOLS_TOOL_NAME,
  createTurnToolSelection,
  type TurnToolSelection,
} from './tool-narrowing.js';

export const DEFAULT_STEP_CAP = 12;
export const DEFAULT_TOKEN_CAP = 120_000;
/**
 * How many consecutive rounds of "every tool call this round failed ajv
 * validation" get a retry without spending a step. Bounded separately from
 * `DEFAULT_STEP_CAP` so a model stuck sending the same malformed arguments
 * cannot loop forever on someone else's dime — once exhausted, a validation
 * failure costs a step like any other error.
 */
export const DEFAULT_REPAIR_CAP = 3;

export type AssistantSession = {
  id: string;
  createdAt: string;
  /**
   * The principal that opened it, so a session can be answered for rather than
   * merely found. Null means nobody opened it through a route — a service
   * built directly in a test — which no authenticated caller can match, so the
   * default is the closed one.
   */
  owner: string | null;
  libraryId: string | null;
  messages: ModelMessage[];
  drafts: DraftStore;
  /** Truncated tool results, keyed by the `resultId` the truncation note names. */
  results: Map<string, StoredResult>;
  /** Set while a turn is running, so a second turn is refused rather than interleaved. */
  running: boolean;
  abort: AbortController | null;
};

export type ToolReceiptArtifact = {
  type: 'query' | 'group' | 'ruleset';
  name: string;
  /** Null means the write landed as a draft. */
  version: number | null;
};

/** What the browser is told, one event at a time. */
export type AssistantEvent =
  | { type: 'token'; text: string }
  | {
      type: 'receipt';
      tool: string;
      status: 'ok' | 'error';
      error?: string;
      artifacts: ToolReceiptArtifact[];
    }
  | { type: 'changed'; draft: StagedDraft }
  | { type: 'discarded'; draftId: string }
  | { type: 'done'; reason: 'complete' | 'step-cap' | 'token-cap' | 'interrupted' | 'error'; message?: string };

export type AssistantServiceOptions = {
  registry: ToolRegistry;
  /**
   * Runs a read-only body for `drafts.runQuery`.
   *
   * Takes the caller's bearer token for the same reason `callTool` does: it
   * reaches `/sparql`, and running it as nobody would reintroduce the door-A /
   * door-B asymmetry one level down.
   */
  runSparql: (input: {
    query: string;
    backendId: string;
    authorization?: string;
  }) => Promise<{ text: string }>;
  systemPrompt?: string;
  stepCap?: number;
  tokenCap?: number;
  /** Caps a single tool result before it reaches the model; the rest waits behind `results.more`. */
  resultCaps?: ResultShapingCaps;
  repairCap?: number;
  /** Defaults to an in-memory store. The seam §6 asks for, so persistence is a swap. */
  sessions?: SessionStore;
};

const DEFAULT_SYSTEM_PROMPT = `You help someone build a library of reusable SPARQL queries.

You can read everything in their library and run saved queries. You cannot
write to the server: your writes stage as drafts with the drafts.* tools, and
the person you are helping saves them with a button you do not have. Say
"staged as a draft", never "saved".

Before claiming a query works, run it with drafts.runQuery. Before stating what
a query takes or returns, use detection.detectInputs and detection.detectOutputs
rather than guessing.`;

export function createSession(libraryId: string | null, owner: string | null = null): AssistantSession {
  return {
    id: `session-${randomUUID()}`,
    createdAt: new Date().toISOString(),
    owner,
    libraryId,
    messages: [],
    drafts: createDraftStore(),
    results: new Map(),
    running: false,
    abort: null,
  };
}

/**
 * The tool block sent with one step.
 *
 * Rebuilt per step rather than per turn because that is the property door A
 * has and door B does not (#128 item 1): a group the model enables at step
 * three is in its list at step four. The draft tools are never narrowed — they
 * are how the assistant writes anything at all, on any screen.
 */
function toolsFor(registry: ToolRegistry, selection: TurnToolSelection): ModelTool[] {
  return [
    ...registry
      .listTools()
      .filter((tool) => selection.includes(tool.name))
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    ...DRAFT_TOOL_DEFINITIONS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
    ...RESULT_TOOL_DEFINITIONS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
    ...selection.extraTools(),
  ];
}

/**
 * A receipt's artifacts come from what the tool actually did, not from its
 * name. A staged draft carries `version: null` because that is what the row
 * beside it will say, and a receipt that disagreed with the row would be worse
 * than no receipt at all.
 */
function artifactsFor(draft: StagedDraft | undefined): ToolReceiptArtifact[] {
  if (!draft) return [];
  return [{ type: 'query', name: draft.name, version: null }];
}

/**
 * A key stable under property order, so two structurally identical argument
 * objects memoise to the same entry regardless of which order the model
 * happened to emit their keys in.
 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

/**
 * Read memoisation for the catalogue tools called within one turn (plan §13
 * item 6, issue #128).
 *
 * Only read-only calls are memoised — a read is something the model can ask
 * for more than once in the same handful of steps, grounding itself again
 * after a tool result scrolled out of what it is attending to, say. Keyed on
 * tool name plus arguments and scoped to a single turn: a turn is a dozen
 * steps and a few seconds, so the staleness window this trades away is
 * negligible.
 *
 * A write invalidates the whole cache rather than reasoning about which
 * entries it could have affected — a staged draft's `changed`/`removed`, or
 * any registry tool the definitions do not mark read-only, is exactly the
 * point past which a stale read (a list that doesn't yet mention the new
 * draft's basis, say) is no longer safe to hand back.
 */
function createReadCache() {
  const entries = new Map<string, string>();
  return {
    get(name: string, args: Record<string, unknown>): string | undefined {
      return entries.get(`${name} ${stableStringify(args)}`);
    },
    set(name: string, args: Record<string, unknown>, text: string): void {
      entries.set(`${name} ${stableStringify(args)}`, text);
    },
    invalidate(): void {
      entries.clear();
    },
  };
}

type ReadCache = ReturnType<typeof createReadCache>;

/** The draft tools that only read — the rest stage a write into the session. */
const READ_ONLY_DRAFT_TOOL_NAMES = new Set(['drafts.list', 'drafts.runQuery']);

/** What one tool call produced, before it is applied to the session in order. */
type ToolCallOutcome = {
  message: ModelMessage;
  events: AssistantEvent[];
  /**
   * True only when the call failed ajv validation. The turn loop reads this
   * across a whole round to decide whether the next one is a free repair, so
   * it has to survive the trip out of a concurrent batch rather than being
   * decided where the error is caught.
   */
  validationError?: boolean;
};

/**
 * Call a registry tool and bound what comes back before the model ever sees
 * it. The full result stays available under the minted id — only stashed when
 * shaping actually cut something, so a session's memory grows with truncated
 * results, not with every read it made.
 */
async function callAndShape(
  call: { name: string; arguments: Record<string, unknown> },
  session: AssistantSession,
  options: AssistantServiceOptions,
  resultCaps: ResultShapingCaps,
  authorization?: string
): Promise<string> {
  const result = await options.registry.callTool(call.name, call.arguments, authorization);
  const resultId = randomUUID();
  const shaped = shapeResultText(result.text, resultId, resultCaps);
  if (shaped.truncated) session.results.set(resultId, { text: result.text });
  return shaped.text;
}

/**
 * Run a single tool call and turn its result (or failure) into the message and
 * events the turn loop applies to the session — but does not apply them
 * itself, so a batch of these can run concurrently and still land in the
 * order the model asked for them.
 */
async function runOneToolCall(
  call: { id: string; name: string; arguments: Record<string, unknown> },
  session: AssistantSession,
  options: AssistantServiceOptions,
  readCache: ReadCache,
  isReadOnlyTool: (name: string) => boolean,
  selection: TurnToolSelection,
  resultCaps: ResultShapingCaps,
  authorization?: string
): Promise<ToolCallOutcome> {
  try {
    let text: string;
    let changed: StagedDraft | undefined;
    let removed: string | undefined;

    if (call.name === ENABLE_TOOLS_TOOL_NAME) {
      /*
       * Widening the turn's own tool list touches no data, so nothing cached
       * this turn goes stale — this is the one non-read tool that leaves the
       * read cache alone.
       */
      text = selection.enable(call.arguments?.group);
    } else if ((RESULT_TOOL_NAMES as readonly string[]).includes(call.name)) {
      const resultId = typeof call.arguments.resultId === 'string' ? call.arguments.resultId : undefined;
      const stored = resultId ? session.results.get(resultId) : undefined;
      if (!resultId || !stored) {
        throw new Error(`results.more: no stored result with id ${resultId ?? '(missing)'}`);
      }
      text = pageStoredResult(stored, resultId, call.arguments.offset, call.arguments.limit, resultCaps);
    } else if ((DRAFT_TOOL_NAMES as readonly string[]).includes(call.name)) {
      const outcome = await callDraftTool(call.name, call.arguments, {
        drafts: session.drafts,
        libraryId: session.libraryId,
        runSparql: async (input) => {
          const result = await options.runSparql({ ...input, authorization });
          return { statusCode: 200, headers: {}, body: result.text, text: result.text };
        },
      });
      text = outcome.text;
      changed = outcome.changed;
      removed = outcome.removed;
      if (changed || removed) readCache.invalidate();
    } else if (isReadOnlyTool(call.name)) {
      const cached = readCache.get(call.name, call.arguments);
      if (cached !== undefined) {
        // The shaped text is what the model saw, and the `resultId` named in
        // its truncation note is still stored on the session, so replaying it
        // keeps `results.more` working on the cached read exactly as it did
        // on the first one.
        text = cached;
      } else {
        text = await callAndShape(call, session, options, resultCaps, authorization);
        readCache.set(call.name, call.arguments, text);
      }
    } else {
      /*
       * A registry tool that is not read-only can change what the reads
       * before it saw, so its result is never memoised and everything cached
       * so far is dropped.
       */
      text = await callAndShape(call, session, options, resultCaps, authorization);
      readCache.invalidate();
    }

    const events: AssistantEvent[] = [
      { type: 'receipt', tool: call.name, status: 'ok', artifacts: artifactsFor(changed) },
    ];
    if (changed) events.push({ type: 'changed', draft: changed });
    if (removed) events.push({ type: 'discarded', draftId: removed });

    return {
      message: { role: 'tool', toolCallId: call.id, toolName: call.name, content: text },
      events,
    };
  } catch (error) {
    /*
     * A tool failure is information for the model, not the end of the turn —
     * a mistyped argument or a 404 is something it can correct on the next
     * step. The receipt says so either way, because a failure the user
     * cannot see is a failure they will re-ask for.
     */
    const validationError = error instanceof ToolValidationError;
    /*
     * A validation failure gets extra help — the schema fragment it got
     * wrong — because it is the one failure mode a retry is expected to fix
     * outright rather than merely learn from.
     */
    const message = validationError
      ? `${error.message}\nExpected arguments: ${JSON.stringify(schemaFragmentForErrors(error.schema, error.errors))}`
      : error instanceof Error
        ? error.message
        : String(error);
    return {
      message: { role: 'tool', toolCallId: call.id, toolName: call.name, content: `Error: ${message}` },
      events: [{ type: 'receipt', tool: call.name, status: 'error', error: message, artifacts: [] }],
      validationError,
    };
  }
}

export function createAssistantService(options: AssistantServiceOptions) {
  const stepCap = options.stepCap ?? DEFAULT_STEP_CAP;
  const tokenCap = options.tokenCap ?? DEFAULT_TOKEN_CAP;
  const resultCaps = options.resultCaps ?? {};
  const repairCap = options.repairCap ?? DEFAULT_REPAIR_CAP;
  const readOnlyToolNames = new Set<string>([
    ...options.registry.definitions.filter((def) => def.readOnly).map((def) => def.name),
    ...READ_ONLY_DRAFT_TOOL_NAMES,
  ]);
  const isReadOnlyTool = (name: string) => readOnlyToolNames.has(name);
  const systemPrompt = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  const sessions = options.sessions ?? createMemorySessionStore();

  function open(libraryId: string | null, owner: string | null = null): AssistantSession {
    const session = createSession(libraryId, owner);
    sessions.set(session);
    return session;
  }

  function get(id: string): AssistantSession | null {
    return sessions.get(id);
  }

  function interrupt(id: string): boolean {
    const session = sessions.get(id);
    if (!session?.abort) return false;
    session.abort.abort();
    return true;
  }

  /**
   * Run one turn, yielding events as they happen.
   *
   * The loop is: call the model, stream its text, run whatever tools it asked
   * for, feed the results back, repeat until it stops asking — or until a cap
   * trips. Both caps end the turn with a `done` that says which one, because
   * "it just stopped" is the least useful thing a turn can do.
   *
   * `authorization` is the bearer token of whoever asked for the turn, taken
   * from the SSE request and forwarded to every tool the model reaches. It is
   * per turn rather than per session because a session outlives the request
   * that opened it, and a token captured at `open` would keep being spent long
   * after the caller's own would have expired. Without it, a tool reached
   * through the in-app assistant runs as nobody while the same tool reached
   * over `/mcp` runs under the caller's grants — see issue #127.
   *
   * `screenContext` is what the browser can see and the model cannot (issue
   * #128 item 2). Per turn, never stored on the session: the screen at step one
   * of turn three is not the screen turn one was sent from, and a stale "open
   * entity" is worse than none.
   */
  async function* runTurn(
    session: AssistantSession,
    prompt: string,
    model: ModelClient,
    authorization?: string,
    screenContext?: ScreenContext | null
  ): AsyncGenerator<AssistantEvent> {
    if (session.running) {
      yield { type: 'done', reason: 'error', message: 'This session already has a turn in flight.' };
      return;
    }

    session.running = true;
    session.abort = new AbortController();
    const signal = session.abort.signal;
    session.messages.push({ role: 'user', content: prompt });

    let tokensUsed = 0;
    let steps = 0;
    let repairsUsed = 0;
    // Set after a round whose tool calls all failed ajv validation, so the
    // *next* round — the model's retry — can be exempted from the step count
    // while repair budget remains.
    let pendingRepair = false;
    const readCache = createReadCache();
    /*
     * The turn's tool list, narrowed to what the user has open where the
     * context says (#128 item 1) and widened by `tools.enable` if the model
     * asks. Per turn, like the screen context it is derived from: the next
     * turn is sent from whatever screen the user is on then.
     */
    const toolSelection = createTurnToolSelection(screenContext);
    /*
     * Rendered once for the turn rather than per step: the screen cannot have
     * changed between two steps of one turn — the composer is locked while a
     * turn runs — and re-rendering it would only spend tokens re-describing
     * the same thing. Empty string when there is no context, so a turn sent
     * without one gets byte-identical instructions to before this existed.
     *
     * The narrowing note is fixed at the same moment and for a sharper reason:
     * the system prompt is the head of what a provider caches, so rewriting it
     * mid-turn to cross a group off would cost more than the sentence saves.
     * `tools.enable` reports what it added, and adding a group twice is
     * answered rather than repeated.
     */
    const turnSystemPrompt = `${systemPrompt}${renderScreenContext(screenContext)}${toolSelection.prompt()}`;

    try {
      while (true) {
        if (signal.aborted) {
          yield { type: 'done', reason: 'interrupted' };
          return;
        }
        // A repair round is exempt from the step cap — it is the whole point —
        // but still spends real model tokens, so the token cap still applies.
        const isRepairRound = pendingRepair && repairsUsed < repairCap;
        if (!isRepairRound && steps >= stepCap) {
          yield { type: 'done', reason: 'step-cap', message: `Stopped after ${stepCap} steps.` };
          return;
        }
        if (tokensUsed >= tokenCap) {
          yield { type: 'done', reason: 'token-cap', message: `Stopped after ${tokensUsed} tokens.` };
          return;
        }
        if (isRepairRound) {
          repairsUsed += 1;
        } else {
          steps += 1;
        }
        pendingRepair = false;

        const messages: ModelMessage[] = [{ role: 'system', content: turnSystemPrompt }, ...session.messages];
        let assistantText = '';
        const toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];

        for await (const event of model.stream({
          messages,
          tools: toolsFor(options.registry, toolSelection),
          signal,
        })) {
          if (event.type === 'text') {
            assistantText += event.text;
            yield { type: 'token', text: event.text };
          } else if (event.type === 'tool-call') {
            toolCalls.push(event.call);
          } else if (event.type === 'usage') {
            tokensUsed += event.inputTokens + event.outputTokens;
          }
        }

        session.messages.push({
          role: 'assistant',
          content: assistantText,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        });

        // No tools asked for means the model is done talking.
        if (toolCalls.length === 0) {
          yield { type: 'done', reason: 'complete' };
          return;
        }

        // Stays true only if every call this round fails ajv validation — a
        // mix with a success or a non-validation failure gets no repair credit.
        let allValidationErrors = toolCalls.length > 0;

        /*
         * Reads can run concurrently — nothing about them depends on order —
         * but a write's effect can depend on what ran before it, so a call
         * that is not read-only always runs alone. A run of consecutive
         * read-only calls batches into one `Promise.all`; a write ends the
         * batch it is in and runs by itself. Either way outcomes are applied
         * to the session, and yielded, in the order the model asked for them,
         * so wall-clock parallelism never becomes visible reordering.
         */
        let index = 0;
        while (index < toolCalls.length) {
          if (signal.aborted) {
            yield { type: 'done', reason: 'interrupted' };
            return;
          }

          let batchEnd = index + 1;
          if (isReadOnlyTool(toolCalls[index].name)) {
            while (batchEnd < toolCalls.length && isReadOnlyTool(toolCalls[batchEnd].name)) batchEnd += 1;
          }

          const batch = toolCalls.slice(index, batchEnd);
          const outcomes = await Promise.all(
            batch.map((one) =>
              runOneToolCall(
                one,
                session,
                options,
                readCache,
                isReadOnlyTool,
                toolSelection,
                resultCaps,
                authorization
              )
            )
          );
          for (const outcome of outcomes) {
            session.messages.push(outcome.message);
            for (const event of outcome.events) yield event;
            if (!outcome.validationError) allValidationErrors = false;
          }

          index = batchEnd;
        }

        pendingRepair = allValidationErrors;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      yield { type: 'done', reason: signal.aborted ? 'interrupted' : 'error', message };
    } finally {
      session.running = false;
      session.abort = null;
    }
  }

  return { open, get, interrupt, runTurn, sessions };
}

export type AssistantService = ReturnType<typeof createAssistantService>;
