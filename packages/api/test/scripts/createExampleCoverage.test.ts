/**
 * The `examples/` sidecar: an entity's create body carries an example because a
 * file is *named* the right way.
 *
 * `buildCreateExampleLookup` globs `examples/workflows/basic-workflow` for
 * `^\d+-create-(.+)\.json$` and keys the result by the kebab-cased entity name,
 * so `01-create-backend.json` is what puts an `examples` array on
 * `createBackendSchema.body`. Renaming or renumbering that file drops the
 * example from the saved contract and nothing fails — the generator simply
 * finds no match and emits a body without one.
 *
 * Phase B4 (issue #65) asked whether the entity model should point at its
 * example instead. It should not: six of the forty-six entities have an example
 * at all, so what is scarce is examples, not a way to name them. What was
 * missing is this test. It pins the six that exist, in both directions — the
 * file has to be there, and the contract has to carry what it contains.
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildCreateExampleLookup } from '../../scripts/lib/file-ops.js';
import {
  createBackendSchema,
  createLibrarySchema,
  createQuerySchema,
  createQueryGroupSchema,
} from '@sparql-query-lib/contracts/schema';

const EXAMPLES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../examples');

/** Every entity that has a create example today, by the slug the lookup keys on. */
const ENTITIES_WITH_EXAMPLES = [
  'backend',
  'library',
  'query',
  'query-version',
  'query-group',
  'query-group-version',
];

describe('create example coverage', () => {
  const lookup = buildCreateExampleLookup(EXAMPLES_DIR);

  it('finds an example for every entity that has one', () => {
    // Sorted rather than iterated so a *new* example shows up here too: adding
    // one and not listing it is a decision worth stating, the same way removing
    // one is.
    expect(Object.keys(lookup).sort()).toEqual([...ENTITIES_WITH_EXAMPLES].sort());
  });

  it.each(ENTITIES_WITH_EXAMPLES)('resolves %s to a readable example file', slug => {
    const file = path.join(EXAMPLES_DIR, lookup[slug]);

    expect(fs.existsSync(file), `${lookup[slug]} is missing`).toBe(true);
    expect(() => JSON.parse(fs.readFileSync(file, 'utf-8'))).not.toThrow();
  });

  it('saves the example on the create body the generator built', () => {
    // The lookup finding a file is only half of it — the contract has to carry
    // it. These four are the create routes the generator emits a body for.
    for (const schema of [
      createBackendSchema,
      createLibrarySchema,
      createQuerySchema,
      createQueryGroupSchema,
    ]) {
      const body = schema.body as { examples?: unknown[] };
      expect(body.examples).toHaveLength(1);
    }
  });
});
