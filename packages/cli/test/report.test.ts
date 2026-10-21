import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PEOPLE, sqlib, workspace } from './helpers.js';

let duckdbAvailable = true;
try {
  await import('@duckdb/node-api');
} catch {
  duckdbAvailable = false;
}

const GOLDEN = path.resolve(import.meta.dirname, '../../runtime/test/fixtures/bundle-v1.json');
const SRL = `PREFIX : <http://ex/>
RULE { ?x :anc ?z } WHERE { ?x :parent ?z }
RULE { ?x :anc ?z } WHERE { ?x :anc ?y . ?y :parent ?z }`;

const sha256 = (text: string) => `sha256-${createHash('sha256').update(text).digest('hex')}`;

describe('--report', () => {
  it('records a rule set run: what ran, how it ended, and the hash of what it wrote', async () => {
    const dir = await workspace({ 'anc.srl': SRL, 'people.ttl': PEOPLE });
    const { status } = await sqlib(dir, [
      'rules', 'run', '--srl', 'anc.srl', '--data', 'people.ttl', '--out', 'out.nt', '--report', 'report.json',
    ]);
    expect(status).toBe(0);
    const report = JSON.parse(await readFile(path.join(dir, 'report.json'), 'utf8'));
    const output = await readFile(path.join(dir, 'out.nt'), 'utf8');
    expect(report).toMatchObject({
      command: 'rules run',
      status: 'converged',
      ruleSet: { file: 'anc.srl', textHash: sha256(SRL) },
      data: ['people.ttl'],
      triplesInferred: 3,
      output: { path: 'out.nt', format: 'application/n-triples', bytes: Buffer.byteLength(output), sha256: sha256(output) },
    });
    expect(report.stagesMs).toHaveProperty('run');
    expect(Date.parse(report.finishedAt)).toBeGreaterThanOrEqual(Date.parse(report.startedAt));
  });

  it('writes a report for a failed run, with the error', async () => {
    const dir = await workspace({ 'bad.srl': 'RULE { ?x' });
    const { status } = await sqlib(dir, ['rules', 'run', '--srl', 'bad.srl', '--report', 'report.json']);
    expect(status).toBe(1);
    const report = JSON.parse(await readFile(path.join(dir, 'report.json'), 'utf8'));
    expect(report.status).toBe('failed');
    expect(report.error).toContain('does not parse');
  });

  it('refuses to write the report and the data both to standard output', async () => {
    const dir = await workspace({ 'anc.srl': SRL });
    const { status, stderr } = await sqlib(dir, ['rules', 'run', '--srl', 'anc.srl', '--report', '-']);
    expect(status).toBe(1);
    expect(stderr).toContain('pass --out <file>');
  });

  it.skipIf(!duckdbAvailable)('records an ETL job run from a bundle, with its provenance and DuckDB profile', async () => {
    // The golden job reads customers.csv from the directory sqlib runs in.
    const dir = await workspace({ 'golden.json': await readFile(GOLDEN, 'utf8'), 'customers.csv': 'id,name,joined\n1,Ann,2020-01-02 03:04:05\n2,Bo,\n' });
    const previous = process.cwd();
    process.chdir(dir);
    try {
      const { status } = await sqlib(dir, [
        'etl', 'run', '--bundle', 'golden.json', '--job', 'customers', '--out', 'out.nt', '--report', '-',
      ]).then(async result => {
        const report = JSON.parse(result.stdout);
        const output = await readFile(path.join(dir, 'out.nt'), 'utf8');
        expect(report).toMatchObject({
          command: 'etl run',
          status: 'ok',
          job: {
            bundle: 'golden.json',
            key: 'customers',
            sqlHash: sha256("SELECT id, name, joined FROM read_csv('customers.csv')"),
            sourceJob: 'urn:sqlib:etl-job:customers',
            sourceColumnMappingVersion: 'urn:sqlib:etl-column-mapping-version:customers-1',
          },
          duckdb: { capabilities: { filesystem: true, http: false } },
          chunkSize: 500,
          rows: 2,
          chunks: 1,
          output: { path: 'out.nt', sha256: sha256(output) },
        });
        expect(Object.keys(report.stagesMs)).toEqual(expect.arrayContaining(['duckdbInit', 'extract', 'construct', 'write']));
        return result;
      });
      expect(status).toBe(0);
    } finally {
      process.chdir(previous);
    }
  });
});
