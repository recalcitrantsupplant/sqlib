import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { compileQueryTemplate } from '@sparql-query-lib/compiler';
import { hashTemplateText, type ExportBundle } from '@sparql-query-lib/runtime';
import { PEOPLE, sqlib, workspace } from './helpers.js';

let duckdbAvailable = true;
try {
  await import('@duckdb/node-api');
} catch {
  duckdbAvailable = false;
}

const BY_CITY = `PREFIX ex: <http://ex/>
SELECT ?person WHERE { VALUES ?city { UNDEF } ?person ex:livesIn ?city } ORDER BY ?person`;
const JOB_TEMPLATE = `PREFIX ex: <http://ex/>
CONSTRUCT { ?c ex:name ?name } WHERE { VALUES (?c ?name) { (UNDEF UNDEF) } }`;
const SRL = `RULE { ?x <http://ex/anc> ?z } WHERE { ?x <http://ex/parent> ?z }
RULE { ?x <http://ex/anc> ?z } WHERE { ?x <http://ex/anc> ?y . ?y <http://ex/parent> ?z }`;

/** A bundle as the server's export writes one: a query, an ETL job and a rule set. */
async function exportedBundle(sql = "SELECT 1 AS id, 'Ann' AS name"): Promise<ExportBundle> {
  const query = compileQueryTemplate(BY_CITY, { name: 'by city' });
  const job = compileQueryTemplate(JOB_TEMPLATE, { name: 'customers' });
  return {
    version: 1,
    library: { id: 'urn:sqlib:library:main', name: 'Main' },
    queries: {
      'by-city': {
        template: query.template,
        queryType: query.queryType,
        limitParameters: [],
        offsetParameters: [],
        inferredInputs: query.inferredInputs,
        textHash: await hashTemplateText(query.template.text),
      },
    },
    etlJobs: {
      customers: {
        template: job.template,
        textHash: await hashTemplateText(job.template.text),
        sql,
        columns: [
          { columnName: 'id', targetVariable: 'c', termType: 'uri', iriTemplate: 'http://ex/c/{value}', nullPolicy: 'skipRow' },
          { columnName: 'name', targetVariable: 'name', termType: 'literal', nullPolicy: 'undef' },
        ],
      },
    },
    ruleSets: {
      ancestors: { srl: SRL, textHash: await hashTemplateText(SRL), ruleCount: 2, dataBlockCount: 0 },
    },
  };
}

async function bundleWorkspace(bundle?: ExportBundle) {
  return workspace({ 'bundle.json': JSON.stringify(bundle ?? await exportedBundle()), 'people.ttl': PEOPLE });
}

describe('--bundle', () => {
  it('runs a query from a bundle', async () => {
    const dir = await bundleWorkspace();
    const { status, stdout } = await sqlib(dir, [
      'query', '--bundle', 'bundle.json', '--query', 'by-city', '--arg', 'city=<http://ex/Perth>', '--data', 'people.ttl',
    ]);
    expect(status).toBe(0);
    expect(JSON.parse(stdout).results.bindings.map((row: { person: { value: string } }) => row.person.value))
      .toEqual(['http://ex/ann', 'http://ex/cy']);
  });

  it('names the keys a bundle has when asked for one it does not', async () => {
    const dir = await bundleWorkspace();
    const { status, stderr } = await sqlib(dir, ['query', '--bundle', 'bundle.json', '--query', 'toString', '--text']);
    expect(status).toBe(1);
    expect(stderr).toContain("has no query 'toString'. It has: by-city.");
  });

  it('refuses a bundle whose text was edited by hand', async () => {
    const bundle = await exportedBundle();
    bundle.queries['by-city']!.template.text = bundle.queries['by-city']!.template.text.replace('person', 'who');
    const dir = await bundleWorkspace(bundle);
    const { status, stderr } = await sqlib(dir, ['query', '--bundle', 'bundle.json', '--query', 'by-city', '--text']);
    expect(status).toBe(1);
    expect(stderr).toContain('has been edited');
  });

  it('runs a rule set from a bundle', async () => {
    const dir = await bundleWorkspace();
    const { status, stdout } = await sqlib(dir, ['rules', 'run', '--bundle', 'bundle.json', '--rule-set', 'ancestors', '--data', 'people.ttl']);
    expect(status).toBe(0);
    expect(stdout).toContain('<http://ex/ann> <http://ex/anc> <http://ex/cy> .');
  });

  it.skipIf(!duckdbAvailable)('runs an ETL job from a bundle', async () => {
    const dir = await bundleWorkspace();
    const { status, stdout } = await sqlib(dir, ['etl', 'run', '--bundle', 'bundle.json', '--job', 'customers']);
    expect(status).toBe(0);
    expect(stdout.trim()).toBe('<http://ex/c/1> <http://ex/name> "Ann" .');
  });

  it('checks a bundle and lists its keys', async () => {
    const dir = await bundleWorkspace();
    const { status, stdout } = await sqlib(dir, ['check', 'bundle.json']);
    expect(status).toBe(0);
    expect(stdout).toBe('bundle.json: ok, bundle of Main\n  queries: by-city\n  ETL jobs: customers\n  rule sets: ancestors\n');
  });
});

describe('the committed golden bundle, as the server exports it', () => {
  const GOLDEN = path.resolve(import.meta.dirname, '../../runtime/test/fixtures/bundle-v1.json');

  it('checks, and its rule set runs with its seed rows', async () => {
    const dir = await workspace({ 'golden.json': await readFile(GOLDEN, 'utf8') });
    const check = await sqlib(dir, ['check', 'golden.json']);
    expect(check.status).toBe(0);
    expect(check.stdout).toContain('ETL jobs: customers');
    expect(check.stdout).toContain('rule sets: ancestors');

    const run = await sqlib(dir, ['rules', 'run', '--bundle', 'golden.json', '--rule-set', 'ancestors']);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('<http://example.org/ann> <http://example.org/anc> <http://example.org/bo> .');
  });
});

describe('sqlib pull', () => {
  async function serve(answer: (url: string, headers: IncomingHttpHeaders) => { status: number; body: unknown }) {
    const server = createServer((request, response) => {
      const { status, body } = answer(request.url ?? '', request.headers);
      response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api` };
  }

  it('writes the bundle, sends the token from the environment, and reports what was skipped', async () => {
    const bundle = await exportedBundle();
    let seen: { url: string; authorization?: string } | undefined;
    const { server, url } = await serve((requestUrl, headers) => {
      seen = { url: requestUrl, authorization: headers.authorization };
      return { status: 200, body: { bundle, skipped: [{ id: 'j2', name: 'Draft', reason: 'The job has no current version.' }] } };
    });
    process.env.SQLIB_TEST_TOKEN = 'secret';
    try {
      const dir = await workspace({});
      const { status, stderr } = await sqlib(dir, [
        'pull', '--from', url, '--library', 'urn:sqlib:library:main', '--out', 'b.json',
        '--tag', 'urn:t:a', '--no-groups', '--no-rule-sets', '--token-env', 'SQLIB_TEST_TOKEN',
      ]);
      expect(status).toBe(0);
      expect(seen!.url).toBe(
        '/api/libraries/urn%3Asqlib%3Alibrary%3Amain/export-bundle?examples=none&tag=urn%3At%3Aa&groups=false&ruleSets=false',
      );
      expect(seen!.authorization).toBe('Bearer secret');
      expect(JSON.parse(await readFile(path.join(dir, 'b.json'), 'utf8'))).toEqual(bundle);
      expect(stderr).toContain('pulled 1 queries, 1 ETL jobs and 1 rule sets to b.json');
      expect(stderr).toContain("skipped 'Draft': The job has no current version.");

      // What was pulled runs.
      await writeFile(path.join(dir, 'people.ttl'), PEOPLE);
      const run = await sqlib(dir, ['rules', 'run', '--bundle', 'b.json', '--rule-set', 'ancestors', '--data', 'people.ttl']);
      expect(run.status).toBe(0);
    } finally {
      delete process.env.SQLIB_TEST_TOKEN;
      server.close();
    }
  });

  it('refuses to pull an empty bundle, before asking the server', async () => {
    const { status, stderr } = await sqlib(await workspace({}), [
      'pull', '--from', 'http://127.0.0.1:9/api', '--library', 'urn:x',
      '--no-queries', '--no-groups', '--no-etl', '--no-rule-sets',
    ]);
    expect(status).toBe(1);
    expect(stderr).toContain('Nothing to pull');
  });

  it('says which variable to set when the server wants a token', async () => {
    const { server, url } = await serve(() => ({ status: 401, body: { error: 'Unauthorized' } }));
    try {
      const { status, stderr } = await sqlib(await workspace({}), ['pull', '--from', url, '--library', 'urn:x']);
      expect(status).toBe(1);
      expect(stderr).toContain('answered 401');
      expect(stderr).toContain('Set SQLIB_TOKEN to a bearer token.');
    } finally {
      server.close();
    }
  });

  it('refuses a response that is not a valid bundle, and writes nothing', async () => {
    const { server, url } = await serve(() => ({ status: 200, body: { bundle: { version: 2 } } }));
    try {
      const dir = await workspace({});
      const { status, stderr } = await sqlib(dir, ['pull', '--from', url, '--library', 'urn:x']);
      expect(status).toBe(1);
      expect(stderr).toContain('Unsupported bundle version 2');
      await expect(readFile(path.join(dir, 'queries.json'))).rejects.toThrow();
    } finally {
      server.close();
    }
  });
});
