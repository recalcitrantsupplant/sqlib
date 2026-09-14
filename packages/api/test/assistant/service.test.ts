import { describe, expect, it, vi } from 'vitest';
import { createAssistantService, type AssistantEvent } from '../../src/assistant/service.js';
import type { ModelClient, ModelStreamEvent, ModelRequest } from '../../src/assistant/model.js';
import { ToolValidationError, type ToolRegistry } from '@sparql-query-lib/tools';

/**
 * The turn loop, driven by a scripted model.
 *
 * No provider key and no network call anywhere in here — that is the whole
 * reason the `ModelClient` seam exists. What is asserted is the behaviour the
 * plan's §3 and §4 are about: writes stage rather than land, the server knows
 * what it wrote, and the caps actually stop something.
 */

/** A model that replays a fixed script, one array entry per model call. */
function scriptedModel(script: ModelStreamEvent[][]): ModelClient & { calls: ModelRequest[] } {
  let turn = 0;
  const calls: ModelRequest[] = [];
  return {
    modelId: 'test/scripted',
    calls,
    async *stream(request: ModelRequest) {
      calls.push(request);
      const events = script[turn] ?? [];
      turn += 1;
      for (const event of events) yield event;
    },
  };
}

function say(text: string): ModelStreamEvent[] {
  return [{ type: 'text', text }];
}

function wantsTool(name: string, args: Record<string, unknown>, id = 'call-1'): ModelStreamEvent {
  return { type: 'tool-call', call: { id, name, arguments: args } };
}

/** A model whose next events are computed when it is called, not up front. */
function dynamicModel(next: (turn: number) => ModelStreamEvent[]): ModelClient {
  let turn = 0;
  return {
    modelId: 'test/dynamic',
    async *stream() {
      const events = next(turn);
      turn += 1;
      for (const event of events) yield event;
    },
  };
}

/**
 * A catalogue entry as the registry holds one. `readOnly` is what the service
 * reads to decide both concurrency and memoisation, so a stub that leaves it
 * off is describing a write.
 */
function toolDef(name: string, readOnly: boolean) {
  return { name, description: name, readOnly, inputSchema: { type: 'object' }, buildRequest: () => ({ method: 'GET' as const, url: '/' }) };
}

function stubRegistry(overrides: Partial<ToolRegistry> = {}): ToolRegistry {
  return {
    // The assistant's allowlist is reads only (`allowlist.ts`), so the tools
    // the default stub advertises are declared the way the real ones are.
    definitions: [toolDef('queries.list', true), toolDef('queries.get', true)],
    listTools: () => [{ name: 'queries.list', description: 'List queries', inputSchema: { type: 'object' } }],
    callTool: async () => ({ statusCode: 200, headers: {}, body: [], text: '[]' }),
    ...overrides,
  } as ToolRegistry;
}

function service(overrides: Parameters<typeof createAssistantService>[0] | Partial<Parameters<typeof createAssistantService>[0]> = {}) {
  return createAssistantService({
    registry: stubRegistry(),
    runSparql: async () => ({ text: '{"results":{"bindings":[]}}' }),
    ...overrides,
  } as Parameters<typeof createAssistantService>[0]);
}

async function collect(events: AsyncGenerator<AssistantEvent>): Promise<AssistantEvent[]> {
  const out: AssistantEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

describe('assistant turn loop', () => {
  it('streams text and finishes when the model stops asking for tools', async () => {
    const assistant = service();
    const session = assistant.open('urn:lib:1');
    const model = scriptedModel([say('Hello')]);

    const events = await collect(assistant.runTurn(session, 'hi', model));

    expect(events).toEqual([
      { type: 'token', text: 'Hello' },
      { type: 'done', reason: 'complete' },
    ]);
  });

  it('offers the draft tools alongside the registry’s', async () => {
    const assistant = service();
    const session = assistant.open(null);
    const model = scriptedModel([say('ok')]);

    await collect(assistant.runTurn(session, 'hi', model));

    const offered = model.calls[0]!.tools.map((tool) => tool.name);
    expect(offered).toContain('queries.list');
    expect(offered).toContain('drafts.createQuery');
    // There is no save tool, and there must never be one: saving a version is
    // the button the human presses (plan §4). The old name is still refused so
    // the guard survives the Publish → Save rename.
    expect(offered.some((name) => /save|publish/i.test(name))).toBe(false);
  });

  it('stages a write instead of landing it, and says what it staged', async () => {
    const callTool = vi.fn();
    const assistant = service({ registry: stubRegistry({ callTool }) });
    const session = assistant.open('urn:lib:1');
    const model = scriptedModel([
      [
        { type: 'text', text: 'Staging that now.' },
        wantsTool('drafts.createQuery', { name: 'Countries', queryString: 'SELECT * WHERE { ?s ?p ?o }' }),
      ],
      say('Done — it is staged as a draft.'),
    ]);

    const events = await collect(assistant.runTurn(session, 'make me a query', model));

    // Nothing reached the API: the draft tools do not call the registry at all.
    expect(callTool).not.toHaveBeenCalled();

    const changed = events.find((event) => event.type === 'changed');
    expect(changed).toBeDefined();
    if (changed?.type !== 'changed') throw new Error('expected a changed event');
    expect(changed.draft.name).toBe('Countries');
    expect(changed.draft.kind).toBe('scratch');
    // Library-less until the save moment picks one.
    expect(changed.draft.libraryId).toBe('unassigned');
    // The service holds the id, so the browser is told a fact rather than
    // inferring one from the tool's name (plan §3).
    expect(changed.draft.id).toMatch(/^urn:ui-temp:/);

    const receipt = events.find((event) => event.type === 'receipt');
    if (receipt?.type !== 'receipt') throw new Error('expected a receipt');
    expect(receipt.status).toBe('ok');
    // version null is what the row beside it will say.
    expect(receipt.artifacts).toEqual([{ type: 'query', name: 'Countries', version: null }]);
  });

  it('marks an edit of a saved query as a draft of it', async () => {
    const assistant = service();
    const session = assistant.open('urn:lib:1');
    const model = scriptedModel([
      [
        wantsTool('drafts.createQuery', {
          name: 'Countries',
          queryString: 'SELECT ?s WHERE { ?s ?p ?o }',
          basedOn: 'urn:query:live',
        }),
      ],
      say('done'),
    ]);

    const events = await collect(assistant.runTurn(session, 'edit it', model));
    const changed = events.find((event) => event.type === 'changed');
    if (changed?.type !== 'changed') throw new Error('expected a changed event');

    expect(changed.draft.kind).toBe('draft');
    expect(changed.draft.basedOn).toBe('urn:query:live');
    // A draft of something saved inherits that library; scratch does not.
    expect(changed.draft.libraryId).toBe('urn:lib:1');
  });

  it('feeds a tool result back and keeps going', async () => {
    const callTool = vi.fn(async () => ({ statusCode: 200, headers: {}, body: [{ id: 'q1' }], text: '[{"id":"q1"}]' }));
    const assistant = service({ registry: stubRegistry({ callTool }) });
    const session = assistant.open(null);
    const model = scriptedModel([[wantsTool('queries.list', {})], say('You have one query.')]);

    const events = await collect(assistant.runTurn(session, 'what do I have?', model));

    // The third argument is the caller's bearer token, absent on this turn (#127).
    expect(callTool).toHaveBeenCalledWith('queries.list', {}, undefined);
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'complete' });
    // The result went back to the model as a tool message.
    const toolMessage = session.messages.find((message) => message.role === 'tool');
    expect(toolMessage).toMatchObject({ toolName: 'queries.list', content: '[{"id":"q1"}]' });
  });

  it('memoises a repeated read within a turn instead of calling the registry again', async () => {
    const callTool = vi.fn(async () => ({ statusCode: 200, headers: {}, body: [{ id: 'q1' }], text: '[{"id":"q1"}]' }));
    const assistant = service({ registry: stubRegistry({ callTool }) });
    const session = assistant.open(null);
    const model = scriptedModel([
      [wantsTool('queries.list', {}, 'call-1')],
      [wantsTool('queries.list', {}, 'call-2')],
      say('done'),
    ]);

    const events = await collect(assistant.runTurn(session, 'list twice', model));

    expect(callTool).toHaveBeenCalledTimes(1);
    // The model still gets a tool result for the second call — just the cached one.
    const toolMessages = session.messages.filter((message) => message.role === 'tool');
    expect(toolMessages).toHaveLength(2);
    expect(toolMessages.every((message) => message.content === '[{"id":"q1"}]')).toBe(true);
    expect(events.filter((event) => event.type === 'receipt')).toHaveLength(2);
  });

  it('does not memoise across different arguments', async () => {
    const callTool = vi.fn(async ({ id }: { id: string }) => ({
      statusCode: 200,
      headers: {},
      body: {},
      text: `"${id}"`,
    }));
    const assistant = service({ registry: stubRegistry({ callTool: (name, args) => callTool(args as { id: string }) }) });
    const session = assistant.open(null);
    const model = scriptedModel([
      [wantsTool('queries.get', { id: 'q1' }, 'call-1')],
      [wantsTool('queries.get', { id: 'q2' }, 'call-2')],
      say('done'),
    ]);

    await collect(assistant.runTurn(session, 'get two', model));

    expect(callTool).toHaveBeenCalledTimes(2);
  });

  it('invalidates the read cache once a draft is staged', async () => {
    const callTool = vi.fn(async () => ({ statusCode: 200, headers: {}, body: [], text: '[]' }));
    const assistant = service({ registry: stubRegistry({ callTool }) });
    const session = assistant.open(null);
    const model = scriptedModel([
      [wantsTool('queries.list', {}, 'call-1')],
      [wantsTool('drafts.createQuery', { name: 'X', queryString: 'SELECT * WHERE { ?s ?p ?o }' }, 'call-2')],
      [wantsTool('queries.list', {}, 'call-3')],
      say('done'),
    ]);

    await collect(assistant.runTurn(session, 'list, stage, list again', model));

    // Staging a draft between the two identical reads invalidates the cache,
    // so the second `queries.list` reaches the registry again.
    expect(callTool).toHaveBeenCalledTimes(2);
  });

  it('turns a tool failure into a receipt the model can correct from', async () => {
    const assistant = service({
      registry: stubRegistry({
        callTool: async () => {
          throw new Error('Invalid arguments for tool queries.get: id: is required');
        },
      }),
    });
    const session = assistant.open(null);
    const model = scriptedModel([[wantsTool('queries.get', {})], say('Sorry — let me try again.')]);

    const events = await collect(assistant.runTurn(session, 'get it', model));

    const receipt = events.find((event) => event.type === 'receipt');
    if (receipt?.type !== 'receipt') throw new Error('expected a receipt');
    expect(receipt.status).toBe('error');
    expect(receipt.error).toContain('id: is required');
    // The turn carries on; a bad argument is not the end of the conversation.
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'complete' });
    expect(session.messages.some((m) => m.role === 'tool' && m.content.startsWith('Error:'))).toBe(true);
  });

  describe('repairing a validation failure', () => {
    /** A registry whose `callTool` throws a `ToolValidationError` for bad args, and succeeds otherwise. */
    function validatingRegistry(isValid: (args: Record<string, unknown>) => boolean): ToolRegistry {
      return stubRegistry({
        callTool: async (name, args) => {
          if (!isValid(args)) {
            throw new ToolValidationError(
              name,
              [{ instancePath: '', message: "must have required property 'id'", params: { missingProperty: 'id' } }],
              { type: 'object', properties: { id: { type: 'string' }, verbose: { type: 'boolean' } }, required: ['id'] }
            );
          }
          return { statusCode: 200, headers: {}, body: { id: args.id }, text: JSON.stringify({ id: args.id }) };
        },
      });
    }

    it('does not spend a step on a validation retry, unlike a plain tool failure', async () => {
      const assistant = service({ registry: validatingRegistry((args) => typeof args.id === 'string'), stepCap: 2 });
      const session = assistant.open(null);
      // Bad args, then corrected args, then the model is done — three model
      // calls, but the corrected retry is free, so two steps cover it.
      const model = scriptedModel([
        [wantsTool('queries.get', {})],
        [wantsTool('queries.get', { id: 'q1' }, 'c2')],
        say('Here it is.'),
      ]);

      const events = await collect(assistant.runTurn(session, 'get it', model));

      expect(events.at(-1)).toEqual({ type: 'done', reason: 'complete' });

      // Same shape, but the tool never succeeds — a generic failure still
      // spends a step every round, so the same step cap cuts it off first.
      const strictAssistant = service({ registry: stubRegistry({ callTool: async () => { throw new Error('boom'); } }), stepCap: 2 });
      const strictSession = strictAssistant.open(null);
      const strictModel = scriptedModel([
        [wantsTool('queries.get', {})],
        [wantsTool('queries.get', { id: 'q1' }, 'c2')],
        say('Here it is.'),
      ]);
      const strictEvents = await collect(strictAssistant.runTurn(strictSession, 'get it', strictModel));
      expect(strictEvents.at(-1)).toMatchObject({ type: 'done', reason: 'step-cap' });
    });

    it('feeds the schema fragment back so the model can see the shape it got wrong', async () => {
      const assistant = service({ registry: validatingRegistry(() => false) });
      const session = assistant.open(null);
      const model = scriptedModel([[wantsTool('queries.get', {})], say('sorry')]);

      await collect(assistant.runTurn(session, 'get it', model));

      const toolMessage = session.messages.find((m) => m.role === 'tool' && m.toolName === 'queries.get');
      expect(toolMessage?.content).toContain('Expected arguments');
      expect(toolMessage?.content).toContain('"id"');
    });

    it('falls back to spending a step once the repair budget runs out', async () => {
      const assistant = service({
        registry: validatingRegistry(() => false),
        stepCap: 2,
        repairCap: 2,
      });
      const session = assistant.open(null);
      // Never sends valid args — every round is a validation failure.
      const model: ModelClient = {
        modelId: 'test/stubborn',
        async *stream() {
          yield { type: 'tool-call', call: { id: `c${Math.random()}`, name: 'queries.get', arguments: {} } };
        },
      };

      const events = await collect(assistant.runTurn(session, 'get it', model));

      // With a repair cap of 2, only the first two retries are free; after
      // that, validation failures cost a step like any other, so the step
      // cap of 2 still ends the turn deterministically.
      expect(events.at(-1)).toEqual({ type: 'done', reason: 'step-cap', message: 'Stopped after 2 steps.' });
    });

    it('grants no repair credit when only some of a round’s calls are validation failures', async () => {
      const registry = stubRegistry({
        callTool: async (name) => {
          if (name === 'queries.get') {
            throw new ToolValidationError(name, [{ message: 'bad' }], { type: 'object' });
          }
          return { statusCode: 200, headers: {}, body: [], text: '[]' };
        },
      });
      const assistant = service({ registry, stepCap: 1 });
      const session = assistant.open(null);
      // One round mixing a validation failure with a success, then (if the
      // step cap were wrongly waived for it) a final text-only round.
      const model = scriptedModel([
        [wantsTool('queries.get', {}, 'c1'), wantsTool('queries.list', {}, 'c2')],
        say('done'),
      ]);

      const events = await collect(assistant.runTurn(session, 'go', model));

      // The one step already spent on the mixed round is the whole budget, so
      // the turn stops there rather than reaching the model a second time —
      // proving the mixed round earned no repair credit.
      expect(events.at(-1)).toEqual({ type: 'done', reason: 'step-cap', message: 'Stopped after 1 steps.' });
      expect(model.calls).toHaveLength(1);
    });
  });

  it('refuses to run a draft that is an update', async () => {
    const runSparql = vi.fn(async () => ({ text: 'never' }));
    const assistant = service({ runSparql });
    const session = assistant.open(null);

    // The second call needs the id the first one minted, so the script is
    // computed per turn rather than written out in advance.
    const model = dynamicModel((turn) => {
      if (turn === 0) {
        return [wantsTool('drafts.createQuery', { name: 'Wipe', queryString: 'DELETE WHERE { ?s ?p ?o }' })];
      }
      if (turn === 1) {
        const staged = session.drafts.list()[0]!;
        return [wantsTool('drafts.runQuery', { draftId: staged.id, backendId: 'urn:backend:1' }, 'c2')];
      }
      return say('I cannot run that one.');
    });

    const events = await collect(assistant.runTurn(session, 'wipe it', model));

    // It really did try — otherwise this test would pass with runQuery never
    // called at all, which is the trap the first version of it fell into.
    const runReceipt = events.filter((e) => e.type === 'receipt').find((e) => e.type === 'receipt' && e.tool === 'drafts.runQuery');
    if (runReceipt?.type !== 'receipt') throw new Error('expected a drafts.runQuery receipt');
    expect(runReceipt.status).toBe('error');
    expect(runReceipt.error).toMatch(/refusing to run a SPARQL update/);

    // /sparql executes updates, so this is what keeps drafts.runQuery from
    // being a write channel around the draft gate.
    expect(runSparql).not.toHaveBeenCalled();
  });

  it('will not run a draft that does not parse', async () => {
    const runSparql = vi.fn(async () => ({ text: 'never' }));
    const assistant = service({ runSparql });
    const session = assistant.open(null);

    /*
     * Staging refuses this body now, so it goes into the store directly. The
     * guard in `drafts.runQuery` is defence in depth rather than the only
     * check, and it still has to hold — a draft can reach the store by a route
     * that did not parse it, and a backend is the wrong place to find out.
     */
    session.drafts.put({
      id: 'urn:ui-temp:broken',
      kind: 'scratch',
      section: 'query',
      name: 'Broken',
      description: null,
      body: 'SELECT ?s WHERE {',
      basedOn: null,
      libraryId: 'unassigned',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const model = dynamicModel((turn) => {
      if (turn === 0) {
        return [wantsTool('drafts.runQuery', { draftId: 'urn:ui-temp:broken', backendId: 'urn:backend:1' })];
      }
      return say('That does not parse yet.');
    });

    const events = await collect(assistant.runTurn(session, 'run it', model));

    // Fail closed: if we cannot tell what the body is, it does not go to a
    // backend.
    const receipt = events.filter((e) => e.type === 'receipt').find((e) => e.type === 'receipt' && e.tool === 'drafts.runQuery');
    if (receipt?.type !== 'receipt') throw new Error('expected a drafts.runQuery receipt');
    expect(receipt.status).toBe('error');
    expect(receipt.error).toMatch(/does not parse/);
    expect(runSparql).not.toHaveBeenCalled();
  });

  it('will not stage a draft that does not parse', async () => {
    const assistant = service();
    const session = assistant.open(null);

    /*
     * The observed failure: the model staged `SELECT ?item ?item dc:title`,
     * the receipt went green, and it told the user it had written them a
     * query. Nothing downstream contradicts a green receipt, so the refusal
     * has to happen where the body arrives.
     */
    const model = scriptedModel([
      [
        wantsTool('drafts.createQuery', {
          name: 'Example',
          queryString: 'PREFIX dc: <http://purl.org/dc/elements/1.1/> SELECT ?item ?item dc:title WHERE { ?item a dc:Resource .}',
        }),
      ],
      say('I will fix that.'),
    ]);

    const events = await collect(assistant.runTurn(session, 'write me an example', model));
    const receipt = events.find((event) => event.type === 'receipt');
    if (receipt?.type !== 'receipt') throw new Error('expected a receipt');

    expect(receipt.status).toBe('error');
    // The parser's own words, so the model has something it can act on.
    expect(receipt.error).toMatch(/does not parse/);
    expect(receipt.error).toMatch(/item/);

    // And nothing was staged: no row in the library claiming to be a query.
    expect(session.drafts.list()).toHaveLength(0);
    expect(events.some((event) => event.type === 'changed')).toBe(false);
  });

  it('refuses an update that would replace a body with one that does not parse', async () => {
    const assistant = service();
    const session = assistant.open(null);

    const model = dynamicModel((turn) => {
      if (turn === 0) {
        return [wantsTool('drafts.createQuery', { name: 'Good', queryString: 'SELECT ?s WHERE { ?s ?p ?o }' })];
      }
      if (turn === 1) {
        const staged = session.drafts.list()[0]!;
        return [wantsTool('drafts.updateQuery', { draftId: staged.id, queryString: 'SELECT ?s WHERE {' }, 'c2')];
      }
      return say('kept the working one');
    });

    await collect(assistant.runTurn(session, 'edit it', model));

    // The draft keeps the body that parsed rather than being left broken.
    expect(session.drafts.list()[0]?.body).toBe('SELECT ?s WHERE { ?s ?p ?o }');
  });

  it('lets a rename through without re-judging a body it is not touching', async () => {
    const assistant = service();
    const session = assistant.open(null);

    const model = dynamicModel((turn) => {
      if (turn === 0) {
        return [wantsTool('drafts.createQuery', { name: 'Before', queryString: 'SELECT ?s WHERE { ?s ?p ?o }' })];
      }
      if (turn === 1) {
        const staged = session.drafts.list()[0]!;
        return [wantsTool('drafts.updateQuery', { draftId: staged.id, name: 'After' }, 'c2')];
      }
      return say('renamed');
    });

    await collect(assistant.runTurn(session, 'rename it', model));

    expect(session.drafts.list()[0]?.name).toBe('After');
  });

  it('runs a read-only draft against the backend', async () => {
    const runSparql = vi.fn(async () => ({ text: '{"results":{"bindings":[{"s":{"value":"x"}}]}}' }));
    const assistant = service({ runSparql });
    const session = assistant.open(null);

    const model = dynamicModel((turn) => {
      if (turn === 0) return [wantsTool('drafts.createQuery', { name: 'Peek', queryString: 'SELECT * WHERE { ?s ?p ?o }' })];
      if (turn === 1) {
        const staged = session.drafts.list()[0]!;
        return [wantsTool('drafts.runQuery', { draftId: staged.id, backendId: 'urn:backend:1' }, 'c2')];
      }
      return say('It returns one row.');
    });

    const events = await collect(assistant.runTurn(session, 'check it', model));

    expect(runSparql).toHaveBeenCalledWith({ query: 'SELECT * WHERE { ?s ?p ?o }', backendId: 'urn:backend:1' });
    const receipt = events.filter((e) => e.type === 'receipt').find((e) => e.type === 'receipt' && e.tool === 'drafts.runQuery');
    expect(receipt).toMatchObject({ status: 'ok' });
  });

  it('stops at the step cap rather than looping forever', async () => {
    const assistant = service({ stepCap: 3 });
    const session = assistant.open(null);
    // A model that asks for a tool every time it is called.
    const model: ModelClient = {
      modelId: 'test/looping',
      async *stream() {
        yield { type: 'tool-call', call: { id: `c${Math.random()}`, name: 'queries.list', arguments: {} } };
      },
    };

    const events = await collect(assistant.runTurn(session, 'go', model));

    const done = events.at(-1);
    expect(done).toEqual({ type: 'done', reason: 'step-cap', message: 'Stopped after 3 steps.' });
  });

  it('stops at the token cap and says so', async () => {
    const assistant = service({ tokenCap: 100 });
    const session = assistant.open(null);
    const model: ModelClient = {
      modelId: 'test/hungry',
      async *stream() {
        yield { type: 'usage', inputTokens: 60, outputTokens: 60 };
        yield { type: 'tool-call', call: { id: 'c1', name: 'queries.list', arguments: {} } };
      },
    };

    const events = await collect(assistant.runTurn(session, 'go', model));
    expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'token-cap' });
  });

  it('stops mid-turn when interrupted', async () => {
    const assistant = service();
    const session = assistant.open(null);
    const model: ModelClient = {
      modelId: 'test/slow',
      async *stream() {
        yield { type: 'text', text: 'thinking' };
        yield { type: 'tool-call', call: { id: 'c1', name: 'queries.list', arguments: {} } };
      },
    };

    const events: AssistantEvent[] = [];
    for await (const event of assistant.runTurn(session, 'go', model)) {
      events.push(event);
      if (event.type === 'token') assistant.interrupt(session.id);
    }

    expect(events.at(-1)).toEqual({ type: 'done', reason: 'interrupted' });
  });

  it('refuses a second turn while one is in flight', async () => {
    const assistant = service();
    const session = assistant.open(null);
    session.running = true;

    const events = await collect(assistant.runTurn(session, 'go', scriptedModel([say('hi')])));
    expect(events).toEqual([
      { type: 'done', reason: 'error', message: 'This session already has a turn in flight.' },
    ]);
  });

  it('keeps drafts for the life of the session so a later turn can read them back', async () => {
    const assistant = service();
    const session = assistant.open(null);

    await collect(
      assistant.runTurn(
        session,
        'one',
        scriptedModel([
          [wantsTool('drafts.createQuery', { name: 'A', queryString: 'SELECT ?s WHERE { ?s ?p ?o }' })],
          say('ok'),
        ])
      )
    );
    await collect(
      assistant.runTurn(session, 'two', scriptedModel([[wantsTool('drafts.list', {}, 'c2')], say('ok')]))
    );

    const listed = session.messages.filter((m) => m.role === 'tool' && m.toolName === 'drafts.list');
    expect(listed).toHaveLength(1);
    expect(listed[0]!.content).toContain('"name": "A"');
  });

  /*
   * #127: door A ran tools with no principal while door B ran them as the
   * caller. The registry has taken a per-call token since #123; the turn loop
   * simply never passed one.
   */
  describe('the caller token', () => {
    it('forwards the turn caller to a tool call', async () => {
      const callTool = vi.fn(async () => ({ statusCode: 200, headers: {}, body: [], text: '[]' }));
      const assistant = service({ registry: stubRegistry({ callTool }) });
      const session = assistant.open('urn:lib:1');

      await collect(
        assistant.runTurn(
          session,
          'list them',
          scriptedModel([[wantsTool('queries.list', {})], say('done')]),
          'Bearer token-abc'
        )
      );

      expect(callTool).toHaveBeenCalledWith('queries.list', {}, 'Bearer token-abc');
    });

    it('forwards the turn caller to a draft query run', async () => {
      const runSparql = vi.fn(async () => ({ text: '{"results":{"bindings":[]}}' }));
      const assistant = service({ registry: stubRegistry(), runSparql });
      const session = assistant.open('urn:lib:1');

      // runQuery runs a *staged draft*, so one has to exist first.
      await collect(
        assistant.runTurn(
          session,
          'stage it',
          scriptedModel([
            [wantsTool('drafts.createQuery', { name: 'A', queryString: 'SELECT ?s WHERE { ?s ?p ?o }' })],
            say('staged'),
          ])
        )
      );
      const draftId = session.drafts.list()[0]!.id;

      await collect(
        assistant.runTurn(
          session,
          'try it',
          scriptedModel([
            [wantsTool('drafts.runQuery', { draftId, backendId: 'urn:backend:1' }, 'c2')],
            say('done'),
          ]),
          'Bearer token-abc'
        )
      );

      expect(runSparql).toHaveBeenCalledWith(
        expect.objectContaining({ authorization: 'Bearer token-abc' })
      );
    });

    it('passes nothing when the turn has no caller token', async () => {
      const callTool = vi.fn(async () => ({ statusCode: 200, headers: {}, body: [], text: '[]' }));
      const assistant = service({ registry: stubRegistry({ callTool }) });
      const session = assistant.open('urn:lib:1');

      await collect(
        assistant.runTurn(session, 'list them', scriptedModel([[wantsTool('queries.list', {})], say('done')]))
      );

      expect(callTool).toHaveBeenCalledWith('queries.list', {}, undefined);
    });
  });

  /*
   * #128 item 3: a big registry result is door A's problem, since we pay for
   * it against DEFAULT_TOKEN_CAP where door B does not. Truncate what the
   * model sees, keep the rest in the session behind `results.more`.
   */
  describe('result shaping', () => {
    it('offers results.more alongside the registry and draft tools', async () => {
      const assistant = service();
      const model = scriptedModel([say('ok')]);
      await collect(assistant.runTurn(assistant.open(null), 'hi', model));

      const offered = model.calls[0]!.tools.map((tool) => tool.name);
      expect(offered).toContain('results.more');
    });

    it('leaves a small result untouched and stores nothing to page', async () => {
      const callTool = vi.fn(async () => ({ statusCode: 200, headers: {}, body: [{ id: 'q1' }], text: '[{"id":"q1"}]' }));
      const assistant = service({ registry: stubRegistry({ callTool }) });
      const session = assistant.open(null);

      await collect(assistant.runTurn(session, 'list', scriptedModel([[wantsTool('queries.list', {})], say('done')])));

      const toolMessage = session.messages.find((m) => m.role === 'tool' && m.toolName === 'queries.list');
      expect(toolMessage).toMatchObject({ content: '[{"id":"q1"}]' });
      expect(session.results.size).toBe(0);
    });

    it('truncates an oversized registry result and pages through the rest with results.more', async () => {
      const rows = Array.from({ length: 5 }, (_, i) => ({ id: `q${i}` }));
      const callTool = vi.fn(async () => ({
        statusCode: 200,
        headers: {},
        body: rows,
        text: JSON.stringify(rows),
      }));
      const assistant = service({ registry: stubRegistry({ callTool }), resultCaps: { rowCap: 2 } });
      const session = assistant.open(null);

      // The second call needs the resultId the first one minted.
      const model = dynamicModel((turn) => {
        if (turn === 0) return [wantsTool('queries.list', {})];
        if (turn === 1) {
          const firstResult = session.messages.find((m) => m.role === 'tool' && m.toolName === 'queries.list');
          if (firstResult?.role !== 'tool') throw new Error('expected the first tool message');
          const match = firstResult.content.match(/resultId "([^"]+)"/);
          if (!match) throw new Error(`expected a resultId in: ${firstResult.content}`);
          return [wantsTool('results.more', { resultId: match[1], offset: 2 }, 'c2')];
        }
        return say('That is everything.');
      });

      await collect(assistant.runTurn(session, 'list them all', model));

      const toolMessages = session.messages.filter((m) => m.role === 'tool');
      expect(toolMessages).toHaveLength(2);
      expect(toolMessages[0]!.toolName).toBe('queries.list');
      expect(JSON.parse(toolMessages[0]!.content.split('\n\n[')[0]!)).toEqual([{ id: 'q0' }, { id: 'q1' }]);
      expect(toolMessages[0]!.content).toContain('Showing 2 of 5 rows');

      expect(toolMessages[1]!.toolName).toBe('results.more');
      expect(JSON.parse(toolMessages[1]!.content.split('\n\n[')[0]!)).toEqual([{ id: 'q2' }, { id: 'q3' }]);
    });

    it('turns an unknown resultId into a receipt the model can correct from', async () => {
      const assistant = service();
      const session = assistant.open(null);

      const events = await collect(
        assistant.runTurn(session, 'go', scriptedModel([[wantsTool('results.more', { resultId: 'nope' })], say('ok')]))
      );

      const receipt = events.find((event) => event.type === 'receipt');
      if (receipt?.type !== 'receipt') throw new Error('expected a receipt');
      expect(receipt.status).toBe('error');
      expect(receipt.error).toContain('no stored result with id nope');
    });
  });

  /*
   * #128 item 2: door A can see the screen, so the model should not have to
   * spend grounding calls asking what is open.
   */
  describe('the screen context', () => {
    /** The system message the model was handed on a given step. */
    function systemPromptOf(model: { calls: ModelRequest[] }, step = 0): string {
      const message = model.calls[step]!.messages[0]!;
      if (message.role !== 'system') throw new Error('expected a system message first');
      return message.content;
    }

    it('leaves the prompt untouched when the turn carries no context', async () => {
      const assistant = service({ systemPrompt: 'BASE' });
      const session = assistant.open('urn:lib:1');
      const model = scriptedModel([say('ok')]);

      await collect(assistant.runTurn(session, 'hi', model));

      expect(systemPromptOf(model)).toBe('BASE');
    });

    it('appends what is on screen to the system prompt', async () => {
      const assistant = service({ systemPrompt: 'BASE' });
      const session = assistant.open('urn:lib:1');
      const model = scriptedModel([say('ok')]);

      await collect(
        assistant.runTurn(session, 'why does it fail?', model, undefined, {
          screen: 'build',
          openEntity: { id: 'urn:q:1', type: 'query', name: 'Recent orders' },
          lastError: 'Backend refused: 400',
        })
      );

      const prompt = systemPromptOf(model);
      expect(prompt.startsWith('BASE')).toBe(true);
      expect(prompt).toContain('Open: query urn:q:1 named "Recent orders"');
      expect(prompt).toContain('Backend refused: 400');
    });

    it('says the same thing on every step of the turn', async () => {
      const assistant = service({ systemPrompt: 'BASE' });
      const session = assistant.open('urn:lib:1');
      const model = scriptedModel([[wantsTool('queries.list', {})], say('done')]);

      await collect(
        assistant.runTurn(session, 'list them', model, undefined, { screen: 'build' })
      );

      expect(model.calls).toHaveLength(2);
      expect(systemPromptOf(model, 1)).toBe(systemPromptOf(model, 0));
    });

    it('is per turn, so the next turn is not told a stale screen', async () => {
      const assistant = service({ systemPrompt: 'BASE' });
      const session = assistant.open('urn:lib:1');

      const first = scriptedModel([say('ok')]);
      await collect(
        assistant.runTurn(session, 'hi', first, undefined, { openEntity: { id: 'urn:q:1' } })
      );
      expect(systemPromptOf(first)).toContain('urn:q:1');

      const second = scriptedModel([say('ok')]);
      await collect(assistant.runTurn(session, 'and now?', second));
      expect(systemPromptOf(second)).toBe('BASE');
    });
  });

  describe('running several tool calls from one step', () => {
    /** A tool definition with just enough shape for the `readOnly` classification. */
    it('runs a run of read-only calls concurrently', async () => {
      let inFlight = 0;
      let maxInFlight = 0;
      const gate: Array<() => void> = [];
      const callTool = vi.fn(async (name: string) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        // Wait for the test to release both calls at once, so neither can
        // finish before the other has started — the only way to prove they
        // ran concurrently rather than happening to interleave.
        await new Promise<void>((resolve) => gate.push(resolve));
        inFlight -= 1;
        return { statusCode: 200, headers: {}, body: [], text: `"${name}"` };
      });
      const assistant = service({
        registry: stubRegistry({
          callTool,
          definitions: [toolDef('queries.list', true), toolDef('backends.list', true)],
        }),
      });
      const session = assistant.open(null);

      const runPromise = collect(
        assistant.runTurn(
          session,
          'list both',
          scriptedModel([
            [wantsTool('queries.list', {}, 'c1'), wantsTool('backends.list', {}, 'c2')],
            say('done'),
          ])
        )
      );

      // Give both calls a chance to start before releasing either.
      await vi.waitFor(() => expect(gate.length).toBe(2));
      expect(maxInFlight).toBe(2);
      gate.forEach((release) => release());

      const events = await runPromise;
      expect(events.at(-1)).toEqual({ type: 'done', reason: 'complete' });
    });

    it('keeps a write call from overlapping with its neighbours', async () => {
      let inFlight = 0;
      let maxInFlight = 0;
      const callTool = vi.fn(async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return { statusCode: 200, headers: {}, body: [], text: '[]' };
      });
      const assistant = service({
        registry: stubRegistry({
          callTool,
          definitions: [toolDef('queries.list', true), toolDef('queries.create', false)],
        }),
      });
      const session = assistant.open(null);

      await collect(
        assistant.runTurn(
          session,
          'list then create',
          scriptedModel([
            [
              wantsTool('queries.list', {}, 'c1'),
              wantsTool('queries.create', { name: 'x' }, 'c2'),
              wantsTool('queries.list', {}, 'c3'),
            ],
            say('done'),
          ])
        )
      );

      // c1 (read) and c3 (read) are each their own batch because c2 (a
      // write) sits between them, so nothing ever overlaps with the write.
      expect(maxInFlight).toBe(1);
      expect(callTool).toHaveBeenCalledTimes(3);
    });

    it('applies outcomes in call order even when the slower call is first', async () => {
      const callTool = vi.fn(async (name: string) => {
        const delay = name === 'queries.list' ? 20 : 0;
        await new Promise((resolve) => setTimeout(resolve, delay));
        return { statusCode: 200, headers: {}, body: [], text: `"${name}"` };
      });
      const assistant = service({
        registry: stubRegistry({
          callTool,
          definitions: [toolDef('queries.list', true), toolDef('backends.list', true)],
        }),
      });
      const session = assistant.open(null);

      const events = await collect(
        assistant.runTurn(
          session,
          'list both',
          scriptedModel([
            [wantsTool('queries.list', {}, 'c1'), wantsTool('backends.list', {}, 'c2')],
            say('done'),
          ])
        )
      );

      const receipts = events.filter((event) => event.type === 'receipt');
      expect(receipts).toEqual([
        { type: 'receipt', tool: 'queries.list', status: 'ok', artifacts: [] },
        { type: 'receipt', tool: 'backends.list', status: 'ok', artifacts: [] },
      ]);
      const toolMessages = session.messages.filter((m) => m.role === 'tool');
      expect(toolMessages.map((m) => (m as { toolCallId: string }).toolCallId)).toEqual(['c1', 'c2']);
    });
  });

  /**
   * Per-turn tool narrowing (#128 item 1).
   *
   * The loop-level half of it: that the narrowed set is what actually goes on
   * the wire, that widening reaches the *next* step, and that a turn with no
   * screen context is sent exactly what it was before any of this existed.
   */
  describe('narrowing the tool list to the screen', () => {
    const catalogueRegistry = (overrides: Partial<ToolRegistry> = {}) =>
      stubRegistry({
        definitions: [
          toolDef('queries.get', true),
          toolDef('ruleSets.get', true),
          toolDef('libraries.list', true),
        ],
        listTools: () => [
          { name: 'queries.get', description: 'Get a query', inputSchema: { type: 'object' } },
          { name: 'ruleSets.get', description: 'Get a rule set', inputSchema: { type: 'object' } },
          { name: 'libraries.list', description: 'List libraries', inputSchema: { type: 'object' } },
        ],
        ...overrides,
      });

    it('sends only the open kind’s tools, plus the drafts and the escape hatch', async () => {
      const assistant = service({ registry: catalogueRegistry() });
      const session = assistant.open('urn:lib:1');
      const model = scriptedModel([say('ok')]);

      await collect(
        assistant.runTurn(session, 'why does it fail?', model, undefined, {
          screen: 'build',
          openEntity: { id: 'urn:q:1', type: 'query' },
        })
      );

      const offered = model.calls[0]!.tools.map((tool) => tool.name);
      expect(offered).toContain('queries.get');
      expect(offered).not.toContain('ruleSets.get');
      // Core grounding and the draft gate are never narrowed away.
      expect(offered).toContain('libraries.list');
      expect(offered).toContain('drafts.createQuery');
      expect(offered).toContain('tools.enable');
    });

    it('sends the whole list, and no escape hatch, when there is no context', async () => {
      const assistant = service({ registry: catalogueRegistry() });
      const session = assistant.open('urn:lib:1');
      const model = scriptedModel([say('ok')]);

      await collect(assistant.runTurn(session, 'hi', model));

      const offered = model.calls[0]!.tools.map((tool) => tool.name);
      expect(offered).toContain('queries.get');
      expect(offered).toContain('ruleSets.get');
      expect(offered).not.toContain('tools.enable');
      // And the instructions are the ones a turn got before narrowing existed.
      const system = model.calls[0]!.messages[0];
      expect(system.content).not.toContain('tools.enable');
    });

    it('tells the model which groups it is not holding', async () => {
      const assistant = service({ registry: catalogueRegistry() });
      const session = assistant.open('urn:lib:1');
      const model = scriptedModel([say('ok')]);

      await collect(
        assistant.runTurn(session, 'hi', model, undefined, {
          openEntity: { id: 'urn:q:1', type: 'query' },
        })
      );

      const system = model.calls[0]!.messages[0];
      expect(system.content).toContain('rules');
      expect(system.content).toContain('tools.enable');
    });

    it('hands over a group when asked, and the next step has it', async () => {
      const callTool = vi.fn(async () => ({ statusCode: 200, headers: {}, body: {}, text: '{}' }));
      const assistant = service({ registry: catalogueRegistry({ callTool }) });
      const session = assistant.open('urn:lib:1');
      const model = scriptedModel([
        [wantsTool('tools.enable', { group: 'rules' })],
        [wantsTool('ruleSets.get', { id: 'urn:rs:1' }, 'call-2')],
        say('there it is'),
      ]);

      const events = await collect(
        assistant.runTurn(session, 'and my rule set?', model, undefined, {
          openEntity: { id: 'urn:q:1', type: 'query' },
        })
      );

      expect(model.calls[0]!.tools.map((tool) => tool.name)).not.toContain('ruleSets.get');
      expect(model.calls[1]!.tools.map((tool) => tool.name)).toContain('ruleSets.get');
      // It is a real tool call with a real receipt, not a silent widening.
      const receipts = events.filter((event) => event.type === 'receipt');
      expect(receipts.map((receipt) => (receipt as { tool: string }).tool)).toEqual([
        'tools.enable',
        'ruleSets.get',
      ]);
      expect(callTool).toHaveBeenCalledWith('ruleSets.get', { id: 'urn:rs:1' }, undefined);
    });

    it('reports an unknown group as an error the model can correct', async () => {
      const assistant = service({ registry: catalogueRegistry() });
      const session = assistant.open('urn:lib:1');
      const model = scriptedModel([[wantsTool('tools.enable', { group: 'everything' })], say('sorry')]);

      const events = await collect(
        assistant.runTurn(session, 'go', model, undefined, {
          openEntity: { id: 'urn:q:1', type: 'query' },
        })
      );

      const receipt = events.find((event) => event.type === 'receipt');
      expect(receipt).toMatchObject({ status: 'error' });
      expect((receipt as { error: string }).error).toMatch(/not a tool group/);
    });

    it('does not drop reads memoised this turn — widening touches no data', async () => {
      const callTool = vi.fn(async () => ({ statusCode: 200, headers: {}, body: [], text: '[]' }));
      const assistant = service({ registry: catalogueRegistry({ callTool }) });
      const session = assistant.open('urn:lib:1');
      const model = scriptedModel([
        [wantsTool('libraries.list', {}, 'c1')],
        [wantsTool('tools.enable', { group: 'rules' }, 'c2')],
        [wantsTool('libraries.list', {}, 'c3')],
        say('done'),
      ]);

      await collect(
        assistant.runTurn(session, 'go', model, undefined, {
          openEntity: { id: 'urn:q:1', type: 'query' },
        })
      );

      expect(callTool).toHaveBeenCalledTimes(1);
    });
  });
});
