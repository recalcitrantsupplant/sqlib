/**
 * What models can this key actually call?
 *
 * The panel used to take a model id as free text, which is wrong in both
 * directions: a typo is indistinguishable from a model that has been retired,
 * and neither is discoverable until a turn fails. A hardcoded dropdown would be
 * worse — this list changes monthly, and a stale one is a bug shipped in a
 * release.
 *
 * So ask the provider. All four speak the same `GET /models` shape (Anthropic
 * added it; the OpenAI-compatible crowd inherited it), which is the whole
 * reason this is one function rather than a per-provider strategy.
 *
 * Deliberately not on the `ModelClient` seam. The seam is what the turn loop
 * needs — one call, streamed — and widening it to carry a capability the loop
 * never uses would make every scripted test client in this directory
 * implement a method for nobody's benefit.
 */
import type { ProviderCredentials } from './model.js';

/** Where each provider publishes its catalogue, and what it needs to be asked. */
function endpointFor(credentials: ProviderCredentials): { url: string; headers: Record<string, string> } {
  switch (credentials.provider) {
    case 'anthropic':
      return {
        url: 'https://api.anthropic.com/v1/models?limit=100',
        headers: {
          'x-api-key': credentials.apiKey ?? '',
          // Required on every Anthropic request, listing included.
          'anthropic-version': '2023-06-01',
        },
      };

    case 'openai':
      return {
        url: 'https://api.openai.com/v1/models',
        headers: { authorization: `Bearer ${credentials.apiKey ?? ''}` },
      };

    case 'groq':
      return {
        url: 'https://api.groq.com/openai/v1/models',
        headers: { authorization: `Bearer ${credentials.apiKey ?? ''}` },
      };

    case 'openai-compatible': {
      if (!credentials.baseUrl) throw new Error('An OpenAI-compatible provider needs a base URL.');
      return {
        url: `${credentials.baseUrl.replace(/\/$/, '')}/models`,
        // A local endpoint usually has no key; sending an empty bearer upsets
        // some of them, so the header only appears when there is something in it.
        headers: credentials.apiKey ? { authorization: `Bearer ${credentials.apiKey}` } : {},
      };
    }

    default:
      throw new Error(`Unknown provider "${credentials.provider}".`);
  }
}

/**
 * What a provider will tell us about a model.
 *
 * **Price is not in here, and not because it was forgotten.** None of the four
 * `/models` endpoints returns pricing — Groq's entries carry `context_window`
 * and `max_completion_tokens`, Anthropic's carry a display name, OpenAI's carry
 * essentially nothing beyond the id and owner. A rate per million tokens can
 * only come from a table we maintain by hand, and a hand-maintained price that
 * has drifted is worse than no price, because someone will budget against it.
 * What the panel can show honestly is the metadata below, plus the token counts
 * the turn stream already reports.
 */
export type ProviderModel = {
  id: string;
  /** Anthropic sends one; the OpenAI-shaped providers do not. */
  displayName?: string;
  /** Groq reports both of these. Absent elsewhere. */
  contextWindow?: number;
  maxCompletionTokens?: number;
};

const numberOr = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/**
 * `{ data: [{ id, … }] }` is the shape every one of them returns; the extra
 * fields differ, so each is lifted only where present. Sorted, because
 * providers return creation order and a list a human has to scan should be
 * predictable rather than chronological.
 */
export function parseModelList(payload: unknown): ProviderModel[] {
  const data = (payload as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];

  const seen = new Set<string>();
  const models: ProviderModel[] = [];
  for (const raw of data) {
    const entry = raw as Record<string, unknown>;
    const id = entry?.id;
    if (typeof id !== 'string' || !id || seen.has(id)) continue;
    // Groq marks retired models inactive and keeps returning them; offering one
    // would be offering a guaranteed failure.
    if (entry.active === false) continue;
    seen.add(id);
    models.push({
      id,
      displayName: typeof entry.display_name === 'string' ? entry.display_name : undefined,
      contextWindow: numberOr(entry.context_window),
      maxCompletionTokens: numberOr(entry.max_completion_tokens),
    });
  }
  return models.sort((a, b) => a.id.localeCompare(b.id));
}

export type ModelLister = (credentials: ProviderCredentials) => Promise<ProviderModel[]>;

/**
 * A provider that cannot list is not a failure worth blocking on — the field
 * still accepts a typed id — so the caller gets a message rather than an
 * exception to render.
 */
export async function listProviderModels(
  credentials: ProviderCredentials,
  fetchImpl: typeof fetch = fetch
): Promise<ProviderModel[]> {
  const { url, headers } = endpointFor(credentials);
  const response = await fetchImpl(url, { headers });
  if (!response.ok) {
    const detail = response.status === 401 || response.status === 403 ? 'the key was rejected' : `HTTP ${response.status}`;
    throw new Error(`Could not list ${credentials.provider} models: ${detail}.`);
  }
  return parseModelList(await response.json());
}
