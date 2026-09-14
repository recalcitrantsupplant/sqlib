/**
 * The provider seam.
 *
 * The turn loop talks to this, never to an SDK. Two reasons, and the second is
 * the one that earns its keep every day: we will change provider (the plan's
 * §5 says that is the only property that has to hold), and the loop has to be
 * testable without a provider key and without a network call. A scripted
 * `ModelClient` is how every test in this directory runs.
 *
 * Deliberately smaller than any SDK's surface. It is one call — "here is the
 * conversation and the tools, stream me back text and tool calls" — because
 * that is all the loop needs, and a wider seam is a wider thing to reimplement
 * when the provider changes.
 */

export type ModelMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ModelToolCall[] }
  | { role: 'tool'; toolCallId: string; toolName: string; content: string };

export type ModelToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type ModelTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

/** What one model call produced. */
export type ModelStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'tool-call'; call: ModelToolCall }
  | { type: 'usage'; inputTokens: number; outputTokens: number };

export type ModelRequest = {
  messages: ModelMessage[];
  tools: ModelTool[];
  signal?: AbortSignal;
};

export interface ModelClient {
  /** The model's id, for receipts and logs. */
  readonly modelId: string;
  stream(request: ModelRequest): AsyncIterable<ModelStreamEvent>;
}

export type ProviderCredentials = {
  /** 'anthropic' | 'openai' | any id the factory knows. */
  provider: string;
  model: string;
  apiKey?: string;
  /** For OpenAI-compatible endpoints: OpenRouter, Groq, vLLM, Ollama, LM Studio. */
  baseUrl?: string;
};

export type ModelClientFactory = (credentials: ProviderCredentials) => ModelClient;

/**
 * The default factory, which is deliberately not wired to an SDK yet.
 *
 * Installing `ai` + `@ai-sdk/*` is a one-file change behind this seam (plan
 * §5), and until a provider is actually configured the honest behaviour is to
 * say so rather than to fail somewhere deeper with a less useful message.
 */
export const unconfiguredModelClientFactory: ModelClientFactory = (credentials) => ({
  modelId: `${credentials.provider}/${credentials.model}`,
  // eslint-disable-next-line require-yield
  async *stream() {
    throw new Error(
      `No model client is configured for provider "${credentials.provider}". ` +
        'Register one with configureAssistant({ modelClientFactory }).'
    );
  },
});
