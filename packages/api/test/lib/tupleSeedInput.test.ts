/**
 * A rule set's tabular input, supplied per run.
 *
 * The rule set's own execute route had no field for rows at all: it ran
 * whatever `tupleSeeds` its version stored, so the "saved tuple set" choice on
 * the rules screen was resolved to text in the browser and honoured by the
 * playground route only. This gives a run the same three ways in that every
 * other input slot takes — pinned version, floating parent, or inline
 * `application/sparql-arguments+json` — without changing what a rule-set
 * version stores.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { overrideCacheCoordinatorProvider } from '../../src/lib/CacheCoordinatorProvider.js';

const hoisted = vi.hoisted(() => ({ entities: new Map<string, unknown>() }));

overrideCacheCoordinatorProvider({
  getCacheCoordinator: () => ({ get: (id: string) => hoisted.entities.get(id) ?? null }),
});

const { resolveTupleSeedInput, TupleSeedInputError, bindingsToTupleSeeds } =
  await import('../../src/lib/tupleSeedInput.js');

const SET_ID = 'urn:sqlib:tuple-set:s1';
const EMPTY_SET_ID = 'urn:sqlib:tuple-set:s-empty';
const VERSION_ID = 'urn:sqlib:tuple-set-version:v1';

const DOCUMENT = {
  head: { vars: ['x', 'y'] },
  results: {
    bindings: [
      { x: { type: 'uri', value: 'http://ex/alice' }, y: { type: 'uri', value: 'http://ex/bob' } },
      { x: { type: 'literal', value: 'carol' }, y: { type: 'literal', value: '7', datatype: 'http://www.w3.org/2001/XMLSchema#integer' } },
    ],
  },
};

beforeEach(() => {
  hoisted.entities.clear();
  hoisted.entities.set(VERSION_ID, {
    $id: VERSION_ID,
    '@type': 'TupleSetVersion',
    isPartOf: SET_ID,
    version: 1,
    contentString: JSON.stringify(DOCUMENT),
    tupleColumns: ['x', 'y'],
  });
  hoisted.entities.set(SET_ID, {
    $id: SET_ID, '@type': 'TupleSet', name: 'Seeds', currentVersion: VERSION_ID,
  });
  hoisted.entities.set(EMPTY_SET_ID, {
    $id: EMPTY_SET_ID, '@type': 'TupleSet', name: 'Never saved',
  });
});

describe('resolveTupleSeedInput', () => {
  /* Absent means "run the stored seeds", which is what every run did before. */
  it('is null when the request names no tuples', () => {
    expect(resolveTupleSeedInput(undefined)).toBeNull();
    expect(resolveTupleSeedInput(null)).toBeNull();
    expect(resolveTupleSeedInput({})).toBeNull();
  });

  it('renders a pinned version as a seed document', () => {
    const seeds = resolveTupleSeedInput({ tupleSetVersionId: VERSION_ID });
    expect(seeds).toBe(
      'TUPLE(<http://ex/alice>, <http://ex/bob>)\n'
      + 'TUPLE("carol", "7"^^<http://www.w3.org/2001/XMLSchema#integer>)',
    );
  });

  it('floats a set id to its current version', () => {
    expect(resolveTupleSeedInput({ tupleSetId: SET_ID }))
      .toBe(resolveTupleSeedInput({ tupleSetVersionId: VERSION_ID }));
  });

  it('renders an inline arguments-JSON document', () => {
    const seeds = resolveTupleSeedInput({
      inline: {
        head: { vars: ['x', 'y'] },
        arguments: { bindings: [{ x: { type: 'uri', value: 'http://ex/a' }, y: { type: 'literal', value: 'b' } }] },
      },
    });
    expect(seeds).toBe('TUPLE(<http://ex/a>, "b")');
  });

  it('accepts the storage spelling too, since a caller may hold either', () => {
    const seeds = resolveTupleSeedInput({
      inline: { head: { vars: ['x'] }, results: { bindings: [{ x: { type: 'literal', value: 'b' } }] } },
    });
    expect(seeds).toBe('TUPLE("b")');
  });

  it('refuses two sources at once', () => {
    expect(() => resolveTupleSeedInput({ tupleSetId: SET_ID, tupleSetVersionId: VERSION_ID }))
      .toThrow(/exactly one/);
  });

  it('refuses an unknown set and one with no current version', () => {
    expect(() => resolveTupleSeedInput({ tupleSetId: 'urn:sqlib:tuple-set:missing' })).toThrow(/not found/);
    expect(() => resolveTupleSeedInput({ tupleSetId: EMPTY_SET_ID })).toThrow(/no current version/);
  });

  it('refuses an unknown version', () => {
    expect(() => resolveTupleSeedInput({ tupleSetVersionId: 'urn:sqlib:tuple-set-version:gone' }))
      .toThrow(TupleSeedInputError);
  });

  it('refuses an inline document that is not one', () => {
    expect(() => resolveTupleSeedInput({ inline: { rows: [] } })).toThrow(/head\.vars/);
    expect(() => resolveTupleSeedInput({ inline: 'TUPLE(:a)' })).toThrow(/arguments JSON/);
  });

  /*
   * Column order comes from `tupleColumns`, which is `head.vars` lifted onto
   * the version precisely so it survives storage. It matters because a rule set
   * matches its rows positionally — names are ignored (2026-08-18 §6).
   */
  it('follows the version column order, not the order keys happen to be in', () => {
    hoisted.entities.set(VERSION_ID, {
      $id: VERSION_ID, '@type': 'TupleSetVersion', isPartOf: SET_ID, version: 1,
      contentString: JSON.stringify({
        head: { vars: ['y', 'x'] },
        results: { bindings: [{ x: { type: 'literal', value: 'second' }, y: { type: 'literal', value: 'first' } }] },
      }),
      tupleColumns: ['y', 'x'],
    });
    expect(resolveTupleSeedInput({ tupleSetVersionId: VERSION_ID })).toBe('TUPLE("first", "second")');
  });

  it('leaves an absent cell out rather than padding it with an empty literal', () => {
    hoisted.entities.set(VERSION_ID, {
      $id: VERSION_ID, '@type': 'TupleSetVersion', isPartOf: SET_ID, version: 1,
      contentString: JSON.stringify({
        head: { vars: ['x', 'y'] },
        results: { bindings: [{ x: { type: 'literal', value: 'only' } }] },
      }),
      tupleColumns: ['x', 'y'],
    });
    expect(resolveTupleSeedInput({ tupleSetVersionId: VERSION_ID })).toBe('TUPLE("only")');
  });
});

describe('bindingsToTupleSeeds', () => {
  /*
   * Must agree with the web's `termToSrl`: a set saved from the rules screen
   * and the same set resolved here have to seed identical rows.
   */
  it('writes each term the way SRL does', () => {
    expect(bindingsToTupleSeeds(['t'], [
      { t: { type: 'uri', value: 'http://ex/a' } },
      { t: { type: 'bnode', value: 'b0' } },
      { t: { type: 'literal', value: 'plain' } },
      { t: { type: 'literal', value: 'hi', 'xml:lang': 'en' } },
      { t: { type: 'literal', value: 'say "x"' } },
    ])).toBe([
      'TUPLE(<http://ex/a>)',
      'TUPLE(_:b0)',
      'TUPLE("plain")',
      'TUPLE("hi"@en)',
      'TUPLE("say \\"x\\"")',
    ].join('\n'));
  });
});
