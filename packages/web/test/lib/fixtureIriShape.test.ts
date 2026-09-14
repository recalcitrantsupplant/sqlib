/**
 * Fixture IRI-shape guard.
 *
 * A version badge in the sidebar used to be produced by parsing a number out of
 * the `currentVersion` IRI. That could never work — the API mints
 * `urn:sqlib:query-version:<uuid>`, which carries no number — and it went
 * unnoticed for as long as it did because several fixtures wrote IRIs like
 * `urn:sqlib:query:test-1:v1`: the entity's own prefix with a version suffix,
 * a shape nothing has ever produced. The regex matched the fixtures, the specs
 * passed, and the feature was broken against every real backend.
 *
 * The existing mock-drift guard could not have caught it: it replays fixtures
 * through the contract schemas, and every `urn:` string satisfies `isIri`. The
 * shape of an identifier is not something a contract constrains.
 *
 * So this checks the one thing that was wrong: an entity's `currentVersion`
 * must look like a version IRI, not like the entity's own IRI with a suffix.
 * It is deliberately narrow — a fixture using a readable local part
 * (`urn:sqlib:query-version:visual-v1`) is fine, because a local part is
 * opaque; what is not fine is the wrong prefix.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const E2E_DIR = join(__dirname, '../../tests/e2e');

/** Every `currentVersion: '<iri>'` literal in the e2e fixtures and specs. */
function currentVersionLiterals(): Array<{ file: string; iri: string }> {
  const found: Array<{ file: string; iri: string }> = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.endsWith('-snapshots')) continue;
        walk(path);
        continue;
      }
      if (!entry.name.endsWith('.ts')) continue;

      const source = readFileSync(path, 'utf8');
      /*
       * Both `currentVersion: '…'` in an object literal and
       * `entity.currentVersion = '…'` in a setup block. The first version of
       * this guard matched only the former and passed while the worst offender
       * — a spec assigning the entity IRI with a `:v1` suffix — sat in the
       * latter, which is the same shape of miss it exists to catch.
       */
      for (const match of source.matchAll(/currentVersion\s*[:=]\s*'([^']+)'/g)) {
        found.push({ file: entry.name, iri: match[1]! });
      }
    }
  };

  walk(E2E_DIR);
  return found;
}

/**
 * The minting convention, from `packages/api/src/lib/id.ts`: a version IRI's
 * kind segment ends in `-version`.
 */
const VERSION_IRI = /^urn:sqlib:[a-z-]+-version:/;

describe('e2e fixtures use realistic version IRIs', () => {
  const literals = currentVersionLiterals();

  it('finds some to check, so this assertion is not vacuous', () => {
    expect(literals.length).toBeGreaterThan(0);
  });

  it('never points currentVersion at an entity-shaped IRI', () => {
    const wrong = literals.filter((entry) => !VERSION_IRI.test(entry.iri));

    expect(
      wrong,
      'currentVersion must be a version IRI (urn:sqlib:<kind>-version:…), not the ' +
        'entity IRI with a :vN suffix — that shape is never minted, and a client ' +
        'that reads it will pass here and fail against a real backend:\n' +
        wrong.map((entry) => `  ${entry.file}: ${entry.iri}`).join('\n'),
    ).toEqual([]);
  });
});
