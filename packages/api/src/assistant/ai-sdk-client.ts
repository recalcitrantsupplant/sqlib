/**
 * The Vercel AI SDK behind the `ModelClient` seam.
 *
 * This is the whole provider integration, and the plan's §5 argument is that it
 * barely matters: one module, one interface, swap the `@ai-sdk/*` package to
 * change provider. If the choice turns out wrong, this file is the blast
 * radius.
 *
 * Two things it deliberately does not do:
 *
 * - **It does not execute tools.** The SDK will happily run them, but the turn
 *   loop owns that, because the loop is where the draft gate, the receipts and
 *   the `changed` events live. Tools are declared without an `execute`, so the
 *   SDK reports the call and stops.
 * - **It does not loop.** `stopWhen`/`maxSteps` would hide the step cap and the
 *   interrupt inside the SDK, where the service cannot see them. One call in,
 *   one stream out.
 */
import { streamText, jsonSchema, tool, type ModelMessage as SdkMessage, type ToolSet } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGroq } from '@ai-sdk/groq';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import type {
  ModelClient,
  ModelClientFactory,
  ModelMessage,
  ModelRequest,
  ModelStreamEvent,
  ModelTool,
  ProviderCredentials,
} from './model.js';

/** Everything except the system prompt, which the SDK takes separately. */
type ConversationMessage = Exclude<ModelMessage, { role: 'system' }>;

function resolveModel(credentials: ProviderCredentials): LanguageModel {
  switch (credentials.provider) {
    case 'anthropic':
      return createAnthropic({ apiKey: credentials.apiKey })(credentials.model);

    case 'openai':
      return createOpenAI({ apiKey: credentials.apiKey })(credentials.model);

    /*
     * Groq speaks the OpenAI wire format, so `openai-compatible` with its base
     * URL would also work. It gets its own entry anyway, because the dedicated
     * provider knows the things the generic one cannot: which models reason,
     * how Groq reports its own errors, and the service-tier and tool-call
     * quirks that otherwise surface as an unexplained 400.
     */
    case 'groq':
      return createGroq({ apiKey: credentials.apiKey })(credentials.model);

    /*
     * OpenRouter, Groq, Together, vLLM, Ollama, LM Studio — all of them speak
     * the OpenAI wire format, which is why one entry covers the lot. A local
     * one has no key, and the SDK insists on a string, so it gets a placeholder
     * rather than a confusing failure about a missing credential it never had.
     */
    case 'openai-compatible': {
      if (!credentials.baseUrl) {
        throw new Error('An OpenAI-compatible provider needs a base URL.');
      }
      return createOpenAI({ apiKey: credentials.apiKey || 'not-required', baseURL: credentials.baseUrl })(
        credentials.model
      );
    }

    default:
      throw new Error(`Unknown provider "${credentials.provider}".`);
  }
}

/**
 * Split the system prompt out of the conversation.
 *
 * AI SDK v7 rejects a system message inside `messages` — it wants the
 * `instructions` option — while the seam's `ModelMessage` union includes one,
 * because that is how the turn loop thinks about a conversation and how most
 * providers describe it. Reconciling the two is precisely what an adapter is
 * for, and doing it here rather than in the loop keeps the next provider's
 * opinion about system prompts in one file.
 */
export function splitInstructions(messages: ModelMessage[]): {
  instructions: string | undefined;
  rest: ConversationMessage[];
} {
  const system = messages.filter((message) => message.role === 'system').map((message) => message.content);
  return {
    instructions: system.length > 0 ? system.join('\n\n') : undefined,
    // Narrowed rather than filtered-and-cast, so the mapping below stays
    // exhaustive: adding a role to the seam becomes a compile error here.
    rest: messages.filter((message): message is ConversationMessage => message.role !== 'system'),
  };
}

/** Our conversation, in the SDK's shape. System messages are not welcome here. */
export function toSdkMessages(messages: ModelMessage[]): SdkMessage[] {
  return splitInstructions(messages).rest.map((message): SdkMessage => {
    switch (message.role) {
      case 'user':
        return { role: 'user', content: message.content };

      case 'assistant': {
        const content: Array<Record<string, unknown>> = [];
        if (message.content) content.push({ type: 'text', text: message.content });
        for (const call of message.toolCalls ?? []) {
          content.push({ type: 'tool-call', toolCallId: call.id, toolName: call.name, input: call.arguments });
        }
        // An assistant turn with neither text nor calls would be an empty
        // content array, which providers reject.
        if (content.length === 0) content.push({ type: 'text', text: '' });
        return { role: 'assistant', content } as SdkMessage;
      }

      case 'tool':
        return {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: message.toolCallId,
              toolName: message.toolName,
              output: { type: 'text', value: message.content },
            },
          ],
        } as SdkMessage;
    }
  });
}

/**
 * Our tools, in the SDK's shape.
 *
 * `jsonSchema()` passes the catalogue's schemas through untouched. They are
 * already JSON Schema and already what the API validates with — converting
 * them to zod and back would be the drift the schema-consolidation track
 * exists to remove.
 */
export function toSdkTools(tools: ModelTool[]): ToolSet {
  const set: ToolSet = {};
  for (const entry of tools) {
    set[entry.name] = tool({
      description: entry.description,
      inputSchema: jsonSchema(entry.inputSchema as Parameters<typeof jsonSchema>[0]),
      // No `execute`: the turn loop runs tools, because that is where the gate is.
    });
  }
  return set;
}

/** Usage is reported differently per provider and per SDK version; be liberal. */
function usageOf(part: Record<string, unknown>): { inputTokens: number; outputTokens: number } | null {
  const usage = (part.usage ?? part.totalUsage) as Record<string, unknown> | undefined;
  if (!usage) return null;
  const inputTokens = typeof usage.inputTokens === 'number' ? usage.inputTokens : 0;
  const outputTokens = typeof usage.outputTokens === 'number' ? usage.outputTokens : 0;
  if (inputTokens === 0 && outputTokens === 0) return null;
  return { inputTokens, outputTokens };
}

export function createAiSdkClient(credentials: ProviderCredentials): ModelClient {
  const model = resolveModel(credentials);

  return {
    modelId: `${credentials.provider}/${credentials.model}`,

    async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
      const { instructions } = splitInstructions(request.messages);
      const result = streamText({
        model,
        instructions,
        messages: toSdkMessages(request.messages),
        tools: toSdkTools(request.tools),
        abortSignal: request.signal,
      });

      for await (const part of result.fullStream as AsyncIterable<Record<string, unknown>>) {
        switch (part.type) {
          case 'text-delta':
            if (typeof part.text === 'string' && part.text.length > 0) {
              yield { type: 'text', text: part.text };
            }
            break;

          case 'tool-call':
            yield {
              type: 'tool-call',
              call: {
                id: String(part.toolCallId),
                name: String(part.toolName),
                // The SDK parses the arguments; a provider that streams
                // malformed JSON surfaces as an error part instead.
                arguments: (part.input ?? {}) as Record<string, unknown>,
              },
            };
            break;

          case 'finish-step':
          case 'finish': {
            const usage = usageOf(part);
            if (usage) yield { type: 'usage', ...usage };
            break;
          }

          case 'error':
            /*
             * Thrown rather than yielded: the turn loop turns a throw into a
             * `done` event the user sees. Swallowing it here would leave the
             * assistant appearing to stop mid-sentence, which is the failure
             * mode the caps were written to avoid.
             */
            throw part.error instanceof Error ? part.error : new Error(String(part.error ?? 'model error'));
        }
      }
    },
  };
}

export const aiSdkModelClientFactory: ModelClientFactory = createAiSdkClient;
