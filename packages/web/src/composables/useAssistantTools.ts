/**
 * Tool metadata, so a receipt can say "Stage a query draft" rather than
 * `drafts.createQuery`.
 *
 * The label is the tool's `title` — MCP's field for the human-readable name,
 * which the protocol says clients should prefer over `name`. Its `description`
 * is the fallback, and only that: a description is written for a model, so a
 * tool with a paragraph explaining what saving means needs a title rather
 * than having its prose truncated into a header.
 *
 * Fetching these rather than keeping a display copy in the frontend is what
 * stops the two wordings drifting apart.
 *
 * Module-level, fetched once per page: the catalogue cannot change while the
 * app is open, and every receipt in every turn asks the same question.
 */
import { ref } from 'vue';
import { useRuntimeConfig } from '#imports';

type ToolInfo = { name: string; title: string | null; description: string | null };

const labels = ref<Record<string, string>>({});
let inFlight: Promise<void> | null = null;

export function useAssistantTools() {
  const config = useRuntimeConfig();
  const baseUrl = String(config.public.apiBaseUrl ?? '').replace(/\/$/, '');

  function load() {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const response = await fetch(`${baseUrl}/assistant/tools`);
        if (!response.ok) return;
        const payload = (await response.json()) as { tools?: ToolInfo[] };
        const next: Record<string, string> = {};
        for (const tool of payload.tools ?? []) {
          const label = tool.title ?? tool.description;
          if (label) next[tool.name] = label;
        }
        labels.value = next;
      } catch {
        /*
         * A label is a nicety. Failing to fetch one leaves `labelFor` returning
         * the tool name, which is correct, just less readable — not worth an
         * error in the chat.
         */
      }
    })();
    return inFlight;
  }

  /** The readable form, or the raw name when there is nothing better. */
  function labelFor(name: string): string {
    return labels.value[name] ?? name;
  }

  return { load, labelFor, labels };
}
