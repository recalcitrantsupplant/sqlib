/**
 * A test of the oracle, not of the code under test.
 *
 * The equivalence suite's value rests entirely on `assertEquivalent` being able
 * to fail. A comparison that passes on a patch known to be wrong would let the
 * whole suite pass while proving nothing, so the failure path is exercised
 * directly.
 */

import { describe, expect, it } from 'vitest';
import { applyPatch, canonical, patchFor, storeFrom } from './support/harness.js';

const DATA = '<http://ex/a> <http://ex/p> <http://ex/b> .\n<http://ex/c> <http://ex/p> <http://ex/d> .\n';

describe('the equivalence oracle', () => {
  it('notices when a patch leaves out a deletion', async () => {
    const direct = storeFrom(DATA);
    const viaPatch = storeFrom(DATA);
    const patch = await patchFor(viaPatch, 'DELETE WHERE { ?s <http://ex/p> ?o }');

    direct.update('DELETE WHERE { ?s <http://ex/p> ?o }');
    applyPatch(viaPatch, { ...patch, deletions: patch.deletions.slice(1) });

    expect(await canonical(direct)).not.toBe(await canonical(viaPatch));
  });

  it('notices when a patch adds one triple too many', async () => {
    const direct = storeFrom(DATA);
    const viaPatch = storeFrom(DATA);
    const update = 'INSERT DATA { <http://ex/n> <http://ex/p> <http://ex/o> }';
    const patch = await patchFor(viaPatch, update);

    direct.update(update);
    applyPatch(viaPatch, {
      ...patch,
      additions: [
        ...patch.additions,
        {
          subject: { termType: 'NamedNode', value: 'http://ex/extra' },
          predicate: { termType: 'NamedNode', value: 'http://ex/p' },
          object: { termType: 'NamedNode', value: 'http://ex/o' },
        },
      ],
    });

    expect(await canonical(direct)).not.toBe(await canonical(viaPatch));
  });

  it('sees through blank node relabelling, so a correct patch is not a false failure', async () => {
    const update = 'INSERT { ?s <http://ex/about> [ <http://ex/of> ?o ] } WHERE { ?s <http://ex/p> ?o }';
    const direct = storeFrom(DATA);
    const viaPatch = storeFrom(DATA);
    const patch = await patchFor(viaPatch, update);

    direct.update(update);
    applyPatch(viaPatch, patch);

    // Different labels for the same structure: only canonicalisation calls
    // these equal, and dumping them raw does not.
    expect(await canonical(direct)).toBe(await canonical(viaPatch));
  });
});
