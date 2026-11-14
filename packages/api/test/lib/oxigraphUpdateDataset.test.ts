/**
 * The probe that decides whether in-process updates can take a dataset.
 */
import { describe, it, expect } from 'vitest';
import * as oxigraph from 'oxigraph';
import { probeUpdateDataset } from '../../src/lib/oxigraphUpdateDataset.js';

describe('probeUpdateDataset', () => {
  it('is false for a binding that ignores dataset options on update, as 0.5.13 does', () => {
    expect(probeUpdateDataset(() => new oxigraph.Store())).toBe(false);
  });

  it('is true for a store that applies them', () => {
    // A stand-in for a patched binding: it runs the update only when the
    // default graph it is given is not empty.
    const stub = () => {
      const store = new oxigraph.Store();
      const update = store.update.bind(store);
      return Object.assign(store, {
        update: (text: string, options?: { default_graph?: unknown[] }) => {
          if (options?.default_graph && options.default_graph.length === 0) return;
          update(text);
        },
      });
    };
    expect(probeUpdateDataset(stub)).toBe(true);
  });
});
