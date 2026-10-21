import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { sqlib, workspace } from './helpers.js';

let duckdbAvailable = true;
try {
  await import('@duckdb/node-api');
} catch {
  duckdbAvailable = false;
}

const CSV = 'id,name,joined\n1,Ann Lee,2020-01-02 03:04:05\n2,Bo,\n,Gone,\n';
const TEMPLATE = `PREFIX ex: <http://ex/>
CONSTRUCT { ?c ex:name ?name ; ex:joined ?joined } WHERE { VALUES (?c ?name ?joined) { (UNDEF UNDEF UNDEF) } }`;
const COLUMNS = [
  { columnName: 'id', targetVariable: 'c', termType: 'uri', iriTemplate: 'http://ex/c/{value}', nullPolicy: 'skipRow' },
  { columnName: 'name', targetVariable: 'name', termType: 'literal', nullPolicy: 'undef' },
  { columnName: 'joined', targetVariable: 'joined', termType: 'literal', datatypeIri: 'http://www.w3.org/2001/XMLSchema#dateTime', nullPolicy: 'undef' },
];

async function job(extra: Record<string, unknown> = {}) {
  const dir = await workspace({ 'customers.csv': CSV, 'construct.rq': TEMPLATE });
  // SQL paths resolve against the process's directory, so the CSV is named in full.
  const sql = `SELECT * FROM read_csv('${path.join(dir, 'customers.csv').replace(/'/g, "''")}')`;
  await import('node:fs/promises').then(fs => fs.writeFile(
    path.join(dir, 'job.json'),
    JSON.stringify({ sql, templateFile: 'construct.rq', columns: COLUMNS, chunkSize: 2, ...extra }),
  ));
  return dir;
}

describe.skipIf(!duckdbAvailable)('sqlib etl run', () => {
  it('reads the source in chunks and writes N-Triples', async () => {
    const dir = await job();
    const { status, stdout, stderr } = await sqlib(dir, ['etl', 'run', '--job', 'job.json']);
    expect(status).toBe(0);
    expect(stdout.trim().split('\n').sort()).toEqual([
      '<http://ex/c/1> <http://ex/joined> "2020-01-02T03:04:05"^^<http://www.w3.org/2001/XMLSchema#dateTime> .',
      '<http://ex/c/1> <http://ex/name> "Ann Lee" .',
      '<http://ex/c/2> <http://ex/name> "Bo" .',
    ]);
    expect(stderr).toContain('filesystem=true http=false');
    expect(stderr).toContain('3 rows in 2 chunks');
  });

  it('writes to a file with --out, and stops after one chunk with --dry-run', async () => {
    const dir = await job();
    const { status, stderr } = await sqlib(dir, ['etl', 'run', '--job', 'job.json', '--out', 'out.nt', '--dry-run']);
    expect(status).toBe(0);
    expect(stderr).toContain('2 rows in 1 chunks');
    expect((await readFile(path.join(dir, 'out.nt'), 'utf8'))).toContain('<http://ex/c/1>');
  });

  it('writes Turtle when asked', async () => {
    const dir = await job();
    const { stdout } = await sqlib(dir, ['etl', 'run', '--job', 'job.json', '--format', 'turtle']);
    expect(stdout).toContain('<http://ex/c/2> <http://ex/name> "Bo"');
  });

  it('keeps blank nodes from different chunks apart, so chunks concatenate safely', async () => {
    const dir = await job({
      chunkSize: 1,
      template: 'CONSTRUCT { ?c <http://ex/address> [ <http://ex/line> ?name ] } WHERE { VALUES (?c ?name) { (UNDEF UNDEF) } }',
      templateFile: undefined,
      columns: COLUMNS.slice(0, 2),
    });
    const { stdout } = await sqlib(dir, ['etl', 'run', '--job', 'job.json', '--format', 'turtle']);
    const labels = new Set([...stdout.matchAll(/_:(\w+)/g)].map(match => match[1]));
    expect(labels.size).toBe(2);
    expect(stdout).not.toContain('@prefix');
  });

  it('cannot read the file with --no-allow-filesystem', async () => {
    const dir = await job();
    const { status, stderr } = await sqlib(dir, ['etl', 'run', '--job', 'job.json', '--no-allow-filesystem']);
    expect(status).toBe(1);
    expect(stderr).toContain('filesystem=false');
  });

  it('refuses a template whose slot does not declare a mapped column', async () => {
    const dir = await job({ columns: [...COLUMNS, { columnName: 'x', targetVariable: 'extra', termType: 'literal', nullPolicy: 'undef' }] });
    const { status, stderr } = await sqlib(dir, ['etl', 'run', '--job', 'job.json']);
    expect(status).toBe(1);
    expect(stderr).toContain('does not declare ?extra');
  });
});
