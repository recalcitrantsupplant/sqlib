/**
 * Does a provider actually work with our tool surface?
 *
 * The unit tests run the adapter against the SDK's mock model, which proves the
 * translation is right and proves nothing about whether a real provider accepts
 * what we send. The gap matters most for the OpenAI-shaped providers: tool
 * schemas that Anthropic takes without comment are validated far more strictly
 * elsewhere, and the failure arrives as an opaque 400 in the middle of a turn
 * rather than at boot.
 *
 * So this makes the smallest real calls that exercise the risky parts, against
 * the live provider, and says which one broke:
 *
 *   1. text only        — credentials, model id, streaming
 *   2. tools declared   — the whole 40-tool surface is accepted
 *   3. a forced call    — the model can actually call one
 *
 * It never runs a tool. It talks to the provider and stops, so it needs no
 * database, no backend and no running server — just a key.
 *
 *   GROQ_API_KEY=gsk_… npx tsx scripts/assistant-provider-smoke.ts groq
 *   ANTHROPIC_API_KEY=… npx tsx scripts/assistant-provider-smoke.ts anthropic
 *   OPENAI_API_KEY=… npx tsx scripts/assistant-provider-smoke.ts openai llama-3.3-70b-versatile
 *   OPENAI_COMPATIBLE_BASE_URL=http://localhost:11434/v1 npx tsx scripts/assistant-provider-smoke.ts openai-compatible qwen2.5
 */
import { tools as catalogue } from '@sparql-query-lib/tools';
import { assistantToolNames } from '../src/assistant/allowlist.js';
import { DRAFT_TOOL_DEFINITIONS } from '../src/assistant/draft-tools.js';
import { createAiSdkClient } from '../src/assistant/ai-sdk-client.js';
import type { ModelTool, ProviderCredentials } from '../src/assistant/model.js';

/** Defaults chosen to be cheap and tool-capable, not to be recommendations. */
const PROVIDER_DEFAULTS: Record<string, { model: string; keyEnv: string }> = {
  anthropic: { model: 'claude-opus-5', keyEnv: 'ANTHROPIC_API_KEY' },
  openai: { model: 'gpt-5', keyEnv: 'OPENAI_API_KEY' },
  groq: { model: 'llama-3.1-8b-instant', keyEnv: 'GROQ_API_KEY' },
  'openai-compatible': { model: '', keyEnv: 'OPENAI_COMPATIBLE_API_KEY' },
};

/** Exactly what the assistant route exposes: allowlisted catalogue + draft tools. */
function assistantToolSurface(): ModelTool[] {
  const allowed = new Set(assistantToolNames());
  return [
    ...catalogue
      .filter((tool) => allowed.has(tool.name))
      .map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })),
    ...DRAFT_TOOL_DEFINITIONS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  ];
}

type Step = { name: string; run: () => Promise<string> };

async function drain(
  credentials: ProviderCredentials,
  prompt: string,
  tools: ModelTool[]
): Promise<{ text: string; calls: string[] }> {
  const client = createAiSdkClient(credentials);
  let text = '';
  const calls: string[] = [];
  for await (const event of client.stream({
    messages: [
      { role: 'system', content: 'You are a smoke test. Be extremely brief.' },
      { role: 'user', content: prompt },
    ],
    tools,
  })) {
    if (event.type === 'text') text += event.text;
    if (event.type === 'tool-call') calls.push(event.call.name);
  }
  return { text, calls };
}

async function main() {
  const provider = process.argv[2];
  if (!provider || !PROVIDER_DEFAULTS[provider]) {
    console.error(`Usage: tsx scripts/assistant-provider-smoke.ts <${Object.keys(PROVIDER_DEFAULTS).join('|')}> [model]`);
    process.exit(2);
  }

  const defaults = PROVIDER_DEFAULTS[provider];
  const model = process.argv[3] || defaults.model;
  const apiKey = process.env[defaults.keyEnv];
  const baseUrl = process.env.OPENAI_COMPATIBLE_BASE_URL;

  if (!model) {
    console.error(`No model. Pass one as the second argument.`);
    process.exit(2);
  }
  if (provider === 'openai-compatible' ? !baseUrl : !apiKey) {
    console.error(
      provider === 'openai-compatible'
        ? 'Set OPENAI_COMPATIBLE_BASE_URL.'
        : `Set ${defaults.keyEnv}.`
    );
    process.exit(2);
  }

  const credentials: ProviderCredentials = { provider, model, apiKey, baseUrl };
  const surface = assistantToolSurface();
  console.log(`provider  ${provider}/${model}`);
  console.log(`tools     ${surface.length} (${surface.filter((t) => t.name.startsWith('drafts.')).length} draft)\n`);

  const steps: Step[] = [
    {
      name: 'text only — credentials, model id, streaming',
      run: async () => {
        const { text } = await drain(credentials, 'Reply with the single word: ok', []);
        if (!text.trim()) throw new Error('the provider streamed no text');
        return JSON.stringify(text.trim().slice(0, 40));
      },
    },
    {
      name: 'tool surface accepted — all schemas pass provider validation',
      run: async () => {
        // The point is that declaring the tools does not 400. A provider that
        // rejects a schema does it here, before any tool is chosen — which is
        // why this asks a question that needs no tool.
        const { text } = await drain(credentials, 'Reply with the single word: ok', surface);
        return text.trim() ? 'accepted' : 'accepted (no text)';
      },
    },
    {
      name: 'a real tool call — the model can use the surface',
      run: async () => {
        const { calls } = await drain(
          credentials,
          'List the libraries. Call a tool; do not answer from memory.',
          surface
        );
        if (calls.length === 0) throw new Error('the model chose no tool (surface may be too large for it)');
        return calls.join(', ');
      },
    },
  ];

  /** What a failure at each step actually means, since the provider will not say. */
  const DIAGNOSIS = [
    'The provider refused before tools were involved: check the key, the model id, and that\n' +
      'this host can reach the provider at all.',
    'The provider rejected our tool surface. This is the schema-strictness failure — by far\n' +
      'the largest and most complex schema is execute.run (anyOf, format, 17 levels deep);\n' +
      'drop it from ASSISTANT_EXECUTION_TOOLS and re-run to confirm it is the culprit.',
    'The surface was accepted but the model called nothing. Not necessarily a bug — a smaller\n' +
      'model may simply be overwhelmed by 40 tools. Try a stronger model before changing code.',
  ];

  let failedAt = -1;
  for (const [index, step] of steps.entries()) {
    process.stdout.write(`${index + 1}. ${step.name}\n   `);
    try {
      console.log(`PASS  ${await step.run()}\n`);
    } catch (error) {
      failedAt = index;
      const message = error instanceof Error ? error.message : String(error);
      console.log(`FAIL  ${message}\n`);
      // Later steps assume earlier ones held; a bad key would fail all three
      // and say nothing the first failure did not already say.
      break;
    }
  }

  if (failedAt >= 0) {
    console.log(DIAGNOSIS[failedAt]);
    process.exit(1);
  }
  console.log(`${provider}/${model} works with the assistant tool surface.`);
}

void main();
