/**
 * Phase C2 (issue #65): prove the JSON Schema tool contract matches the zod one.
 *
 * The C1 lesson this repeats: the plan said "swap the schemas", the harness said
 * four of the seventeen sites were not no-ops, and each was a real bug. So rather
 * than assume the conversion is faithful, this runs a corpus of arguments
 * through both validators and compares:
 *
 *     legacyZodInputSchemas[tool].safeParse(args)     // what C2 removes
 *     ajv.compile(tool.inputSchema)(args)             // what C2 installs
 *
 * Two kinds of finding matter:
 *
 *   VERDICT   one accepts and the other rejects. The tool's answer to "are these
 *             arguments valid" changed.
 *   VALUE     both accept but hand the handler different objects — ajv coerces
 *             and fills defaults where zod stripped and transformed.
 *
 * Every entry in KNOWN_DIVERGENCES below is a behaviour change C2 makes on
 * purpose, with the reason recorded. A divergence that is not listed fails the
 * suite, which is the point: it forces a decision instead of a surprise.
 *
 * The corpus is derived from each tool's own schema rather than written per
 * tool, so a tool added later is covered without anyone remembering to extend a
 * table.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// Imported from the module rather than the package root on purpose. The root
// barrel reaches RuleGrammarValidator -> @sparql-query-lib/srl, which resolves
// only from `dist`, so importing it here would make this suite require a prior
// build — CI's test job does not run one, and the package's vitest config exists
// to keep these tests runnable against workspace source. validator-setup itself
// pulls in nothing but ajv.
import { createValidatorAjv } from '../../api/src/lib/validator-setup.js';
import {
  createBackendSchema,
  updateBackendSchema,
  createLibrarySchema,
  updateLibrarySchema,
  createQuerySchema,
  updateQuerySchema,
} from '@sparql-query-lib/contracts/schema';
import {
  detectionRouteSchemas,
  executionRouteSchemas,
} from '@sparql-query-lib/contracts/schema/routes';
import { tools } from '../../tools/src/tools.js';
import { sparqlRequestArg, stripSchemaIdentity } from '../../tools/src/tool-schemas.js';
import { sparqlRequestJsonSchema as sparqlRouteSchema } from '@sparql-query-lib/contracts/schema/routes';
import { legacyZodInputSchemas } from './legacy-zod-tools.js';

type JsonSchema = Record<string, unknown>;

/**
 * Valid arguments for the tools whose schema is a request body rich enough that
 * a generic filler would not produce an accepted document. Everything else gets
 * its happy-path sample derived from the schema.
 */
const BASE_SAMPLES: Record<string, Record<string, unknown>> = {
  'backends.create': {
    name: 'Test backend',
    backendType: 'http',
    endpoint: 'https://example.org/sparql',
  },
  'backends.update': {
    id: 'urn:backend:1',
    body: { name: 'Renamed' },
  },
  'libraries.create': { name: 'Test library' },
  'libraries.update': { id: 'urn:library:1', body: { name: 'Renamed' } },
  'queries.create': { name: 'Test query' },
  'queries.update': { id: 'urn:query:1', body: { name: 'Renamed' } },
  'execute.run': { targetId: 'urn:query:1' },
  'sparql.proxyQuery': {
    query: 'SELECT * WHERE { ?s ?p ?o }',
    endpoint: 'https://example.org/sparql',
  },
  'detection.detectInputs': { query: 'SELECT * WHERE { ?s ?p ?o }' },
  'detection.detectOutputs': { query: 'SELECT * WHERE { ?s ?p ?o }' },
  'detection.validateQuery': { query: 'SELECT * WHERE { ?s ?p ?o }' },
  'detection.validateRuleData': { ruleOrData: 'RULE { }' },
  'detection.format': { code: 'SELECT * WHERE { ?s ?p ?o }' },
};

/** A type-appropriate value for one property subschema. */
function sampleValue(schema: JsonSchema): unknown {
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  if (schema.format === 'iri' || schema.format === 'uri') return 'https://example.org/thing';
  switch (schema.type) {
    case 'string': return 'sample';
    case 'number':
    case 'integer': return 1;
    case 'boolean': return true;
    case 'array': return [];
    case 'object': return {};
    default: return 'sample';
  }
}

/** Happy-path arguments derived from a tool's own schema. */
function deriveSample(schema: JsonSchema): Record<string, unknown> {
  const properties = (schema.properties ?? {}) as Record<string, JsonSchema>;
  return Object.fromEntries(
    Object.entries(properties).map(([key, value]) => [key, sampleValue(value)])
  );
}

/**
 * The corpus for one tool: the happy path, then one mutation per interesting
 * edge — a missing required argument, each of the wrong-type values a client
 * might plausibly send, and an unknown key.
 */
function corpusFor(toolName: string, schema: JsonSchema): Record<string, unknown>[] {
  const base = BASE_SAMPLES[toolName] ?? deriveSample(schema);
  const required = (schema.required ?? []) as string[];
  const propertyNames = Object.keys((schema.properties ?? {}) as Record<string, JsonSchema>);

  const samples: Record<string, unknown>[] = [base, {}];

  for (const key of required) {
    const without = { ...base };
    delete without[key];
    samples.push(without);
  }

  // Values a model-driven client actually sends by accident: the number instead
  // of its string form, an explicit null for "no value", and the empty and
  // whitespace-only strings that motivated `.trim()` in the first place.
  for (const key of propertyNames) {
    for (const wrong of [42, null, '', '   ', true, [], { nested: 1 }]) {
      samples.push({ ...base, [key]: wrong });
    }
  }

  samples.push({ ...base, zzUnknownArgument: 'surprise' });
  return samples;
}

/** Stable stringify: sorts object keys at every depth, preserves array order. */
function canonical(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>).sort().map(k => [k, walk((v as Record<string, unknown>)[k])])
      );
    }
    return v;
  };
  return JSON.stringify(walk(value));
}

type Finding = { tool: string; sample: string; kind: 'VERDICT' | 'VALUE' | 'THROW'; detail: string };

/**
 * Divergences C2 makes on purpose. Format: `<tool> | <kind> | <sample>`.
 *
 * Grouped by cause below rather than listed flat, because the causes are what
 * a reviewer needs to agree with — the individual entries are just their
 * enumeration.
 */
const KNOWN_DIVERGENCES = new Set<string>();

/**
 * Causes, each with the rule that generates its entries. A divergence matching
 * one of these predicates is expected; anything else is a finding.
 */
const EXPECTED_CAUSES: { name: string; why: string; matches: (f: Finding, sample: Record<string, unknown>) => boolean }[] = [
  {
    name: 'ajv coerces scalars, zod did not',
    why:
      'The validator is `createValidatorAjv()` from packages/api, configured with ' +
      "`coerceTypes: 'array'` — so a number, boolean or null supplied where a string " +
      'is declared becomes that string rather than being rejected. This is deliberate: ' +
      'it is the same configuration the HTTP API validates with, so a payload MCP ' +
      'accepts is a payload the API accepts. Previously the two disagreed — the tool ' +
      'rejected `{id: 42}` that `PUT /backends/42` would have taken.',
    matches: (f, sample) =>
      f.kind === 'VERDICT' &&
      Object.values(sample).some(v => typeof v === 'number' || typeof v === 'boolean' || v === null),
  },
  {
    name: 'zod refinements that no JSON Schema document carries',
    why:
      'A few contract schemas ended in `.superRefine`/`.refine` — "http backends require ' +
      'an endpoint", "backendId or endpoint is required", "at least one property when ' +
      'updating". Those constraints are not in the JSON Schema the API registers for the ' +
      'same route, so the *server* never enforced them at the schema layer either: it ' +
      'enforces them in the handler and returns 400. Dropping them here does not make an ' +
      'invalid request succeed; it moves the rejection from the tool to the endpoint, ' +
      'which is the only place that was ever authoritative for HTTP callers.',
    matches: f => f.kind === 'VERDICT' && REFINEMENT_TOOLS.has(f.tool),
  },
  {
    name: 'constraints that lived only in zod, which the server never enforced',
    why:
      'The mirror image of what C1 found, and the most interesting result here. Three ' +
      'constraints existed in the zod contract but not in the JSON Schema the API ' +
      'registers for the same route:\n' +
      "      - POST /libraries  `name`: zod min(1); route schema is bare {type:'string'}\n" +
      '      - POST /queries    `isPartOf`: zod min(1) items; route schema has no minItems\n' +
      "      - POST /execute    `argumentSetIds`: zod requires an array; ajv's coerceTypes " +
      'wraps a bare string into one\n' +
      'In every case the *server* already accepts these payloads from any HTTP client — ' +
      'the constraint was enforced only in the MCP tool, which was therefore stricter ' +
      'than the endpoint it proxies. C2 makes the tool publish and enforce the document ' +
      'the route actually registers, so the two agree; it does not make a previously ' +
      'rejected request succeed at the API. The underlying gaps are in the schema ' +
      'generator, which Phase B owns — these files are generated, so tightening them here ' +
      'by hand would be overwritten on the next run. Recorded in §3 C2 of the plan.',
    matches: f => f.kind === 'VERDICT' && STRICTER_THAN_SERVER.has(`${f.tool} | ${f.sample}`),
  },
  {
    name: 'zod threw where ajv rejects cleanly',
    why:
      'A bug this harness found rather than one C2 set out to fix. ' +
      "`queryUpdateSchema` is a `z.preprocess` whose callback runs `'isPartOf' in data` " +
      'guarded only by `data &&` — so a non-object body reached the `in` operator and ' +
      'threw a TypeError. `callTool` does not catch that, so `queries.update` with ' +
      '`body: 42` surfaced an opaque crash instead of "Invalid arguments for tool ' +
      'queries.update". ajv rejects it as the validation failure it always was. Pinned ' +
      'by its own test below.',
    matches: f => f.kind === 'THROW',
  },
  {
    name: 'ajv fills declared defaults',
    why:
      '`useDefaults: true` means a body whose schema declares a default arrives with it ' +
      'filled. zod applied its own defaults at parse time, so both transformed — the ' +
      'value simply differs where the two schemas disagree about the default. Same ' +
      'reasoning as the coercion entry: the API does this to the payload anyway.',
    matches: f => f.kind === 'VALUE',
  },
];

/** Tools whose legacy zod schema carried a cross-field refinement. */
const REFINEMENT_TOOLS = new Set([
  'backends.create',
  'backends.update',
  'sparql.proxyQuery',
]);

/**
 * The exact samples where the tool used to be stricter than the endpoint.
 *
 * Enumerated rather than matched by a predicate: each one is a specific
 * constraint that Phase B should restore to the generator, and listing them
 * means a *fourth* such case fails the suite instead of being absorbed silently.
 */
const STRICTER_THAN_SERVER = new Set([
  // Two entries came off here in Phase C3, which put the constraints into the
  // entity model so the generated route documents carry them: `name` is
  // `minLength: 1` and a library-membership `isPartOf` is `minItems: 1`. The
  // tool and the endpoint now reject those payloads together.
  //   'libraries.create | {"name":""}',
  //   'queries.create | {"isPartOf":[],"name":"Test query"}',
  // This one remains, and not for the reason recorded here before. It said
  // `executionRouteSchemas` is still the C1 snapshot rather than a generated
  // document — implying the collapse of contracts/schema/routes would remove
  // it. It would not. The cause is `coerceTypes: 'array'`, which wraps the bare
  // string into `["   "]` before `items.minLength` ever sees it; a document
  // generated from an entity model would say exactly the same thing and behave
  // exactly the same way. Verified directly against `createValidatorAjv()`.
  //
  // So this is an accepted consequence of the ajv configuration C2 chose, not a
  // schema-provenance gap. Removing it means deciding that a bare string should
  // not coerce into a single-element array, which is a global validator change.
  'execute.run | {"argumentSetIds":"   ","targetId":"urn:query:1"}',
]);

/**
 * Tools renamed since the snapshot was taken, mapped back to the name it holds.
 *
 * The snapshot is frozen on purpose (see `legacy-zod-tools.ts`), so a rename is
 * recorded here rather than by editing it. Both of these lost `update` from
 * their name in issue #192: a version PATCH annotates, and a tool called
 * `updateVersion` invited exactly the write that no longer exists.
 */
const RENAMED_SINCE_SNAPSHOT: Record<string, string> = {
  'dataBlocks.patchVersion': 'dataBlocks.updateVersion',
  'rules.patchVersion': 'rules.updateVersion',
};

/**
 * Tools added since the snapshot was taken.
 *
 * There is nothing to compare them against — they never had a zod schema — so
 * the parity harness skips them. Listing them by name rather than treating "no
 * legacy entry" as "skip" keeps the harness's real job intact: a tool whose
 * legacy schema goes missing by accident still fails.
 */
const ADDED_SINCE_SNAPSHOT = new Set<string>([
  // The patch surface (see `docs/explanation/rdf-patch.md`).
  'patches.previewUpdate',
  'patches.apply',
  /*
   * The argument-set surface an assistant could not reach. The routes existed;
   * only `get`, `delete` and `export` had tools, so listing a library's sets,
   * composing one, and reading or writing versions were all unreachable — as
   * was the group half of the attach pair the registry carried for queries.
   */
  'argumentSets.list',
  'argumentSets.create',
  'argumentSets.listVersions',
  'argumentSets.getVersion',
  'argumentSets.createVersion',
  'argumentSets.exportVersion',
  'queryGroups.listArgumentSets',
  'queryGroups.attachArgumentSet',
  /*
   * Data graphs, which had no tools at all: an agent could register a backend
   * hydrated from a data graph and had no way to create the graph it named.
   * The MCP App's toy-data flow is the caller that made the gap obvious.
   */
  'dataGraphs.list',
  'dataGraphs.get',
  'dataGraphs.create',
  'dataGraphs.createVersion',
  'dataGraphs.listVersions',
  'dataGraphs.getVersion',
  /* The MCP Apps door (see `docs/design/mcp-app.md`). */
  'app.bench.open',
  /*
   * SRL as text, and what the tutorial View reads a library through. The
   * routes existed; the first three are what any agent helping with rules
   * needs, the other four are app-only plumbing for the tutorial.
   */
  'srl.analyze',
  'srl.compile',
  'srl.run',
  'tags.list',
  'tests.list',
  'tests.listVersions',
  'ruleSets.exportSrl',
  'app.tutorial.open',
]);

function legacySchemaFor(name: string) {
  return legacyZodInputSchemas[RENAMED_SINCE_SNAPSHOT[name] ?? name];
}

function analyse(): Finding[] {
  const ajv = createValidatorAjv();
  const findings: Finding[] = [];

  for (const tool of tools) {
    if (ADDED_SINCE_SNAPSHOT.has(tool.name)) continue;
    const zod = legacySchemaFor(tool.name);
    if (!zod) throw new Error(`no legacy zod schema recorded for tool ${tool.name}`);
    const validate = ajv.compile(tool.inputSchema);

    for (const sample of corpusFor(tool.name, tool.inputSchema)) {
      const forAjv = structuredClone(sample);
      const ajvOk = validate(forAjv) as boolean;

      // `safeParse` is documented not to throw. One schema makes it throw anyway
      // (see the THROW cause above), so the harness has to survive that to keep
      // measuring the rest.
      let zodResult: { success: boolean; data?: unknown };
      try {
        zodResult = zod.safeParse(structuredClone(sample));
      } catch (error) {
        findings.push({
          tool: tool.name,
          sample: canonical(sample),
          kind: 'THROW',
          detail: `zod threw instead of returning a verdict: ${(error as Error).message}; ajv ${ajvOk ? 'accepted' : 'rejected'}`,
        });
        continue;
      }

      if (ajvOk !== zodResult.success) {
        findings.push({
          tool: tool.name,
          sample: canonical(sample),
          kind: 'VERDICT',
          detail: `ajv ${ajvOk ? 'accepted' : 'rejected'}, zod ${zodResult.success ? 'accepted' : 'rejected'}`,
        });
        continue;
      }
      if (ajvOk && canonical(forAjv) !== canonical(zodResult.data)) {
        findings.push({
          tool: tool.name,
          sample: canonical(sample),
          kind: 'VALUE',
          detail: `zod -> ${canonical(zodResult.data)}; ajv -> ${canonical(forAjv)}`,
        });
      }
    }
  }
  return findings;
}

describe('Phase C2: the JSON Schema tool contract matches the zod one it replaces', () => {
  it('every divergence has a recorded cause', () => {
    const findings = analyse();
    const unexplained = findings.filter(f => {
      if (KNOWN_DIVERGENCES.has(`${f.tool} | ${f.kind} | ${f.sample}`)) return false;
      const sample = JSON.parse(f.sample) as Record<string, unknown>;
      return !EXPECTED_CAUSES.some(cause => cause.matches(f, sample));
    });

    if (unexplained.length) {
      const report = unexplained
        .slice(0, 40)
        .map(f => `  [${f.kind}] ${f.tool}\n      sample: ${f.sample}\n      ${f.detail}`)
        .join('\n');
      throw new Error(
        `${unexplained.length} unexplained divergence(s) between the zod and JSON Schema tool contracts. ` +
          `Each must become a deliberate decision — a KNOWN_DIVERGENCES entry, a new EXPECTED_CAUSES ` +
          `rule, or a fix to the schema:\n${report}`
      );
    }
    expect(unexplained).toEqual([]);
  });

  it('the trimmed-id rejection survives the loss of z.string().trim()', () => {
    // The handoff called this the sleeper: zod trimmed before checking min(1), so
    // a whitespace-only id failed. `minLength: 1` alone would accept "   " and the
    // tool would request /backends/%20%20%20.
    const ajv = createValidatorAjv();
    const backendsGet = tools.find(t => t.name === 'backends.get');
    expect(backendsGet).toBeDefined();
    const validate = ajv.compile(backendsGet!.inputSchema);

    expect(validate({ id: '   ' })).toBe(false);
    expect(validate({ id: '' })).toBe(false);
    expect(validate({ id: 'urn:backend:1' })).toBe(true);
    // And the trim itself is still applied, by buildRequest rather than the schema.
    expect(backendsGet!.buildRequest({ id: '  urn:backend:1  ' }).url).toBe('/backends/urn%3Abackend%3A1');
  });

  it('publishes JSON Schema, with no zod conversion left in the package', () => {
    // Comments explaining what C2 removed are the point of the exercise, so they
    // are stripped before scanning — otherwise this file's own prose fails it.
    const withoutComments = (text: string) =>
      text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

    // The catalogue moved to @sparql-query-lib/tools when the in-app assistant
    // needed it; the no-zod guarantee follows it there.
    const files = [
      new URL('../src/index.ts', import.meta.url),
      new URL('../../tools/src/tools.ts', import.meta.url),
      new URL('../../tools/src/tool-schemas.ts', import.meta.url),
      new URL('../../tools/src/registry.ts', import.meta.url),
    ];
    for (const url of files) {
      const file = url.pathname.split('/').slice(-2).join('/');
      const code = withoutComments(readFileSync(fileURLToPath(url), 'utf8'));
      expect(code, `${file} must not import zod`).not.toMatch(/\bfrom\s+'zod'/);
      expect(code, `${file} must not convert zod to JSON Schema`).not.toMatch(/\btoJSONSchema\s*\(/);
    }
  });

  it('rejects a non-object body instead of throwing', () => {
    // The crash the harness found: queryUpdateSchema's preprocess ran
    // `'isPartOf' in data` on a number and threw a TypeError, which callTool does
    // not catch. Now it is an ordinary rejection.
    const ajv = createValidatorAjv();
    const update = tools.find(t => t.name === 'queries.update');
    expect(update).toBeDefined();
    const validate = ajv.compile(update!.inputSchema);

    expect(() => validate({ id: 'urn:query:1', body: 42 })).not.toThrow();
    expect(validate({ id: 'urn:query:1', body: 42 })).toBe(false);
    expect(validate({ id: 'urn:query:1', body: { name: 'Renamed' } })).toBe(true);
  });

  it('no longer throws on the zod path either, now the generated preprocess guards', () => {
    /*
     * This used to assert the opposite — that the legacy zod schema still threw
     * a TypeError — as the standing evidence for why the JSON Schema path was
     * worth having, with a note saying the claim should come out if it ever
     * stopped being true. It has stopped being true, so it is out.
     *
     * The cause was the same `'isPartOf' in data` on a non-object, in the
     * update preprocess the contract generator emits. That callback was typed
     * `any`, which is precisely what let `in` be applied to a number without
     * complaint; typing it `unknown` forced the `typeof data === 'object'`
     * guard that fixes the crash.
     *
     * Worth stating because the fix reaches further than this package: the same
     * generated leaf is what the web client validates with, so the crash was
     * reachable from the browser too, not only from callTool.
     */
    const parsed = legacyZodInputSchemas['queries.update'].safeParse({ id: 'x', body: 42 });
    expect(parsed.success).toBe(false);
  });

  it('no tool schema contains a $ref, which is what makes stripping $id safe', () => {
    // `stripSchemaIdentity` removes $id at every depth so three detection tools
    // can share one body document without colliding in a single ajv instance.
    // That is only sound while nothing refers to a document by id.
    for (const tool of tools) {
      expect(JSON.stringify(tool.inputSchema)).not.toContain('"$ref"');
    }
  });

  it('the /sparql tool publishes the document the API route registers', () => {
    // This used to read `packages/api/src/routes/sparql.ts` as text and assert
    // its literal matched a copy here, because the route declared the shape
    // module-locally and there was nothing to import. Phase B moved it into
    // `contracts/schema/routes`, so the two are the same object and the check
    // is identity rather than a text match that could pass on a stale copy.
    expect(sparqlRequestArg).toBe(sparqlRouteSchema);
    // `arguments`/`limits`/`offsets` are the execution payload, which the route
    // gained so an ad-hoc query can run parameterised; `argumentSetIds` lets it
    // name a stored set instead of the client flattening one first. The tool
    // publishes them because it publishes the route's document, not a copy of it.
    expect(Object.keys(sparqlRequestArg.properties)).toEqual([
      'query',
      'backendId',
      'endpoint',
      'queryMethod',
      'arguments',
      'limits',
      'offsets',
      'argumentSetIds',
    ]);
  });

  it('forwarding tools publish the exact document their API route registers', () => {
    // The property C2 exists to establish, asserted rather than asserted-in-prose:
    // for every tool that forwards a request body, the schema the client is given
    // *is* the schema fastify validates that route against. Not a copy that
    // matches today — the same document, stripped only of $id/$schema.
    const forwarded: [string, unknown][] = [
      ['backends.create', createBackendSchema.body],
      ['libraries.create', createLibrarySchema.body],
      ['queries.create', createQuerySchema.body],
      ['execute.run', executionRouteSchemas.post.body],
      ['detection.detectInputs', detectionRouteSchemas.detectInputsPost.body],
      ['detection.detectOutputs', detectionRouteSchemas.detectOutputsPost.body],
      ['detection.validateQuery', detectionRouteSchemas.validateQueryPost.body],
      ['detection.validateRuleData', detectionRouteSchemas.validateRuleDataPost.body],
      ['detection.format', detectionRouteSchemas.formatPost.body],
    ];

    for (const [name, routeBody] of forwarded) {
      const tool = tools.find(t => t.name === name);
      expect(tool, `no tool named ${name}`).toBeDefined();
      expect(canonical(tool!.inputSchema), name).toBe(canonical(stripSchemaIdentity(routeBody)));
    }

    // The three `{id, body}` updates nest the route body under `body`.
    const nested: [string, unknown][] = [
      ['backends.update', updateBackendSchema.body],
      ['libraries.update', updateLibrarySchema.body],
      ['queries.update', updateQuerySchema.body],
    ];
    for (const [name, routeBody] of nested) {
      const tool = tools.find(t => t.name === name);
      expect(tool, `no tool named ${name}`).toBeDefined();
      const published = (tool!.inputSchema.properties as Record<string, unknown>).body;
      expect(canonical(published), name).toBe(canonical(stripSchemaIdentity(routeBody)));
    }
  });

  it('covers every tool the server registers', () => {
    expect(tools.length).toBe(Object.keys(legacyZodInputSchemas).length + ADDED_SINCE_SNAPSHOT.size);
    for (const tool of tools) {
      if (ADDED_SINCE_SNAPSHOT.has(tool.name)) continue;
      expect(legacySchemaFor(tool.name), `missing legacy schema for ${tool.name}`).toBeDefined();
    }
  });
});
