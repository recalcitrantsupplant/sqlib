import { duckDbProfile } from '../src/duckdb.js';
import { sqlib, workspace } from './helpers.js';

describe('sqlib check', () => {
  it('reports each file, and exits 1 when any has a problem', async () => {
    const dir = await workspace({
      'good.rq': 'SELECT * WHERE { VALUES ?x { UNDEF } ?x ?p ?o } LIMIT 0001',
      'bad.rq': 'SELECT WHERE {',
      'rules.srl': 'PREFIX : <http://ex/>\nRULE { ?x :b ?y } WHERE { ?x :a ?y }\n',
    });
    const { status, stdout } = await sqlib(dir, ['check', 'good.rq', 'bad.rq', 'rules.srl']);
    expect(status).toBe(1);
    expect(stdout).toContain('good.rq: ok, SELECT, parameters ?x, LIMIT 1');
    expect(stdout).toMatch(/bad\.rq: .*parse/i);
    expect(stdout).toContain('rules.srl: ok, 1 rule in 1 stratum, 0 DATA blocks');
  });
});

describe('the DuckDB profile from flags', () => {
  it('reads local files and nothing else by default', () => {
    expect(duckDbProfile({}).capabilities).toEqual({ filesystem: true, http: false, extensionInstall: false, unrestricted: false });
  });

  it('turns filesystem back on for --allow-http, and says so', () => {
    const { capabilities, notes } = duckDbProfile({ 'allow-http': true, 'allow-filesystem': false });
    expect(capabilities.filesystem).toBe(true);
    expect(notes).toEqual(['--allow-http grants filesystem access too: DuckDB gates both on one setting.']);
  });

  it('takes the memory limit and query timeout', () => {
    expect(duckDbProfile({ 'memory-limit': '4GB', 'query-timeout': '0' }).limits).toMatchObject({ memoryLimit: '4GB', queryTimeoutMs: 0 });
    expect(duckDbProfile({ 'memory-limit': '' }).limits.memoryLimit).toBeNull();
  });
});

describe('sqlib', () => {
  it('lists the commands, and refuses one it does not know', async () => {
    const dir = await workspace({});
    expect((await sqlib(dir, ['--help'])).stdout).toContain('sqlib rules run');
    const unknown = await sqlib(dir, ['frobnicate']);
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain(`Unknown command 'frobnicate'`);
  });

  it('prints a command help with its options', async () => {
    const dir = await workspace({});
    const { status, stdout } = await sqlib(dir, ['etl', 'run', '--help']);
    expect(status).toBe(0);
    expect(stdout).toContain('--no-allow-filesystem');
  });
});
