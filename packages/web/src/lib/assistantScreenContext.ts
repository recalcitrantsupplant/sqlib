/**
 * What the screen can tell the assistant that the assistant cannot see.
 *
 * Door A's advantage over an MCP client (issue #128 item 2): the browser knows
 * which entity is open, the body as currently edited, and the error the user is
 * looking at. Sending those with the turn saves the two or three grounding
 * calls the model would otherwise spend finding them out — and, more often,
 * saves it guessing which entity "it" means.
 *
 * The server has the authoritative parser (`api/src/assistant/screen-context.ts`):
 * it caps every field and refuses anything it cannot read, because this arrives
 * on the wire and cannot be trusted merely because we also wrote the sender.
 * What this file is for is the *other* end of that: build a context that is
 * already small and already true, so the caps are a backstop rather than the
 * mechanism.
 *
 * Nothing here is a secret: it is what the user has on screen. It is worth
 * saying out loud, though, that a body goes to the model provider the user
 * configured — which is already true of every query the assistant is asked
 * about, and is the deal §8 of the runtime plan describes.
 */

/** Kept in step with the server's parser; it is the one that enforces them. */
const MAX_BODY = 4_000;
const MAX_ERROR = 1_000;

export interface ScreenContextEntity {
  id: string;
  type?: string;
  name?: string;
  state?: string;
  tab?: string;
}

export interface ScreenContext {
  screen?: string;
  library?: { id: string; name?: string };
  openEntity?: ScreenContextEntity;
  draftBody?: string;
  lastError?: string;
}

/** The facts a screen has to hand, before any of them are known to be usable. */
export interface ScreenContextInput {
  screen?: string | null;
  library?: { id?: string | null; name?: string | null } | null;
  openEntity?: {
    id?: string | null;
    type?: string | null;
    name?: string | null;
    state?: string | null;
    tab?: string | null;
  } | null;
  draftBody?: string | null;
  lastError?: string | null;
}

function usable(value: string | null | undefined, max?: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return max && trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/**
 * Normalise the screen's facts into what goes on the wire.
 *
 * Returns null when nothing survives, so a caller can send no `context` at all
 * rather than an empty object — a turn with nothing worth saying should look
 * exactly like a turn sent before this existed.
 */
export function buildScreenContext(input: ScreenContextInput): ScreenContext | null {
  const context: ScreenContext = {};

  const screen = usable(input.screen);
  if (screen) context.screen = screen;

  const libraryId = usable(input.library?.id);
  if (libraryId) {
    const name = usable(input.library?.name);
    context.library = name ? { id: libraryId, name } : { id: libraryId };
  }

  const entityId = usable(input.openEntity?.id);
  if (entityId) {
    const entity: ScreenContextEntity = { id: entityId };
    const type = usable(input.openEntity?.type);
    const name = usable(input.openEntity?.name);
    const state = usable(input.openEntity?.state);
    const tab = usable(input.openEntity?.tab);
    if (type) entity.type = type;
    if (name) entity.name = name;
    if (state) entity.state = state;
    if (tab) entity.tab = tab;
    context.openEntity = entity;
  }

  /*
   * A body with nothing open is a body the assistant cannot act on: it has no
   * id to read, edit or run it by, so all it can do is guess which of the
   * library's queries it belongs to. Sent only alongside its entity.
   */
  if (context.openEntity) {
    const draftBody = usable(input.draftBody, MAX_BODY);
    if (draftBody) context.draftBody = draftBody;
  }

  const lastError = usable(input.lastError, MAX_ERROR);
  if (lastError) context.lastError = lastError;

  return Object.keys(context).length > 0 ? context : null;
}
