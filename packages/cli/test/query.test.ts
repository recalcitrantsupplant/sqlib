import { PEOPLE, sqlib, workspace } from './helpers.js';

const BY_CITY = `PREFIX ex: <http://ex/>
SELECT ?person WHERE { VALUES ?city { UNDEF } ?person ex:livesIn ?city } ORDER BY ?person LIMIT 0001`;

describe('sqlib query', () => {
  it('runs a parameterised SELECT on data files, as sqlib applies parameters', async () => {
    const dir = await workspace({ 'q.rq': BY_CITY, 'people.ttl': PEOPLE });
    const { status, stdout } = await sqlib(dir, ['query', '--file', 'q.rq', '--data', 'people.ttl', '--arg', 'city=<http://ex/Perth>', '--limit', '1=1']);
    expect(status).toBe(0);
    expect(JSON.parse(stdout).results.bindings).toEqual([{ person: { type: 'uri', value: 'http://ex/ann' } }]);
  });

  it('makes one row per --arg for the same variable', async () => {
    const dir = await workspace({ 'q.rq': BY_CITY.replace('LIMIT 0001', ''), 'people.ttl': PEOPLE });
    const { stdout } = await sqlib(dir, ['query', '--file', 'q.rq', '--data', 'people.ttl', '--arg', 'city=<http://ex/Perth>', '--arg', 'city=<http://ex/Hobart>']);
    expect(JSON.parse(stdout).results.bindings).toHaveLength(3);
  });

  it('prints the substituted query with --text, without data', async () => {
    const dir = await workspace({ 'q.rq': BY_CITY });
    const { status, stdout } = await sqlib(dir, ['query', '--file', 'q.rq', '--arg', 'city="Perth"@en', '--limit', '1=20', '--text']);
    expect(status).toBe(0);
    expect(stdout).toContain('VALUES ?city { "Perth"@en }');
    expect(stdout).toContain('LIMIT 20');
  });

  it('prints RDF for a CONSTRUCT, in the format asked for', async () => {
    const dir = await workspace({ 'c.rq': 'CONSTRUCT { ?s <http://ex/in> ?o } WHERE { ?s <http://ex/livesIn> ?o }', 'people.ttl': PEOPLE });
    const { status, stdout } = await sqlib(dir, ['query', '--file', 'c.rq', '--data', 'people.ttl', '--format', 'n-triples']);
    expect(status).toBe(0);
    expect(stdout.trim().split('\n').sort()[0]).toBe('<http://ex/ann> <http://ex/in> <http://ex/Perth> .');
  });

  it('reads the query from standard input', async () => {
    const dir = await workspace({ 'people.ttl': PEOPLE });
    const { stdout } = await sqlib(dir, ['query', '--file', '-', '--data', 'people.ttl'], 'ASK { ?s <http://ex/parent> ?o }');
    expect(JSON.parse(stdout).boolean).toBe(true);
  });

  it('refuses a term it cannot read, and says how to write one', async () => {
    const dir = await workspace({ 'q.rq': BY_CITY });
    const { status, stderr } = await sqlib(dir, ['query', '--file', 'q.rq', '--arg', 'city=Perth', '--text']);
    expect(status).toBe(1);
    expect(stderr).toContain(`Cannot read 'Perth' as a term`);
  });

  it('refuses --endpoint and --data together', async () => {
    const dir = await workspace({ 'q.rq': BY_CITY, 'people.ttl': PEOPLE });
    const { status, stderr } = await sqlib(dir, ['query', '--file', 'q.rq', '--data', 'people.ttl', '--endpoint', 'http://localhost:9/sparql']);
    expect(status).toBe(1);
    expect(stderr).toContain('Pass --endpoint or --data, not both.');
  });
});
