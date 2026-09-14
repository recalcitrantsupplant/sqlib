/**
 * The write-then-reload round trip for `QueryNode.backendConfig` (issue #305).
 *
 * The unit suites either side of this one cover the `json` kind against a
 * synthetic schema. This one uses the *real* `QueryNodeSchema` and joins the
 * two halves, because the bug lived in the join: serialisation stored
 * `String(value)` — the literal `"[object Object]"` — and assembly read that
 * back as a string, so `backendConfig.type === 'ephemeral-oxigraph'` was false
 * everywhere it was tested.
 *
 * Nothing caught it because `CacheCoordinator` is a write-through cache: it
 * keeps the live object in memory, so every read within one process was served
 * the intact config and the mangled literal was only visible after `loadAll`
 * rebuilt the cache from the store. That is what these tests simulate — write
 * to triples, read back from triples, with no cache in between.
 */
import { describe, expect, it, vi } from 'vitest';
import { QueryNodeSchema } from '../../src/persistence/schemas/QueryNodeSchema.js';
import { DynamicQueryNodeSchema } from '../../src/persistence/schemas/DynamicQueryNodeSchema.js';
import { serialiseEntity } from '../../src/persistence/EntitySerialiser.js';
import { assembleEntity, type BindingRow } from '../../src/persistence/EntityAssembler.js';

const NODE_ID = 'urn:sqlib:node:round-trip';
const CONFIG = { type: 'ephemeral-oxigraph', storeId: 'urn:store:shapes' } as const;

/**
 * The store, reduced to what it does to a value: triples out, rows back in.
 *
 * The terms are unquoted here the way a SPARQL JSON result delivers them, so
 * this is the same handoff `EntityStore` performs between the two.
 */
function reload(schema: Record<string, unknown>, entity: Record<string, unknown>) {
  const rows: BindingRow[] = serialiseEntity(schema, entity).map((triple) => ({
    id: { type: 'uri', value: NODE_ID },
    p: { type: 'uri', value: triple.predicate.slice(1, -1) },
    o: { type: 'literal', value: literalValue(triple.object) },
  })) as unknown as BindingRow[];

  return assembleEntity(schema, rows)!;
}

/** The lexical value of an N-Triples term, without its quoting or datatype. */
function literalValue(term: string): string {
  const quoted = term.startsWith('"') ? term.slice(1, term.lastIndexOf('"')) : term.slice(1, -1);
  return quoted
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

describe('QueryNode.backendConfig survives a store round trip', () => {
  it('comes back as the object it was written as', () => {
    const node = reload(QueryNodeSchema as never, {
      $id: NODE_ID,
      queryId: 'urn:sqlib:queryVersion:1',
      backendConfig: CONFIG,
    });

    expect(node.backendConfig).toEqual(CONFIG);
  });

  it('is never stored as "[object Object]"', () => {
    const stored = serialiseEntity(QueryNodeSchema as never, {
      $id: NODE_ID,
      queryId: 'urn:sqlib:queryVersion:1',
      backendConfig: CONFIG,
    }).find((triple) => triple.predicate.includes('backendConfig'));

    expect(stored?.object).not.toContain('object Object');
  });

  /*
   * The reload is what every read site then depends on. Asserting the
   * discriminator rather than just the object pins the actual failure: a
   * string reads back fine as a value and only fails at `.type`, which is why
   * the config looked present while every node silently lost its store.
   */
  it('reloads with the discriminator the executor branches on', () => {
    const node = reload(QueryNodeSchema as never, {
      $id: NODE_ID,
      queryId: 'urn:sqlib:queryVersion:1',
      backendConfig: CONFIG,
    });

    const config = node.backendConfig as { type?: string; storeId?: string } | null;
    expect(config?.type).toBe('ephemeral-oxigraph');
    expect(config?.storeId).toBe(CONFIG.storeId);
  });

  /*
   * A DynamicQueryNode reaches the same writer and the same executor, but its
   * schema did not declare `backendConfig` at all, so the property was dropped
   * on write without a word — the silent-loss half of the same issue.
   */
  it('survives on a DynamicQueryNode too', () => {
    const node = reload(DynamicQueryNodeSchema as never, {
      $id: NODE_ID,
      queryId: 'urn:sqlib:queryVersion:1',
      backendConfig: CONFIG,
    });

    expect(node.backendConfig).toEqual(CONFIG);
  });

  it('reads a store still holding the old mangled literal as absent', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const node = assembleEntity(QueryNodeSchema as never, [
        {
          id: { type: 'uri', value: NODE_ID },
          p: { type: 'uri', value: 'https://sparql-query-lib/backendConfig' },
          o: { type: 'literal', value: '[object Object]' },
        },
      ] as unknown as BindingRow[])!;

      expect(node.backendConfig).toBeNull();
    } finally {
      warn.mockRestore();
    }
  });
});
