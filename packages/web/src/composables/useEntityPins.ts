import { ref } from 'vue';

/**
 * Pinned entities and the time each entity was last opened, kept in this
 * browser only. The server does not see either.
 *
 * - Pins are one list of entity IRIs for the whole browser. IRIs are unique
 *   across libraries and kinds, so the list needs no library or section key.
 * - "Last opened" is a map from IRI to epoch ms. The "Last opened" sort reads
 *   it. It keeps the newest `MAX_OPENED` entries, so it cannot grow without end.
 *
 * Both are module state, so every sidebar and every editor menu reads one copy.
 * A change in another tab arrives through the `storage` event.
 */

const PINS_KEY = 'sparql-query-lib-pins';
const OPENED_KEY = 'sparql-query-lib-last-opened';
export const MAX_OPENED = 500;

function readJson(key: string): unknown {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A full or blocked localStorage loses the pin on reload. The list still works.
  }
}

function readPins(): string[] {
  const value = readJson(PINS_KEY);
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
}

function readOpened(): Record<string, number> {
  const value = readJson(OPENED_KEY);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [id, at] of Object.entries(value as Record<string, unknown>)) {
    if (typeof at === 'number' && Number.isFinite(at)) out[id] = at;
  }
  return out;
}

const pins = ref<Set<string>>(new Set(readPins()));
const opened = ref<Record<string, number>>(readOpened());

let listening = false;
function listen(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('storage', (event) => {
    if (event.key === PINS_KEY) pins.value = new Set(readPins());
    if (event.key === OPENED_KEY) opened.value = readOpened();
  });
}

export function useEntityPins() {
  listen();

  function isPinned(id: string | null | undefined): boolean {
    return Boolean(id) && pins.value.has(id!);
  }

  function setPinned(id: string, value: boolean): void {
    if (pins.value.has(id) === value) return;
    const next = new Set(pins.value);
    if (value) next.add(id);
    else next.delete(id);
    pins.value = next;
    writeJson(PINS_KEY, [...next]);
  }

  function togglePin(id: string): void {
    setPinned(id, !pins.value.has(id));
  }

  return { pins, isPinned, setPinned, togglePin };
}

export function useEntityLastOpened() {
  listen();

  function openedAt(id: string): number | undefined {
    return opened.value[id];
  }

  function markOpened(id: string, at: number = Date.now()): void {
    const next = { ...opened.value, [id]: at };
    const ids = Object.keys(next);
    if (ids.length > MAX_OPENED) {
      ids.sort((a, b) => next[a]! - next[b]!);
      for (const old of ids.slice(0, ids.length - MAX_OPENED)) delete next[old];
    }
    opened.value = next;
    writeJson(OPENED_KEY, next);
  }

  return { opened, openedAt, markOpened };
}

/** Test seam: clear the module state and re-read localStorage. */
export function resetEntityPinsForTest(): void {
  pins.value = new Set(readPins());
  opened.value = readOpened();
}
