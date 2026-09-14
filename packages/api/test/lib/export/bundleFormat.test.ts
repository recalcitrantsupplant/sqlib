/**
 * The bundle format's writer half: what `sqlib export` puts on disk.
 *
 * Every other test in this directory builds a bundle and asserts on the object
 * it got back, and `packages/runtime`'s tests build one with their own helper
 * (`test/helpers.ts`) and assert the reader accepts it. Between them the wire
 * format is never pinned: writer and reader can change together, or the helper
 * can drift from the writer, and everything stays green. That is fine while the
 * runtime is a workspace package. It stops being fine the moment it is on npm
 * (#258), because a consumer's stored bundle and their installed runtime are
 * then two versions that move independently.
 *
 * So the format has a golden file — a real bundle, committed, produced by the
 * route's own three steps over `fixtures/goldenBundleV1.ts`:
 *
 *     packages/runtime/test/fixtures/bundle-v1.json
 *
 * This test rebuilds it and compares. Any change to the bytes the writer emits
 * then arrives as a diff in that file, in the PR that causes it, where the
 * author has to answer the only question that matters: is this additive (a new
 * optional field, which an old reader ignores) or breaking (bump
 * `ExportBundle.version`)?
 *
 * The fixture lives in `packages/runtime` rather than here because the reader is
 * the party that has to keep reading it: `packages/runtime/test/bundleFormat`
 * loads the same file and runs it, which is the half that survives publishing.
 *
 * To adopt an intended change:
 *
 *     UPDATE_BUNDLE_FIXTURE=1 pnpm --filter @sparql-query-lib/api test bundleFormat
 *
 * then read the diff before committing it.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifyBundleIntegrity } from '@sparql-query-lib/runtime';
import { buildGoldenBundleV1 } from './fixtures/goldenBundleV1.js';

const FIXTURE = resolve(
  import.meta.dirname,
  '../../../../runtime/test/fixtures/bundle-v1.json',
);

/** The file is committed, so it is written the way a formatter would write it. */
const serialise = (bundle: unknown) => `${JSON.stringify(bundle, null, 2)}\n`;

describe('the exported bundle format, version 1', () => {
  it('writes the bytes the committed fixture holds', async () => {
    const built = serialise(await buildGoldenBundleV1());

    if (process.env.UPDATE_BUNDLE_FIXTURE) {
      writeFileSync(FIXTURE, built);
      return;
    }

    const committed = readFileSync(FIXTURE, 'utf8');
    /*
     * Compared as text rather than as objects, because key order is part of what
     * a golden file freezes: a reader is free to ignore it, but a diff that
     * reorders every key hides the one field that was added.
     */
    expect(
      built,
      'the export writes a different bundle than the committed fixture. If the change is intended, ' +
        're-run with UPDATE_BUNDLE_FIXTURE=1 and decide in the PR whether it is additive (a new ' +
        'optional field an older runtime ignores) or breaking (bump ExportBundle.version).',
    ).toBe(committed);
  });

  it('is reproducible: two exports of one library agree', async () => {
    // Slug assignment, example ordering and group key reservation all iterate
    // collections, and `collectQueryExamples` sorts for exactly this reason. A
    // golden file is only a contract if re-running produces it again.
    const [first, second] = await Promise.all([buildGoldenBundleV1(), buildGoldenBundleV1()]);
    expect(serialise(first)).toBe(serialise(second));
  });

  it('writes template hashes that match the text it wrote', async () => {
    await expect(verifyBundleIntegrity(await buildGoldenBundleV1())).resolves.toBeUndefined();
  });
});
