import { describe, expect, it } from 'vitest';
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test';
import { streamText, jsonSchema, tool } from 'ai';
import { createAiSdkClient, splitInstructions, toSdkMessages, toSdkTools } from '../../src/assistant/ai-sdk-client.js';
import type { ModelMessage, ModelStreamEvent } from '../../src/assistant/model.js';

/**
 * The provider adapter, against the SDK's own mock model.
 *
 * No key and no network call — the point of the seam. What is worth asserting
 * is the translation in both directions, because that is where a provider or
 * SDK upgrade breaks things quietly: a renamed stream part turns into an
 * assistant that says nothing, and a mis-shaped tool result turns into one that
 * forgets what it just did.
 */

/** The adapter's stream loop, over a mock model rather than a real provider. */
async function collectFrom(chunks: Array<Record<string, unknown>>, messages: ModelMessage[] = [{ role: 'user', content: 'hi' }]) {
  const model = new MockLanguageModelV4({
    doStream: async () => ({ stream: simulateReadableStream({ chunks: chunks as never }) }),
  });

  const result = streamText({
    model,
    instructions: splitInstructions(messages).instructions,
    messages: toSdkMessages(messages),
    tools: toSdkTools([
      { name: 'demo.echo', description: 'Echo', inputSchema: { type: 'object', properties: { a: { type: 'number' } } } },
    ]),
  });

  const events: ModelStreamEvent[] = [];
  for await (const part of result.fullStream as AsyncIterable<Record<string, unknown>>) {
    if (part.type === 'text-delta' && typeof part.text === 'string' && part.text) {
      events.push({ type: 'text', text: part.text });
    } else if (part.type === 'error') {
      throw part.error instanceof Error ? part.error : new Error(JSON.stringify(part.error));
    } else if (part.type === 'tool-call') {
      events.push({
        type: 'tool-call',
        call: { id: String(part.toolCallId), name: String(part.toolName), arguments: (part.input ?? {}) as Record<string, unknown> },
      });
    }
  }
  return events;
}

describe('AI SDK adapter — messages', () => {
  it('carries an assistant turn with its tool calls', () => {
    const [assistant] = toSdkMessages([
      { role: 'assistant', content: 'Let me look.', toolCalls: [{ id: 'c1', name: 'queries.list', arguments: { limit: 5 } }] },
    ]);

    expect(assistant).toMatchObject({
      role: 'assistant',
      content: [
        { type: 'text', text: 'Let me look.' },
        { type: 'tool-call', toolCallId: 'c1', toolName: 'queries.list', input: { limit: 5 } },
      ],
    });
  });

  it('never emits an assistant turn with empty content', () => {
    // A turn that was only a tool call has no text; an empty content array is
    // rejected by providers, so it gets an empty text part instead.
    const [assistant] = toSdkMessages([{ role: 'assistant', content: '' }]);
    expect((assistant as { content: unknown[] }).content).toHaveLength(1);
  });

  it('shapes a tool result the way the SDK expects', () => {
    const [toolMessage] = toSdkMessages([
      { role: 'tool', toolCallId: 'c1', toolName: 'queries.list', content: '[]' },
    ]);

    expect(toolMessage).toMatchObject({
      role: 'tool',
      content: [
        { type: 'tool-result', toolCallId: 'c1', toolName: 'queries.list', output: { type: 'text', value: '[]' } },
      ],
    });
  });

  it('lifts the system prompt out to instructions', () => {
    // v7 rejects a system message inside `messages`. The seam keeps one because
    // that is how the loop and most providers describe a conversation, so the
    // adapter is where the two are reconciled — and this is the test that
    // caught it before a single real turn ran.
    const { instructions, rest } = splitInstructions([
      { role: 'system', content: 'You help.' },
      { role: 'user', content: 'hi' },
    ]);
    expect(instructions).toBe('You help.');
    expect(rest.map((message) => message.role)).toEqual(['user']);
    expect(toSdkMessages([{ role: 'system', content: 'You help.' }])).toEqual([]);
  });

  it('round-trips a whole conversation through the SDK without it complaining', async () => {
    // The assertion is that this does not throw: the SDK validates message
    // shapes, so a conversation it accepts is one a provider will accept.
    const events = await collectFrom(
      [
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: 't1' },
        { type: 'text-delta', id: 't1', delta: 'ok' },
        { type: 'text-end', id: 't1' },
        { type: 'finish', finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1 } },
      ],
      [
        { role: 'system', content: 'You help.' },
        { role: 'user', content: 'what do I have?' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'demo.echo', arguments: { a: 1 } }] },
        { role: 'tool', toolCallId: 'c1', toolName: 'demo.echo', content: '{"ok":true}' },
      ]
    );

    expect(events).toEqual([{ type: 'text', text: 'ok' }]);
  });
});

describe('AI SDK adapter — tools', () => {
  it('passes the catalogue’s JSON Schema through untouched', () => {
    const schema = { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] };
    const tools = toSdkTools([{ name: 'queries.get', description: 'Get one', inputSchema: schema }]);

    // Converting to zod and back would be exactly the drift the schema
    // consolidation track exists to remove.
    expect((tools['queries.get'] as { inputSchema: { jsonSchema: unknown } }).inputSchema.jsonSchema).toEqual(schema);
  });

  it('declares no execute, so the SDK reports a call instead of running it', () => {
    const tools = toSdkTools([{ name: 'queries.get', description: 'Get one', inputSchema: { type: 'object' } }]);
    // The turn loop runs tools, because the turn loop is where the draft gate,
    // the receipts and the changed events are.
    expect((tools['queries.get'] as { execute?: unknown }).execute).toBeUndefined();
  });
});

describe('AI SDK adapter — stream', () => {
  it('maps text deltas to text events', async () => {
    const events = await collectFrom([
      { type: 'stream-start', warnings: [] },
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', delta: 'Hel' },
      { type: 'text-delta', id: 't1', delta: 'lo' },
      { type: 'text-end', id: 't1' },
      { type: 'finish', finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1 } },
    ]);

    expect(events).toEqual([
      { type: 'text', text: 'Hel' },
      { type: 'text', text: 'lo' },
    ]);
  });

  it('maps a tool call, with its arguments already parsed', async () => {
    const events = await collectFrom([
      { type: 'stream-start', warnings: [] },
      { type: 'tool-input-start', id: 'c1', toolName: 'demo.echo' },
      { type: 'tool-input-delta', id: 'c1', delta: '{"a":42}' },
      { type: 'tool-input-end', id: 'c1' },
      { type: 'tool-call', toolCallId: 'c1', toolName: 'demo.echo', input: '{"a":42}' },
      { type: 'finish', finishReason: 'tool-calls', usage: { inputTokens: 1, outputTokens: 1 } },
    ]);

    expect(events).toEqual([
      { type: 'tool-call', call: { id: 'c1', name: 'demo.echo', arguments: { a: 42 } } },
    ]);
  });

  it('reports several tool calls in one step', async () => {
    const events = await collectFrom([
      { type: 'stream-start', warnings: [] },
      { type: 'tool-call', toolCallId: 'c1', toolName: 'demo.echo', input: '{"a":1}' },
      { type: 'tool-call', toolCallId: 'c2', toolName: 'demo.echo', input: '{"a":2}' },
      { type: 'finish', finishReason: 'tool-calls', usage: { inputTokens: 1, outputTokens: 1 } },
    ]);

    expect(events).toHaveLength(2);
    expect(events.map((event) => (event.type === 'tool-call' ? event.call.id : null))).toEqual(['c1', 'c2']);
  });
});

describe('AI SDK adapter — providers', () => {
  /*
   * Building a client makes no network call, so this is cheap and it catches
   * the failure that matters: a provider listed in the panel that the server's
   * factory cannot actually construct is a turn that dies at send time.
   */
  it('builds a client for each provider the panel offers', () => {
    expect(createAiSdkClient({ provider: 'anthropic', model: 'claude-opus-5', apiKey: 'k' }).modelId).toBe(
      'anthropic/claude-opus-5'
    );
    expect(createAiSdkClient({ provider: 'openai', model: 'gpt-5', apiKey: 'k' }).modelId).toBe('openai/gpt-5');
    expect(
      createAiSdkClient({ provider: 'groq', model: 'llama-3.3-70b-versatile', apiKey: 'gsk_k' }).modelId
    ).toBe('groq/llama-3.3-70b-versatile');
  });

  it('asks an OpenAI-compatible endpoint for its base URL', () => {
    expect(() => createAiSdkClient({ provider: 'openai-compatible', model: 'llama3' })).toThrow(/base URL/i);
  });

  it('names the provider it does not know', () => {
    expect(() => createAiSdkClient({ provider: 'nope', model: 'x' })).toThrow(/nope/);
  });
});
