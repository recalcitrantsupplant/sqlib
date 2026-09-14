import { describe, expect, it, vi } from 'vitest';
import { listProviderModels, parseModelList } from '../../src/assistant/list-models.js';

/**
 * The model catalogue, which every provider publishes in the same shape and
 * annotates differently. What is worth asserting is that the differences do not
 * reach the panel: one list, sorted, with whatever extras happened to be there.
 */
const ok = (payload: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })) as unknown as typeof fetch;

describe('provider model list — parsing', () => {
  it('lifts the fields a provider happens to send', () => {
    expect(
      parseModelList({
        data: [
          { id: 'llama-3.1-8b-instant', context_window: 131072, max_completion_tokens: 131072 },
          { id: 'claude-opus-5', display_name: 'Claude Opus 5' },
          { id: 'gpt-5' },
        ],
      })
    ).toEqual([
      { id: 'claude-opus-5', displayName: 'Claude Opus 5', contextWindow: undefined, maxCompletionTokens: undefined },
      { id: 'gpt-5', displayName: undefined, contextWindow: undefined, maxCompletionTokens: undefined },
      {
        id: 'llama-3.1-8b-instant',
        displayName: undefined,
        contextWindow: 131072,
        maxCompletionTokens: 131072,
      },
    ]);
  });

  it('drops retired models rather than offering a guaranteed failure', () => {
    const models = parseModelList({ data: [{ id: 'live' }, { id: 'retired', active: false }] });
    expect(models.map((model) => model.id)).toEqual(['live']);
  });

  it('survives a body that is not a model list', () => {
    expect(parseModelList({})).toEqual([]);
    expect(parseModelList({ data: 'nope' })).toEqual([]);
    expect(parseModelList({ data: [{ noId: true }, null] })).toEqual([]);
  });
});

describe('provider model list — fetching', () => {
  it('asks Groq at its OpenAI-compatible path, with a bearer token', async () => {
    const fetchImpl = ok({ data: [{ id: 'llama-3.1-8b-instant' }] });
    const models = await listProviderModels({ provider: 'groq', model: '', apiKey: 'gsk_k' }, fetchImpl);

    expect(models.map((model) => model.id)).toEqual(['llama-3.1-8b-instant']);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://api.groq.com/openai/v1/models');
    expect((init as RequestInit).headers).toMatchObject({ authorization: 'Bearer gsk_k' });
  });

  it('sends the version header Anthropic requires', async () => {
    const fetchImpl = ok({ data: [] });
    await listProviderModels({ provider: 'anthropic', model: '', apiKey: 'k' }, fetchImpl);

    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect((init as RequestInit).headers).toMatchObject({ 'x-api-key': 'k', 'anthropic-version': '2023-06-01' });
  });

  it('omits the bearer for a local endpoint that has no key', async () => {
    const fetchImpl = ok({ data: [] });
    await listProviderModels(
      { provider: 'openai-compatible', model: '', baseUrl: 'http://localhost:11434/v1/' },
      fetchImpl
    );

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    // The trailing slash is the user's, and doubling it 404s on some servers.
    expect(url).toBe('http://localhost:11434/v1/models');
    expect((init as RequestInit).headers).toEqual({});
  });

  it('says the key was rejected rather than reporting a bare status', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 401 })) as unknown as typeof fetch;
    await expect(listProviderModels({ provider: 'groq', model: '', apiKey: 'bad' }, fetchImpl)).rejects.toThrow(
      /key was rejected/
    );
  });
});
