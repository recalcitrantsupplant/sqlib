/**
 * The stored data graph a request body names, against the routes that read it.
 *
 * Found sweeping `playground.ts` into `route-coverage.test.ts`, with the
 * question the change-feed sweep handed on — *where else does one module answer
 * a question another module already answers?* — turned around: one module
 * answering it for four callers, of which only one asked.
 *
 * `resolveDataGraphInput` turns a caller-named `dataGraphVersionId` or
 * `dataGraphId` into RDF text. The id names a stored entity that need not live
 * in the library the route resolved, which is the shape
 * `POST /tuple-sets/:id/versions/from-etl`,
 * `POST /data-graphs/:id/versions/from-query` and
 * `ArgumentSetService.createVersion` all carry a check for. Four routes reach
 * this helper and one of them — the argument set path — checked. The other
 * three did not:
 *
 * - **`POST /playground/rules/execute` had no check of any kind.** Everything
 *   else it runs is text the caller just typed, which is why it registers no
 *   guard, correctly. But the graph seeds the store the caller's own rules
 *   read, so a principal holding no grant anywhere could load another
 *   library's saved RDF into an engine it controls.
 * - **`POST /rule-sets/:id/execute` and `/execute/stream`** checked Execute on
 *   the *rule set's* library and said nothing about the graph, so Execute on
 *   one library bought a read of triples out of any other.
 * - **`POST /execute`** takes `dataGraphs[]` for a query group's start node and
 *   checked Execute on the target only.
 *
 * The fix is one `authScope` on the helper rather than three checks at three
 * call sites, and `every route that resolves one asks` below is what keeps a
 * fifth door from arriving unasked.
 *
 * `read`, not `execute`: a data graph stores no query and runs nothing. Its
 * triples are copied into the store a run reads from, which is what Read
 * governs everywhere else — `requirePinnedSourcesReadable`'s reasoning, applied
 * to the same content through a different door.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';
import type { AuthContext } from '../../src/auth/types.js';

const MINE = 'urn:sqlib:library:hydrology';
const THEIRS = 'urn:sqlib:library:payroll';

const MY_GRAPH = 'urn:sqlib:datagraph:gauges';
const MY_GRAPH_V1 = 'urn:sqlib:datagraph:gauges:v1';
const THEIR_GRAPH = 'urn:sqlib:datagraph:salaries';
const THEIR_GRAPH_V1 = 'urn:sqlib:datagraph:salaries:v1';
/** A version whose graph is gone, so no library resolves for it. */
const ORPHAN_GRAPH_V1 = 'urn:sqlib:datagraph:deleted:v1';

const MY_RULE_SET = 'urn:sqlib:ruleset:catchments';
const MY_RULE_SET_V1 = 'urn:sqlib:ruleset:catchments:v1';

/** The triples only a principal holding Read on `THEIRS` may see. */
const SECRET_TRIPLES = '<urn:person:1> <urn:salary> "184000" .';

const store = vi.hoisted(() => ({ entities: new Map<string, Record<string, unknown>>() }));
const hoisted = vi.hoisted(() => ({ execute: vi.fn() }));

const byType = (type: string) =>
  [...store.entities.values()].filter(entity => entity['@type'] === type);

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => {
  const repo = (type: string) => ({
    get: (id: string) => {
      const entity = store.entities.get(id);
      return entity && entity['@type'] === type ? entity : null;
    },
    list: () => byType(type),
    update: async () => null,
  });
  return {
    getCacheCoordinator: () => ({
      get: (id: string) => store.entities.get(id) ?? null,
      addEphemeral: () => undefined,
      removeEphemeral: () => undefined,
    }),
    getEntityRepositories: () => ({
      RuleSet: repo('RuleSet'),
      RuleSetVersion: repo('RuleSetVersion'),
      Rule: repo('Rule'),
      RuleVersion: repo('RuleVersion'),
      DataBlock: repo('DataBlock'),
      DataBlockVersion: repo('DataBlockVersion'),
      DataGraph: repo('DataGraph'),
      DataGraphVersion: repo('DataGraphVersion'),
    }),
  };
});

/*
 * The executor is the *sink*, so it stands in for the disclosure rather than
 * for the run: whatever reaches `options.initialGraph` is what a caller's own
 * rules get to match against. Asserting on that is stronger than asserting on
 * a status code, and does not depend on what any particular rule derives.
 */
vi.mock('../../src/lib/RuleSetExecutor.js', () => ({
  RuleSetExecutor: vi.fn(function () {
    return { execute: hoisted.execute };
  }),
}));

/** Every rule and data block is well-formed; this suite is about the graph. */
vi.mock('../../src/lib/RuleGrammarValidator.js', () => ({
  RuleGrammarValidator: vi.fn(function () {
    return {
      validateWithAllGrammars: () => ({
        valid: true,
        normalized: 'INSERT DATA { <urn:a> <urn:b> <urn:c> }',
        primaryGrammar: 'srl',
        validations: [],
      }),
    };
  }),
}));

vi.mock('../../src/lib/RuleStratifier.js', () => ({
  RuleStratifier: vi.fn(function () {
    return { analyzeRuleVersions: () => ({ strata: {}, edges: [], monotonicity: {} }) };
  }),
}));

vi.mock('../../src/config/featureFlags.js', () => ({
  getFeatureFlags: () => ({ playgroundRules: true, playgroundEtl: false }),
}));

const { resolveDataGraphInput } = await import('../../src/lib/dataGraphInput.js');
const { DataGraphContentError } = await import('../../src/lib/dataGraphContent.js');

type Mode = 'read' | 'write' | 'execute' | 'delete' | 'control';

function grantsOn(entries: Array<[string, Mode[]]>): AuthContext {
  return {
    subject: 'urn:sqlib:principal:user:caller',
    principals: ['urn:sqlib:principal:user:caller', 'urn:sqlib:principal:authenticated'],
    issuer: 'https://issuer.test/',
    tokenType: 'user',
    grants: {
      admin: false,
      backends: new Map(),
      libraries: new Map(entries.map(([library, modes]) => [library, new Set(modes)])),
    },
    claims: {},
    fullAccess: false,
    mode: 'required',
  };
}

const ALL: Mode[] = ['read', 'write', 'execute', 'delete', 'control'];

/** Every mode on their own library, and so nothing at all on `THEIRS`. */
const mine = grantsOn([[MINE, ALL]]);
/** The same caller, plus Read on the other library. */
const alsoReadsTheirs = grantsOn([[MINE, ALL], [THEIRS, ['read']]]);
/** Holds nothing anywhere, which is what the playground route answered to. */
const stranger = grantsOn([]);

/** What `disabled` mode hands every request: no principal, full access. */
const authDisabled: AuthContext = {
  ...stranger,
  subject: 'urn:sqlib:principal:anonymous',
  principals: [],
  issuer: null,
  fullAccess: true,
  mode: 'disabled',
};

async function inject(
  plugin: 'playground' | 'rule-sets',
  context: AuthContext,
  url: string,
  payload: object,
) {
  const app: FastifyInstance = Fastify({ logger: false });
  setupValidator(app);
  for (const schema of Object.values(schemas)) {
    if (schema && typeof schema === 'object' && '$id' in schema) app.addSchema(schema);
  }
  app.setErrorHandler((error, _request, reply) => {
    reply.status((error as { statusCode?: number }).statusCode ?? 500).send({ error: error.message });
  });
  app.decorateRequest('authContext', undefined);
  app.addHook('onRequest', async request => {
    request.authContext = context;
  });
  const module = plugin === 'playground'
    ? await import('../../src/routes/playground.js')
    : await import('../../src/routes/rule-sets.js');
  await app.register(module.default as never, { prefix: `/${plugin}` });
  await app.ready();
  try {
    return await app.inject({ method: 'POST', url, payload });
  } finally {
    await app.close();
  }
}

const PLAYGROUND_RULES = '/playground/rules/execute';
const RULE_SET_EXECUTE = `/rule-sets/${encodeURIComponent(MY_RULE_SET)}/execute`;

/** What the engine hands back; the shape matters, the content does not. */
const EMPTY_RUN = { status: 'completed', iterations: [], dataBlocks: [] };

/** The graph the run was actually seeded with, or null if it never ran. */
function seededGraph(): string | null {
  const call = hoisted.execute.mock.calls[0];
  if (!call) return null;
  return (call[1] as { initialGraph?: string | null })?.initialGraph ?? null;
}

beforeEach(() => {
  hoisted.execute.mockReset();
  hoisted.execute.mockResolvedValue(EMPTY_RUN);

  store.entities = new Map<string, Record<string, unknown>>([
    [MINE, { '@type': 'Library', $id: MINE, name: 'Hydrology' }],
    [THEIRS, { '@type': 'Library', $id: THEIRS, name: 'Payroll' }],

    [MY_GRAPH, { '@type': 'DataGraph', $id: MY_GRAPH, isPartOf: [MINE], currentVersion: MY_GRAPH_V1 }],
    [MY_GRAPH_V1, {
      '@type': 'DataGraphVersion', $id: MY_GRAPH_V1, isPartOf: MY_GRAPH, version: 1,
      contentString: '<urn:gauge:1> <urn:level> "3.2" .',
      contentFormat: 'application/n-triples', tripleCount: 1,
    }],

    [THEIR_GRAPH, { '@type': 'DataGraph', $id: THEIR_GRAPH, isPartOf: [THEIRS], currentVersion: THEIR_GRAPH_V1 }],
    [THEIR_GRAPH_V1, {
      '@type': 'DataGraphVersion', $id: THEIR_GRAPH_V1, isPartOf: THEIR_GRAPH, version: 1,
      contentString: SECRET_TRIPLES,
      contentFormat: 'application/n-triples', tripleCount: 1,
    }],

    // Its `isPartOf` names a graph that is not stored, so no library resolves.
    [ORPHAN_GRAPH_V1, {
      '@type': 'DataGraphVersion', $id: ORPHAN_GRAPH_V1, isPartOf: 'urn:sqlib:datagraph:deleted',
      version: 1, contentString: '<urn:a> <urn:b> <urn:c> .',
      contentFormat: 'application/n-triples', tripleCount: 1,
    }],

    [MY_RULE_SET, {
      '@type': 'RuleSet', $id: MY_RULE_SET, name: 'Catchments', isPartOf: [MINE],
      currentVersion: MY_RULE_SET_V1,
    }],
    [MY_RULE_SET_V1, {
      '@type': 'RuleSetVersion', $id: MY_RULE_SET_V1, isPartOf: MY_RULE_SET, version: 1,
      hasRule: [], hasDataBlock: [],
    }],
  ]);
});

describe('POST /playground/rules/execute', () => {
  /*
   * The finding. The route took no check at all — no guard, no handler check —
   * because everything else it runs is the caller's own text. One field was
   * not: a stored graph, in a library this principal holds nothing on, loaded
   * into an engine running the caller's rules.
   */
  it('refuses a stored graph in a library the caller cannot read', async () => {
    const response = await inject('playground', stranger, PLAYGROUND_RULES, {
      rules: ['RULE { ?s <urn:q> ?o } WHERE { ?s ?p ?o }'],
      dataGraphVersionId: THEIR_GRAPH_V1,
    });

    expect(response.statusCode, response.body).toBe(403);
  });

  it('does not let the triples reach the engine when it refuses', async () => {
    await inject('playground', stranger, PLAYGROUND_RULES, {
      rules: ['RULE { ?s <urn:q> ?o } WHERE { ?s ?p ?o }'],
      dataGraphVersionId: THEIR_GRAPH_V1,
    });

    // The status code is not the claim: what matters is that the run never
    // happened, so no rule of the caller's ever saw the base graph.
    expect(hoisted.execute).not.toHaveBeenCalled();
    expect(seededGraph()).toBeNull();
  });

  it('seeds the run once the caller holds Read on that library', async () => {
    const response = await inject('playground', alsoReadsTheirs, PLAYGROUND_RULES, {
      rules: ['RULE { ?s <urn:q> ?o } WHERE { ?s ?p ?o }'],
      dataGraphVersionId: THEIR_GRAPH_V1,
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(seededGraph()).toBe(SECRET_TRIPLES);
  });

  /*
   * The route's own reason for existing is unaffected, which is the half a
   * fix like this can quietly break: inline RDF is the caller's own text and
   * names nothing stored, so it needs no grant and must keep needing none.
   */
  it('still runs inline RDF for a principal holding nothing anywhere', async () => {
    const response = await inject('playground', stranger, PLAYGROUND_RULES, {
      rules: ['RULE { ?s <urn:q> ?o } WHERE { ?s ?p ?o }'],
      dataGraphInline: '<urn:mine:1> <urn:p> "typed here" .',
      dataGraphInlineFormat: 'application/n-triples',
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(seededGraph()).toContain('typed here');
  });

  it('still runs rules with no data graph at all', async () => {
    const response = await inject('playground', stranger, PLAYGROUND_RULES, {
      rules: ['RULE { ?s <urn:q> ?o } WHERE { ?s ?p ?o }'],
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(hoisted.execute).toHaveBeenCalled();
  });

  it('lets `disabled` mode through, as it does everywhere', async () => {
    const response = await inject('playground', authDisabled, PLAYGROUND_RULES, {
      rules: ['RULE { ?s <urn:q> ?o } WHERE { ?s ?p ?o }'],
      dataGraphVersionId: THEIR_GRAPH_V1,
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(seededGraph()).toBe(SECRET_TRIPLES);
  });
});

describe('POST /rule-sets/:id/execute', () => {
  /*
   * The second door, and the one that reads worst: the guard resolved the rule
   * set and required Execute on *its* library, which is a real check on the
   * wrong entity. The body named a second one.
   */
  it('refuses a graph from a library the caller cannot read', async () => {
    const response = await inject('rule-sets', mine, RULE_SET_EXECUTE, {
      dataGraphVersionId: THEIR_GRAPH_V1,
    });

    expect(response.statusCode, response.body).toBe(403);
    expect(hoisted.execute).not.toHaveBeenCalled();
  });

  it('runs the same rule set against a graph in its own library', async () => {
    const response = await inject('rule-sets', mine, RULE_SET_EXECUTE, {
      dataGraphVersionId: MY_GRAPH_V1,
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(seededGraph()).toContain('urn:gauge:1');
  });

  it('allows the other library once the caller may read it', async () => {
    const response = await inject('rule-sets', alsoReadsTheirs, RULE_SET_EXECUTE, {
      dataGraphVersionId: THEIR_GRAPH_V1,
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(seededGraph()).toBe(SECRET_TRIPLES);
  });

  /*
   * Execute on the rule set's library is what the guard asks and is not what
   * this asks. A caller holding Execute but not Read on `THEIRS` may run the
   * rule set and may not feed it that library's triples.
   */
  it('is Read on the graph, not Execute on the rule set', async () => {
    const executesTheirs = grantsOn([[MINE, ALL], [THEIRS, ['execute']]]);
    const response = await inject('rule-sets', executesTheirs, RULE_SET_EXECUTE, {
      dataGraphVersionId: THEIR_GRAPH_V1,
    });

    expect(response.statusCode, response.body).toBe(403);
  });
});

describe('what the refusal discloses, and what it does not', () => {
  const requestFor = (context: AuthContext) => ({ authContext: context } as never);

  it('reports an id naming nothing as the 400 it always was', () => {
    // The check runs *after* the existence test, so an id the caller could
    // have got right stays the caller's error rather than a permission answer.
    expect(() =>
      resolveDataGraphInput(
        { dataGraphVersionId: 'urn:sqlib:datagraph:nowhere:v1' },
        { request: requestFor(stranger) },
      )
    ).toThrow(DataGraphContentError);
  });

  it('refuses a version whose graph no longer resolves rather than abstaining', () => {
    /*
     * `requireLibraryMode(null, …)` denies, which is the behaviour
     * `requirePinnedSourcesReadable` relies on: nobody can hold a grant on a
     * library that will not resolve, and "no grant reaches it" must not read
     * as "everyone may".
     */
    expect(() =>
      resolveDataGraphInput(
        { dataGraphVersionId: ORPHAN_GRAPH_V1 },
        { request: requestFor(stranger) },
      )
    ).toThrow(/read/i);
  });

  it('checks the floating form before it says whether the graph has a version', () => {
    expect(() =>
      resolveDataGraphInput({ dataGraphId: THEIR_GRAPH }, { request: requestFor(stranger) })
    ).toThrow(/read/i);
  });

  it('resolves the floating form for a caller who may read it', () => {
    const resolved = resolveDataGraphInput(
      { dataGraphId: THEIR_GRAPH },
      { request: requestFor(alsoReadsTheirs) },
    );

    expect(resolved?.content).toBe(SECRET_TRIPLES);
  });

  /*
   * Without a scope the helper resolves as it always did. That is not a
   * loophole but the contract two callers depend on: `ArgumentSetService`
   * checks its pins at *write* and re-resolves them at every run, so a set
   * shared with someone keeps running for them.
   */
  it('resolves with no scope at all, which is what the argument set path relies on', () => {
    const resolved = resolveDataGraphInput({ dataGraphVersionId: THEIR_GRAPH_V1 });

    expect(resolved?.content).toBe(SECRET_TRIPLES);
  });
});

describe('every route that resolves a stored graph asks', () => {
  /*
   * The guard the finding actually needs. Three of the four doors to this
   * helper were open, and the reason they could be is that the helper takes
   * the id and answers — so nothing about a *new* call site makes it obvious
   * that a question is owed. A fifth door added without a scope fails here by
   * file and line rather than in somebody's deployment.
   *
   * `ArgumentSetService.ts` is the named exception, and there are exactly two
   * of them: `createGraphBinding` validates at write (after
   * `requirePinnedSourcesReadable` has run on the same input) and
   * `exportRuntimePayload` re-resolves a stored binding at run time. Both are
   * deliberate and both are covered by `argumentSetPinnedSources.test.ts`.
   */
  const SCOPE_EXEMPT = new Map<string, number>([['ArgumentSetService.ts', 2]]);

  async function sourceFiles(dir: string, out: Array<[string, string]> = []) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await sourceFiles(full, out);
      else if (entry.name.endsWith('.ts')) out.push([entry.name, await readFile(full, 'utf8')]);
    }
    return out;
  }

  it('passes an auth scope at every call site outside the argument set path', async () => {
    const root = fileURLToPath(new URL('../../src/', import.meta.url));
    const files = await sourceFiles(root);

    const unscoped: string[] = [];
    const exemptSeen = new Map<string, number>();

    for (const [name, source] of files) {
      // The definition itself, and the type-only import, are not call sites.
      if (name === 'dataGraphInput.ts') continue;
      for (const call of source.matchAll(/resolveDataGraphInput\(([^;]*?)\)\s*;/gs)) {
        const args = call[1] ?? '';
        if (/\{\s*request\s*\}/.test(args)) continue;
        if (SCOPE_EXEMPT.has(name)) {
          exemptSeen.set(name, (exemptSeen.get(name) ?? 0) + 1);
          continue;
        }
        unscoped.push(`${name}: resolveDataGraphInput(${args.trim().slice(0, 60)}…)`);
      }
    }

    expect(
      unscoped,
      'These resolve a caller-named data graph id to triples without saying who for. '
      + 'Pass `{ request }` so the helper can require Read on the library owning it, '
      + 'or add the file to SCOPE_EXEMPT with the reason it does not need to.',
    ).toEqual([]);

    // Pinned both ways: an exemption that stops being used is slack, and a
    // third unscoped call appearing in the exempt file is not covered by the
    // two sentences above.
    expect(Object.fromEntries(exemptSeen)).toEqual(Object.fromEntries(SCOPE_EXEMPT));
  });
});
