/**
 * The bundle format's reader half: bundles this runtime must not stop reading.
 *
 * Every other test in this directory builds its bundle with `./helpers.ts`, which
 * is a second implementation of the exporter — good for probing the validator,
 * useless as a statement about the format, because it moves whenever someone
 * changes it. So the two fixtures here are frozen instead:
 *
 * - `fixtures/bundle-v1.json` is a **real** bundle, written by the API's export
 *   route over a fixture library and committed. `packages/api`'s
 *   `bundleFormat.test.ts` rebuilds it and compares, so it cannot drift from
 *   what the writer emits without a reviewed diff.
 * - `fixtures/bundle-v1-minimal.json` carries only the fields the format
 *   requires — no `generatedAt`, no groups, no examples, no provenance. Today's
 *   exporter cannot produce it, which is the point: it stands in for a producer
 *   older or leaner than this reader.
 *
 * Why this matters more than it used to: while the runtime is a workspace
 * package, a bundle and the code that reads it are the same commit. Once it is on
 * npm (#258) they are two versions moving independently — a consumer keeps a
 * bundle in their repository and upgrades the runtime, or pins the runtime and
 * re-exports against a newer server. Both directions are only safe if a v1
 * bundle stays readable by every v1 reader, and nothing said so.
 *
 * The rule these tests hold the format to, in full:
 *
 * 1. A v1 bundle written at any time loads in any runtime that reads v1 —
 *    including one carrying only required fields.
 * 2. An unknown field is ignored, not rejected. This is what makes a new
 *    optional field additive: an older reader must survive a newer bundle.
 * 3. A change that breaks either of those bumps `ExportBundle.version`, and the
 *    reader then refuses the new number rather than guessing (already pinned in
 *    `bundle.test.ts`).
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertValidBundle, verifyBundleIntegrity } from '../src/bundle.js';
import type { ExportBundle } from '../src/bundle.js';
import { fromBundle, iri } from '../src/library.js';
import type { ExecutionResult, Executor } from '../src/executor.js';

/*
 * The fixtures are read from disk rather than imported, so the committed bytes
 * are what gets validated — a JSON import would need `resolveJsonModule`, and
 * would put the fixture through a transform on the way in.
 *
 * This is the only file in the package that touches node built-ins. Do not add
 * `@types/node` to make them resolve: every `@types` package in scope is visible
 * to `src` as well, and `src` not seeing node globals is what keeps this package
 * honest about being browser code. These tests are not typechecked in CI (only
 * `packages/web` is; everything else is checked by its build, which compiles
 * `src` only).
 */
const FIXTURES = resolve(import.meta.dirname, 'fixtures');

const load = (name: string): ExportBundle =>
  JSON.parse(readFileSync(resolve(FIXTURES, name), 'utf8')) as ExportBundle;

const GOLDEN = load('bundle-v1.json');
const MINIMAL = load('bundle-v1-minimal.json');

/** Answers by what the query text contains, and keeps what it was handed. */
function recordingExecutor(answer: ExecutionResult) {
  const seen: string[] = [];
  const executor: Executor = {
    async execute({ queryText }) {
      seen.push(queryText);
      return answer;
    },
  };
  return { executor, seen };
}

const CITY_ROWS: ExecutionResult = {
  head: { vars: ['city'] },
  results: {
    bindings: [
      { city: { type: 'uri', value: 'http://example.org/perth' } },
      { city: { type: 'uri', value: 'http://example.org/darwin' } },
    ],
  },
};

describe('a committed version-1 bundle', () => {
  it('passes the structural check as written', () => {
    expect(() => assertValidBundle(GOLDEN)).not.toThrow();
    expect(() => assertValidBundle(MINIMAL)).not.toThrow();
  });

  it('still matches the template hashes recorded when it was exported', async () => {
    // Not a re-test of the hashing: the fixture is committed text, so this is
    // the one place that says the bytes on disk are the bytes that were hashed.
    await expect(verifyBundleIntegrity(GOLDEN)).resolves.toBeUndefined();
    await expect(verifyBundleIntegrity(MINIMAL)).resolves.toBeUndefined();
  });

  it('splices arguments into the frozen template', () => {
    const query = fromBundle(GOLDEN).query('people-by-city');

    /*
     * The prefix table travels in the bundle so that a spliced IRI is abbreviated
     * exactly as the server's AST path abbreviates it. Both halves of that are
     * pinned here, because the boundary is not the prefix table — it is whether
     * the local name is spellable: `/` is not legal in PN_LOCAL, so
     * `http://example.org/city/perth` stays a full IRI under the same table that
     * abbreviates `http://example.org/perth`.
     */
    const abbreviated = query.text({
      arguments: [{ bindings: [{ city: iri('http://example.org/perth') }] }],
    });
    expect(abbreviated).toContain('VALUES ?city {');
    expect(abbreviated).toContain('ex:perth');
    expect(abbreviated).not.toContain('urn:sqlib:template-slot');

    const unabbreviable = query.text({
      arguments: [{ bindings: [{ city: iri('http://example.org/city/perth') }] }],
    });
    expect(unabbreviable).toContain('<http://example.org/city/perth>');
  });

  it('splices page parameters over the placeholders the export recorded', () => {
    const text = fromBundle(GOLDEN)
      .query('paged-things')
      .text({
        arguments: [{ bindings: [{ type: iri('http://example.org/City') }] }],
        limits: { '1': 25 },
        offsets: { '2': 50 },
      });

    expect(text).toContain('LIMIT 25');
    expect(text).toContain('OFFSET 50');
    expect(text).not.toContain('0001');
  });

  it('leaves an unsupplied page parameter as the placeholder, as the server does', () => {
    const text = fromBundle(GOLDEN)
      .query('paged-things')
      .text({ arguments: [{ bindings: [{ type: iri('http://example.org/City') }] }] });

    expect(text).toContain('LIMIT 0001');
    expect(text).toContain('OFFSET 0002');
  });

  it('walks the frozen group, feeding the upstream rows downstream', async () => {
    const { executor, seen } = recordingExecutor(CITY_ROWS);
    const library = fromBundle(GOLDEN, { executor });

    /*
     * A group's arguments are a flat list, not one entry per node: `head.vars`
     * says which slot each set fills. `cities` is the only node with an unfilled
     * slot, since the edge fills the other one.
     */
    await library.group('people-by-region').run({
      arguments: [
        {
          head: { vars: ['region'] },
          arguments: { bindings: [{ region: { type: 'uri', value: 'http://example.org/wa' } }] },
        },
      ],
    });

    expect(seen).toHaveLength(2);
    expect(seen[0]).toContain('ex:wa');
    // The edge renames nothing here (city -> city), so what this proves is that
    // the upstream answer reached the downstream slot — through the *downstream*
    // query's prefix table, which is what abbreviates the rows it did not author.
    expect(seen[1]).toContain('ex:perth');
    expect(seen[1]).toContain('ex:darwin');
  });

  it('runs a minimal bundle, which carries none of the optional fields', () => {
    const library = fromBundle(MINIMAL);
    expect(library.names()).toEqual(['people']);
    expect(library.groupNames()).toEqual([]);

    const text = library
      .query('people')
      .text({ arguments: [{ bindings: [{ city: iri('http://example.org/city/perth') }] }] });
    // No prefixes to abbreviate with, so the IRI is emitted in full — the other
    // half of the `prefixes` contract.
    expect(text).toContain('<http://example.org/city/perth>');
  });

  it('ignores a field it does not know rather than refusing the bundle', () => {
    /*
     * This is the property that makes a new optional field additive. Without it,
     * adding one to the format would break every consumer pinned to an older
     * runtime, and the only safe change would be a version bump — which is a
     * different, much more expensive contract than the one the format documents.
     */
    const newer = {
      ...GOLDEN,
      somethingLater: { added: 'by a newer exporter' },
      queries: {
        ...GOLDEN.queries,
        'people-by-city': { ...GOLDEN.queries['people-by-city'], perQueryFieldFromLater: 42 },
      },
    };

    expect(() => assertValidBundle(newer)).not.toThrow();
    expect(fromBundle(newer as ExportBundle).names()).toContain('people-by-city');
  });
});

describe('the fixture covers the format it is meant to freeze', () => {
  /**
   * Every optional field declared on the bundle's own interfaces, as
   * `Interface.field`.
   *
   * Read out of the source rather than listed here, because a hand-kept list is
   * exactly the thing that stops being true: the day someone adds an optional
   * field to `ExportedQuery`, this test has to notice without being edited.
   */
  const declaredOptionalFields = (): string[] => {
    const source = readFileSync(resolve(import.meta.dirname, '../src/bundle.ts'), 'utf8');
    // Comments carry `field?:` in prose, and would otherwise be read as fields.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const fields: string[] = [];

    for (const match of code.matchAll(/export interface (\w+) \{/g)) {
      const name = match[1];
      /*
       * Brace-matched rather than read as `\{([^}]*)\}`, which is what this was
       * first written as. `ExportBundle` declares `library: { id; name? }` inline,
       * so a body that stops at the first `}` stops before `groups`,
       * `generatedAt` and `tags` — and the guard then passed while checking
       * nothing at all about the bundle's own top level.
       */
      let depth = 0;
      let end = match.index + match[0].length;
      for (let i = match.index + match[0].length - 1; i < code.length; i += 1) {
        if (code[i] === '{') depth += 1;
        else if (code[i] === '}') {
          depth -= 1;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }

      // Drop nested object literals, so an optional field of an inline type is
      // not counted as a field of the interface that holds it.
      let body = code.slice(match.index + match[0].length, end);
      for (let previous = ''; previous !== body; ) {
        previous = body;
        body = body.replace(/\{[^{}]*\}/g, '');
      }
      for (const field of body.matchAll(/(\w+)\?:/g)) fields.push(`${name}.${field[1]}`);
    }
    return fields;
  };

  /**
   * Every `Interface.field` path the golden bundle carries a value at.
   *
   * Walked by hand rather than generically, because the type of a nested position
   * is not recoverable from the JSON: `queries` and `nodes` are records keyed by
   * slug, so a generic walk would read a slug as a field name.
   */
  const coveredFields = (): Set<string> => {
    const covered = new Set<string>();
    const record = (type: string, value: object) => {
      for (const [key, child] of Object.entries(value)) {
        if (child !== undefined) covered.add(`${type}.${key}`);
      }
    };

    record('ExportBundle', GOLDEN);
    for (const query of Object.values(GOLDEN.queries)) {
      record('ExportedQuery', query);
      for (const span of query.pageParameters ?? []) record('PageParameterSpan', span);
      for (const example of query.examples ?? []) record('QueryExample', example);
    }
    for (const group of Object.values(GOLDEN.groups ?? {})) {
      record('ExportedGroup', group);
      for (const node of Object.values(group.nodes)) record('ExportedGroupNode', node);
      for (const edge of group.edges) record('ExportedGroupEdge', edge);
    }
    return covered;
  };

  it('carries a value for every optional field the format declares', () => {
    const covered = coveredFields();
    const declared = declaredOptionalFields();
    // A guard that resolved nothing would pass whatever came next, and the
    // interface most likely to be dropped by a parsing slip is the one whose
    // body holds an inline object — so it is named rather than counted.
    expect(declared.length).toBeGreaterThan(20);
    expect(declared).toContain('ExportBundle.groups');
    expect(declared).toContain('ExportBundle.generatedAt');

    expect(
      declared.filter((field) => !covered.has(field)),
      'declared in bundle.ts but absent from bundle-v1.json, so nothing tests that a reader still ' +
        'tolerates it. Teach packages/api/test/lib/export/fixtures/goldenBundleV1.ts to emit it, ' +
        'then re-run with UPDATE_BUNDLE_FIXTURE=1.',
    ).toEqual([]);
  });
});
