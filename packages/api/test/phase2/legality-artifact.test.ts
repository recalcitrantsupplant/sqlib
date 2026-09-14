/**
 * Writes the edge-legality oracle to the checked-in artifact both suites read.
 *
 * `packages/contracts/fixtures/query-group-edge-legality.json` is the one
 * statement of which (source kind x flow type x target kind) cells the backend
 * accepts. This side proves the artifact matches the oracle that
 * `legality-matrix.test.ts` proves against the real implementation; the web
 * side (`canvasBackendLegality.test.ts`) proves the canvas connection rules
 * agree with the artifact. Drift anywhere turns exactly one suite red.
 *
 * Regenerate after an intentional rule change with:
 *
 *   pnpm --filter @sparql-query-lib/api exec vitest run test/phase2/legality-artifact.test.ts -u
 */

import { describe, it, expect } from 'vitest';
import { legalityTable } from './harness/legality-expectations.js';

describe('edge legality artifact', () => {
  it('matches the oracle', async () => {
    const table = legalityTable();
    expect(table.length).toBe(160);
    await expect(JSON.stringify(table, null, 2) + '\n').toMatchFileSnapshot(
      '../../../contracts/fixtures/query-group-edge-legality.json',
    );
  });
});
