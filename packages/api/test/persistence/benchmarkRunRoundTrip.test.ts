/**
 * The write-then-reload round trip for the fields a run of selected cases
 * records (issue #251): `caseIds`, `pass` and `context`.
 *
 * The cache keeps the live object, so a route test reads these back intact
 * whatever the store does. This writes to triples and reads back from triples,
 * as `loadAll` does after a restart.
 */
import { describe, expect, it } from 'vitest';
import { BenchmarkRunSchema } from '../../src/persistence/schemas/BenchmarkRunSchema.js';
import { serialiseEntity } from '../../src/persistence/EntitySerialiser.js';
import { assembleEntity, type BindingRow } from '../../src/persistence/EntityAssembler.js';

const RUN_ID = 'urn:sqlib:benchmark-run:round-trip';

function literalValue(term: string): string {
  const quoted = term.startsWith('"') ? term.slice(1, term.lastIndexOf('"')) : term.slice(1, -1);
  return quoted
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

function reload(entity: Record<string, unknown>) {
  const rows = serialiseEntity(BenchmarkRunSchema as never, entity).map((triple) => ({
    id: { type: 'uri', value: RUN_ID },
    p: { type: 'uri', value: triple.predicate.slice(1, -1) },
    o: { type: 'literal', value: literalValue(triple.object) },
  })) as unknown as BindingRow[];
  return assembleEntity(BenchmarkRunSchema as never, rows)!;
}

const RUN = {
  $id: RUN_ID,
  structure: 'urn:sqlib:dsd:benchmark-observation',
  definedBy: 'urn:sqlib:benchmark-experiment-version:1',
  runStatus: 'Completed',
  tasksTotal: 2,
  tasksCompleted: 2,
};

describe('BenchmarkRun selection fields survive a store round trip', () => {
  it('keeps the selected case ids, the pass and the context', () => {
    const context = { pageCache: 'dropped', peakCpuC: 61.5, throttled: false, storeBuild: 'oxigraph 0.5.2', unset: null };
    const run = reload({ ...RUN, caseIds: ['a1b2c3d4e5f60718', 'scan-b'], pass: 'cold-1', context });

    expect([...(run.caseIds as string[])].sort()).toEqual(['a1b2c3d4e5f60718', 'scan-b']);
    expect(run.pass).toBe('cold-1');
    expect(run.context).toEqual(context);
  });

  it('leaves the fields absent on a run of every case', () => {
    const run = reload(RUN);
    expect(run.caseIds ?? []).toEqual([]);
    expect(run.pass ?? null).toBeNull();
    expect(run.context ?? null).toBeNull();
  });
});
