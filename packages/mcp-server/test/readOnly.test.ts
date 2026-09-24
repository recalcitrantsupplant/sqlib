/**
 * Read-only mode, tested at the level that decides it: which definitions the
 * registry is built from.
 *
 * The interesting assertions are not "writes are gone" but the two things a
 * reader is likely to get wrong — that execution *survives* read-only, because
 * running a query mutates no library, and that the three View-bound tools
 * survive too, or a read-only server would publish a bench that cannot render.
 */
import { describe, expect, it } from 'vitest';
import { tools } from '@sparql-query-lib/tools';
import { catalogueForMode, readOnlyGuideNote } from '../src/read-only.js';

const readOnly = catalogueForMode(tools, true);
const names = new Set(readOnly.map((tool) => tool.name));

describe('read-only mode', () => {
  it('publishes only the tools marked readOnly', () => {
    expect(readOnly.length).toBeGreaterThan(0);
    expect(readOnly.length).toBeLessThan(tools.length);
    expect(readOnly.every((tool) => tool.readOnly === true)).toBe(true);
  });

  it('keeps execution, including server-side rules', () => {
    for (const name of ['execute.run', 'sparql.proxyQuery', 'rules.execute', 'ruleSets.execute', 'patches.previewUpdate']) {
      expect(names.has(name), `${name} should survive read-only mode`).toBe(true);
    }
  });

  it('drops the writes', () => {
    for (const name of ['queries.create', 'queries.createVersion', 'backends.create', 'libraries.delete', 'patches.apply']) {
      expect(names.has(name), `${name} should not be published read-only`).toBe(false);
    }
  });

  it('keeps every View-bound tool, or the Views become unreachable', () => {
    const bound = tools.filter((tool) => tool.ui);
    expect(bound.length).toBeGreaterThan(0);
    for (const tool of bound) {
      expect(names.has(tool.name), `${tool.name} renders a View and must stay readable`).toBe(true);
    }
  });

  it('leaves the catalogue untouched when the mode is off', () => {
    expect(catalogueForMode(tools, false)).toHaveLength(tools.length);
  });

  it('tells the model the mode, so it does not promise a save it cannot make', () => {
    const note = readOnlyGuideNote();
    expect(note).toMatch(/read-only/i);
    expect(note).toMatch(/Running queries still works/);
  });
});
