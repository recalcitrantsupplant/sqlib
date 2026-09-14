/**
 * The client's reading of an `oxigraphMemory` backend's `oxigraphConfig`.
 *
 * On the wire the config is a JSON *string* (the contract types it as
 * `string | null`), and the server stores more in it than the form edits —
 * legacy seeding fields like `loadMethod` and `sourceConfig`. Parsing therefore
 * keeps everything it does not understand in `rest`, and serializing writes it
 * back, so a round-trip through the form cannot silently drop configuration
 * that another path still reads.
 */

export type MemoryStoreMode = 'readOnly' | 'ephemeral' | 'durable';

/** One data graph the store is hydrated from — exactly one of the two ids. */
export interface MemoryStoreSource {
  /** Pinned to an immutable version. Mutually exclusive with `dataGraphId`. */
  dataGraphVersionId?: string;
  /** Tracks the graph's head version. Mutually exclusive with `dataGraphVersionId`. */
  dataGraphId?: string;
  /** Optional named graph to load the content into. */
  namedGraph?: string;
}

export interface ParsedMemoryConfig {
  mode: MemoryStoreMode;
  sources: MemoryStoreSource[];
  /** Fields the form does not edit, preserved verbatim on write. */
  rest: Record<string, unknown>;
}

export const MEMORY_STORE_MODES: ReadonlyArray<{ value: MemoryStoreMode; label: string; hint: string }> = [
  {
    value: 'readOnly',
    label: 'Read-only',
    hint: 'Rebuilt from its data graphs; writes are refused. Tracked graphs reload it when a new version is saved.',
  },
  {
    value: 'ephemeral',
    label: 'Ephemeral',
    hint: 'Seeded the same way but writable — scratch space. Changes are discarded when the server restarts.',
  },
  {
    value: 'durable',
    label: 'Durable',
    hint: 'Seeded from the data graphs on first boot only; after that its own saved state is the source of truth.',
  },
];

function isMemoryStoreMode(value: unknown): value is MemoryStoreMode {
  return value === 'readOnly' || value === 'ephemeral' || value === 'durable';
}

function readSource(value: unknown): MemoryStoreSource | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const source: MemoryStoreSource = {};
  if (typeof record.dataGraphVersionId === 'string' && record.dataGraphVersionId.trim()) {
    source.dataGraphVersionId = record.dataGraphVersionId;
  }
  if (typeof record.dataGraphId === 'string' && record.dataGraphId.trim()) {
    source.dataGraphId = record.dataGraphId;
  }
  if (typeof record.namedGraph === 'string' && record.namedGraph.trim()) {
    source.namedGraph = record.namedGraph;
  }
  return source.dataGraphVersionId || source.dataGraphId ? source : null;
}

/** Read a stored config string; malformed input degrades to the defaults. */
export function parseMemoryConfig(raw: string | null | undefined): ParsedMemoryConfig {
  const fallback: ParsedMemoryConfig = { mode: 'readOnly', sources: [], rest: {} };
  if (!raw || !raw.trim()) return fallback;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback;
  }
  if (typeof parsed !== 'object' || parsed === null) return fallback;
  const { mode, sources, ...rest } = parsed as Record<string, unknown>;
  return {
    mode: isMemoryStoreMode(mode) ? mode : 'readOnly',
    sources: Array.isArray(sources)
      ? sources.map(readSource).filter((source): source is MemoryStoreSource => source !== null)
      : [],
    rest,
  };
}

/**
 * Serialize back to the wire string.
 *
 * `storeType` is derived from the mode rather than preserved: it is the legacy
 * lifecycle field, and carrying a stale value (or the old `persistent`, which
 * triggers a `persistPath` requirement server-side) would contradict the mode
 * that now decides everything for memory stores.
 */
export function serializeMemoryConfig(
  mode: MemoryStoreMode,
  sources: MemoryStoreSource[],
  rest: Record<string, unknown> = {},
): string {
  const { storeType: _storeType, persistPath: _persistPath, ...kept } = rest;
  return JSON.stringify({
    ...kept,
    storeType: mode === 'durable' ? 'durable' : 'ephemeral',
    mode,
    sources,
  });
}
