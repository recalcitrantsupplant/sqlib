import { describe, it, expect, beforeEach, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({ entities: new Map<string, unknown>() }));

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => ({ get: (id: string) => hoisted.entities.get(id) ?? null }),
}));

const { resolveDataGraphInput, DataGraphContentError } = await import('../../src/lib/dataGraphInput.js');

const VERSION_ID = 'urn:sqlib:data-graph-version:v1';
const GRAPH_ID = 'urn:sqlib:data-graph:g1';
const EMPTY_GRAPH_ID = 'urn:sqlib:data-graph:g-empty';

beforeEach(() => {
  hoisted.entities.clear();
  hoisted.entities.set(GRAPH_ID, {
    $id: GRAPH_ID, '@type': 'DataGraph', name: 'G', currentVersion: VERSION_ID,
  });
  hoisted.entities.set(EMPTY_GRAPH_ID, {
    $id: EMPTY_GRAPH_ID, '@type': 'DataGraph', name: 'Never saved',
  });
  hoisted.entities.set(VERSION_ID, {
    $id: VERSION_ID,
    '@type': 'DataGraphVersion',
    isPartOf: 'urn:sqlib:data-graph:g1',
    version: 1,
    contentString: '@prefix : <http://ex/> . :a :edge :b .',
    contentFormat: 'text/turtle',
    tripleCount: 1,
  });
});

describe('resolveDataGraphInput', () => {
  it('returns null when the request names no data graph', () => {
    expect(resolveDataGraphInput({})).toBeNull();
    expect(resolveDataGraphInput({ dataGraphInline: '   ' })).toBeNull();
  });

  it('resolves a saved version to its content and format', () => {
    const resolved = resolveDataGraphInput({ dataGraphVersionId: VERSION_ID });
    expect(resolved).toMatchObject({ source: 'version', format: 'turtle', tripleCount: 1 });
    expect(resolved?.content).toContain(':a :edge :b');
  });

  it('rejects an unknown version id', () => {
    expect(() => resolveDataGraphInput({ dataGraphVersionId: 'urn:sqlib:data-graph-version:nope' }))
      .toThrow(DataGraphContentError);
  });

  it('rejects an id that resolves to something that is not a data graph version', () => {
    hoisted.entities.set('urn:sqlib:query:q1', { $id: 'urn:sqlib:query:q1', '@type': 'Query' });
    expect(() => resolveDataGraphInput({ dataGraphVersionId: 'urn:sqlib:query:q1' }))
      .toThrow(DataGraphContentError);
  });

  it('parses inline content and counts it, defaulting to Turtle', () => {
    const resolved = resolveDataGraphInput({
      dataGraphInline: '@prefix : <http://ex/> . :a :edge :b . :b :edge :c .',
    });
    expect(resolved).toMatchObject({ source: 'inline', format: 'turtle', tripleCount: 2 });
  });

  it('applies the same caps and parse to inline content as to saved content', () => {
    // Otherwise `/execute` would be a way around limits the writer enforces.
    expect(() => resolveDataGraphInput({ dataGraphInline: 'not turtle {{{' }))
      .toThrow(DataGraphContentError);
  });

  it('rejects two inputs at once instead of silently picking one', () => {
    expect(() => resolveDataGraphInput({
      dataGraphVersionId: VERSION_ID,
      dataGraphInline: '@prefix : <http://ex/> . :a :edge :b .',
    })).toThrow(/exactly one/);
  });
});

/*
 * The third way in, added so every input slot takes the same three: inline
 * content, a version that pins, or a parent id that floats to the current
 * version. Argument sets have accepted a parent or a version since they
 * existed; graphs took only the pinned form, so "run against the latest of this
 * graph" meant looking the version up first. The spelling matches
 * `OxigraphDataGraphSource`, which already draws the same distinction for a
 * backend's hydration sources.
 */
describe('resolveDataGraphInput — a floating graph id', () => {
  it('resolves a graph to its current version', () => {
    const resolved = resolveDataGraphInput({ dataGraphId: GRAPH_ID });
    expect(resolved?.content).toContain(':a :edge :b');
    expect(resolved?.source).toBe('version');
  });

  it('refuses a graph that has no current version', () => {
    expect(() => resolveDataGraphInput({ dataGraphId: EMPTY_GRAPH_ID }))
      .toThrow(/no current version/);
  });

  it('refuses an unknown graph', () => {
    expect(() => resolveDataGraphInput({ dataGraphId: 'urn:sqlib:data-graph:missing' }))
      .toThrow(/not found/);
  });

  it('refuses a graph id paired with a version id', () => {
    expect(() => resolveDataGraphInput({ dataGraphId: GRAPH_ID, dataGraphVersionId: VERSION_ID }))
      .toThrow(/exactly one/);
  });

  it('refuses a graph id paired with inline content', () => {
    expect(() => resolveDataGraphInput({
      dataGraphId: GRAPH_ID,
      dataGraphInline: '@prefix : <http://ex/> . :a :edge :b .',
    })).toThrow(/exactly one/);
  });
});
