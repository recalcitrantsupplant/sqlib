/**
 * Phase C3 (issue #65): prove the zod leaf the web app validates with agrees
 * with the JSON Schema document the server actually registers.
 *
 * C1 removed the server's second validator; C2 removed the MCP server's. The web
 * app is the one consumer where the plan keeps zod — as a *leaf* fed from the
 * hub, because `useApiClient` uses it to normalise and default outgoing payloads,
 * not only to check them. Keeping it is only defensible if it says the same thing
 * the server says, and nothing was checking that.
 *
 * So for every request body web validates before sending, this runs a corpus
 * through both:
 *
 *     leafSchema.safeParse(payload)        // what packages/web sends after
 *     ajv.compile(serverDocument)(payload) // what fastify accepts on arrival
 *
 * Two directions, with very different consequences:
 *
 *   SERVER-REJECTS  the leaf accepts a payload the server refuses. The web app
 *                   builds a request, believes it valid, and gets a 400. This is
 *                   the direction that breaks users, and there must be none.
 *   LEAF-REJECTS    the leaf refuses a payload the server would have taken. The
 *                   web app cannot do something the API permits — a smaller bug,
 *                   but still drift, and it is how "the client is stricter than
 *                   the endpoint" (C2's finding, in the other package) happens.
 *
 * Every divergence must match a recorded cause in EXPECTED_CAUSES or be listed
 * in KNOWN_DIVERGENCES. Anything else fails the suite, which is the point: the
 * leaf cannot drift from the hub again without someone deciding that it should.
 *
 * The corpus is derived from the schemas themselves rather than written per
 * pair, so a field added to an entity is covered without anyone extending a
 * table.
 */
import { describe, expect, it } from 'vitest';
import { createValidatorAjv } from '../../src/lib/validator-setup.js';
import {
  backendCreateSchema,
  backendUpdateSchema,
  libraryCreateSchema,
  libraryUpdateSchema,
  queryCreateSchema,
  queryUpdateSchema,
  queryGroupCreateSchema,
  queryGroupUpdateSchema,
  ruleCreateSchema,
  ruleUpdateSchema,
  ruleSetCreateSchema,
  ruleSetUpdateSchema,
  dataBlockCreateSchema,
  dataBlockUpdateSchema,
  dataGraphCreateSchema,
  dataGraphUpdateSchema,
  tupleSetCreateSchema,
  tupleSetUpdateSchema,
  testCreateSchema,
  testUpdateSchema,
  tagCreateSchema,
  tagUpdateSchema,
  detectQueryRequestSchema,
  validateRuleDataRequestSchema,
  formatRequestSchema,
  executionRequestSchema,
  sparqlRequestSchema as sparqlRequestLeaf,
} from '@sparql-query-lib/contracts';
import {
  createBackendSchema,
  updateBackendSchema,
  createLibrarySchema,
  updateLibrarySchema,
  createQuerySchema,
  updateQuerySchema,
  createQueryGroupSchema,
  updateQueryGroupSchema,
  createRuleSchema,
  updateRuleSchema,
  createDataBlockSchema,
  updateDataBlockSchema,
  createDataGraphSchema,
  updateDataGraphSchema,
  createTupleSetSchema,
  updateTupleSetSchema,
  createTestSchema,
  updateTestSchema,
  createTagSchema,
  updateTagSchema,
  createRuleSetSchema,
  updateRuleSetSchema,
  backendSchema as backendEntitySchema,
  librarySchema as libraryEntitySchema,
  querySchema as queryEntitySchema,
  querygroupSchema as queryGroupEntitySchema,
  ruleSchema as ruleEntitySchema,
  rulesetSchema as ruleSetEntitySchema,
  datablockSchema as dataBlockEntitySchema,
  datagraphSchema as dataGraphEntitySchema,
  tuplesetSchema as tupleSetEntitySchema,
  testSchema as testEntitySchema,
  tagSchema as tagEntitySchema,
} from '@sparql-query-lib/contracts/schema';
import {
  detectionRouteSchemas,
  executionRouteSchemas,
} from '@sparql-query-lib/contracts/schema/routes';
import { sparqlRequestSchema as sparqlRequestRouteSchema } from '../../src/routes/sparql.js';
import { ENTITY_CONTRACT_MODELS } from '../../scripts/lib/emitters/entity-contract-models.js';

type JsonSchema = Record<string, any>;
type ZodLike = { safeParse(value: unknown): { success: boolean; data?: unknown } };

interface Pair {
  /** `<entity>.<operation>`, used as the finding key. */
  name: string;
  /** The zod schema `useApiClient` parses the payload with before sending. */
  leaf: ZodLike;
  /** The JSON Schema fastify registers as that route's `body`. */
  server: JsonSchema;
  /** Where that document comes from, so a failure says what to go and fix. */
  serverSource: string;
  /** A payload both validators accept, for the corpus to mutate. */
  base: Record<string, unknown>;
  /**
   * The entity document, when the route body is a projection of one. Its
   * properties join the corpus so fields the *leaf* knows about and the route
   * body omits get exercised — that asymmetry is exactly what C3 is looking for.
   */
  entity?: JsonSchema;
}

const LIBRARY = 'urn:example:library:1';

const PAIRS: Pair[] = [
  {
    name: 'backend.create',
    leaf: backendCreateSchema,
    server: createBackendSchema.body,
    serverSource: 'contracts/schema → createBackendSchema.body',
    base: { name: 'B', backendType: 'http', endpoint: 'https://example.org/sparql' },
    entity: backendEntitySchema,
  },
  {
    name: 'backend.update',
    leaf: backendUpdateSchema,
    server: updateBackendSchema.body,
    serverSource: 'contracts/schema → updateBackendSchema.body',
    base: { name: 'B' },
    entity: backendEntitySchema,
  },
  {
    name: 'library.create',
    leaf: libraryCreateSchema,
    server: createLibrarySchema.body,
    serverSource: 'contracts/schema → createLibrarySchema.body',
    base: { name: 'L' },
    entity: libraryEntitySchema,
  },
  {
    name: 'library.update',
    leaf: libraryUpdateSchema,
    server: updateLibrarySchema.body,
    serverSource: 'contracts/schema → updateLibrarySchema.body',
    base: { name: 'L' },
    entity: libraryEntitySchema,
  },
  {
    name: 'query.create',
    leaf: queryCreateSchema,
    server: createQuerySchema.body,
    serverSource: 'contracts/schema → createQuerySchema.body',
    base: { name: 'Q', isPartOf: [LIBRARY] },
    entity: queryEntitySchema,
  },
  {
    name: 'query.update',
    leaf: queryUpdateSchema,
    server: updateQuerySchema.body,
    serverSource: 'contracts/schema → updateQuerySchema.body',
    base: { name: 'Q' },
    entity: queryEntitySchema,
  },
  {
    name: 'queryGroup.create',
    leaf: queryGroupCreateSchema,
    server: createQueryGroupSchema.body,
    serverSource: 'contracts/schema → createQueryGroupSchema.body',
    base: { name: 'G', isPartOf: LIBRARY },
    entity: queryGroupEntitySchema,
  },
  {
    name: 'queryGroup.update',
    leaf: queryGroupUpdateSchema,
    server: updateQueryGroupSchema.body,
    serverSource: 'contracts/schema → updateQueryGroupSchema.body',
    base: { name: 'G' },
    entity: queryGroupEntitySchema,
  },
  {
    name: 'rule.create',
    leaf: ruleCreateSchema,
    server: createRuleSchema.body,
    serverSource: 'contracts/schema → createRuleSchema.body',
    base: { name: 'R', isPartOf: [LIBRARY] },
    entity: ruleEntitySchema,
  },
  {
    name: 'rule.update',
    leaf: ruleUpdateSchema,
    server: updateRuleSchema.body,
    serverSource: 'contracts/schema → updateRuleSchema.body',
    base: { name: 'R' },
    entity: ruleEntitySchema,
  },
  {
    name: 'ruleSet.create',
    leaf: ruleSetCreateSchema,
    server: createRuleSetSchema.body,
    serverSource: 'contracts/schema → createRuleSetSchema.body',
    base: { name: 'RS', isPartOf: [LIBRARY] },
    entity: ruleSetEntitySchema,
  },
  {
    name: 'ruleSet.update',
    leaf: ruleSetUpdateSchema,
    server: updateRuleSetSchema.body,
    serverSource: 'contracts/schema → updateRuleSetSchema.body',
    base: { name: 'RS' },
    entity: ruleSetEntitySchema,
  },
  {
    name: 'dataBlock.create',
    leaf: dataBlockCreateSchema,
    server: createDataBlockSchema.body,
    serverSource: 'contracts/schema → createDataBlockSchema.body',
    base: { name: 'D', isPartOf: [LIBRARY] },
    entity: dataBlockEntitySchema,
  },
  {
    name: 'dataBlock.update',
    leaf: dataBlockUpdateSchema,
    server: updateDataBlockSchema.body,
    serverSource: 'contracts/schema → updateDataBlockSchema.body',
    base: { name: 'D' },
    entity: dataBlockEntitySchema,
  },
  {
    name: 'dataGraph.create',
    leaf: dataGraphCreateSchema,
    server: createDataGraphSchema.body,
    serverSource: 'contracts/schema → createDataGraphSchema.body',
    base: { name: 'DG', isPartOf: [LIBRARY] },
    entity: dataGraphEntitySchema,
  },
  {
    name: 'dataGraph.update',
    leaf: dataGraphUpdateSchema,
    server: updateDataGraphSchema.body,
    serverSource: 'contracts/schema → updateDataGraphSchema.body',
    base: { name: 'DG' },
    entity: dataGraphEntitySchema,
  },
  {
    name: 'tupleSet.create',
    leaf: tupleSetCreateSchema,
    server: createTupleSetSchema.body,
    serverSource: 'contracts/schema → createTupleSetSchema.body',
    base: { name: 'TS', isPartOf: [LIBRARY] },
    entity: tupleSetEntitySchema,
  },
  {
    name: 'tupleSet.update',
    leaf: tupleSetUpdateSchema,
    server: updateTupleSetSchema.body,
    serverSource: 'contracts/schema → updateTupleSetSchema.body',
    base: { name: 'TS' },
    entity: tupleSetEntitySchema,
  },
  {
    name: 'test.create',
    leaf: testCreateSchema,
    server: createTestSchema.body,
    serverSource: 'contracts/schema → createTestSchema.body',
    base: { name: 'T', isPartOf: [LIBRARY], subject: 'urn:example:query:1', subjectKind: 'query' },
    entity: testEntitySchema,
  },
  {
    name: 'test.update',
    leaf: testUpdateSchema,
    server: updateTestSchema.body,
    serverSource: 'contracts/schema → updateTestSchema.body',
    base: { name: 'T' },
    entity: testEntitySchema,
  },
  {
    name: 'tag.create',
    leaf: tagCreateSchema,
    server: createTagSchema.body,
    serverSource: 'contracts/schema → createTagSchema.body',
    base: { name: 'Tag', isPartOf: LIBRARY },
    entity: tagEntitySchema,
  },
  {
    name: 'tag.update',
    leaf: tagUpdateSchema,
    server: updateTagSchema.body,
    serverSource: 'contracts/schema → updateTagSchema.body',
    base: { name: 'Tag' },
    entity: tagEntitySchema,
  },
  {
    name: 'detection.detectInputs',
    leaf: detectQueryRequestSchema,
    server: detectionRouteSchemas.detectInputsPost.body,
    serverSource: 'contracts/schema/routes → detectionRouteSchemas.detectInputsPost.body',
    base: { query: 'SELECT * WHERE { ?s ?p ?o }' },
  },
  {
    name: 'detection.validateRuleData',
    leaf: validateRuleDataRequestSchema,
    server: detectionRouteSchemas.validateRuleDataPost.body,
    serverSource: 'contracts/schema/routes → detectionRouteSchemas.validateRuleDataPost.body',
    base: { ruleOrData: 'RULE { }' },
  },
  {
    name: 'detection.format',
    leaf: formatRequestSchema,
    server: detectionRouteSchemas.formatPost.body,
    serverSource: 'contracts/schema/routes → detectionRouteSchemas.formatPost.body',
    base: { code: 'SELECT * WHERE { ?s ?p ?o }' },
  },
  {
    name: 'execute.run',
    leaf: executionRequestSchema,
    server: executionRouteSchemas.post.body,
    serverSource: 'contracts/schema/routes → executionRouteSchemas.post.body',
    base: { targetId: 'urn:example:query:1' },
  },
  {
    name: 'sparql.proxyQuery',
    leaf: sparqlRequestLeaf,
    server: sparqlRequestRouteSchema,
    serverSource: 'api/src/routes/sparql.ts → sparqlRequestSchema (module-local)',
    base: { query: 'SELECT * WHERE { ?s ?p ?o }', endpoint: 'https://example.org/sparql' },
  },
];

/** One corpus entry, and which field (if any) was perturbed to produce it. */
interface Sample {
  value: Record<string, unknown>;
  mutated?: { key: string; value: unknown };
}

/** Stable stringify: sorts object keys at every depth, preserves array order. */
function canonical(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .map(k => [k, walk((v as Record<string, unknown>)[k])])
      );
    }
    return v;
  };
  return JSON.stringify(walk(value));
}

/**
 * The values a client plausibly produces for one field: the wrong scalar types a
 * form or a JSON round-trip yields, the empty and whitespace-only strings that
 * "required" is supposed to catch, and both shapes of a membership field.
 */
const MUTATIONS: unknown[] = [
  'sample',
  '',
  '   ',
  42,
  true,
  null,
  [],
  [LIBRARY],
  LIBRARY,
  ['', ''],
  { nested: 1 },
  // An IRI with a fragment, and one with a query: ordinary in RDF, and the
  // corpus missed them until the IRI validators were compared directly.
  'https://example.org/ns#Thing',
  ['https://example.org/ns#Thing'],
  'https://example.org/q?a=b',
];

function propertyUniverse(pair: Pair): string[] {
  const keys = new Set<string>(Object.keys((pair.server.properties ?? {}) as JsonSchema));
  for (const key of Object.keys((pair.entity?.properties ?? {}) as JsonSchema)) {
    keys.add(key);
  }
  return [...keys];
}

function corpusFor(pair: Pair): Sample[] {
  const samples: Sample[] = [{ value: pair.base }, { value: {} }];

  for (const key of (pair.server.required ?? []) as string[]) {
    const without = { ...pair.base };
    delete without[key];
    samples.push({ value: without });
  }

  for (const key of propertyUniverse(pair)) {
    for (const value of MUTATIONS) {
      samples.push({ value: { ...pair.base, [key]: value }, mutated: { key, value } });
    }
    const dropped = { ...pair.base };
    delete dropped[key];
    samples.push({ value: dropped });
  }

  samples.push({ value: { ...pair.base, zzUnknownField: 'surprise' } });
  return samples;
}

/** The JSON type name ajv would report for a value. */
function jsonTypeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

/** Every type one property subschema declares, following `anyOf`/`oneOf`. */
function declaredTypes(schema: JsonSchema | undefined): Set<string> {
  const types = new Set<string>();
  if (!schema) return types;
  for (const branch of [schema, ...((schema.anyOf ?? []) as JsonSchema[]), ...((schema.oneOf ?? []) as JsonSchema[])]) {
    const type = branch.type;
    if (typeof type === 'string') types.add(type);
    if (Array.isArray(type)) for (const entry of type) types.add(entry as string);
    if (branch.nullable) types.add('null');
  }
  if (types.has('number')) types.add('integer');
  return types;
}

/**
 * True when the value's type is not one the server document declares — the
 * precondition for ajv's `coerceTypes` to be what made the two verdicts differ.
 */
function isTypeMismatch(pair: Pair, mutated: { key: string; value: unknown }): boolean {
  const property = ((pair.server.properties ?? {}) as Record<string, JsonSchema>)[mutated.key];
  const types = declaredTypes(property);
  if (!types.size) return false;
  return !types.has(jsonTypeOf(mutated.value));
}

type Finding = {
  pair: string;
  sample: string;
  kind: 'SERVER-REJECTS' | 'LEAF-REJECTS' | 'THROW';
  detail: string;
};

interface Cause {
  name: string;
  why: string;
  matches: (finding: Finding, sample: Sample, pair: Pair) => boolean;
}

/** The empty and whitespace-only strings a "required" check exists to catch. */
function isBlank(value: unknown): boolean {
  return typeof value === 'string' && value.trim() === '';
}

/**
 * Divergences that are a property of the two mechanisms rather than of any
 * schema, and so do not go away. The predicate is what makes an entry
 * checkable; the prose is what a reviewer has to agree with.
 */
const EXPECTED_CAUSES: Cause[] = [
  {
    name: 'ajv coerces, the leaf does not',
    why:
      "The server validates with `coerceTypes: 'array'`, so a value whose type " +
      'disagrees with the declared one is converted rather than rejected: a number, ' +
      'boolean or null becomes a string, a single-element array is unwrapped to the ' +
      'scalar inside it, and a bare scalar is wrapped into an array. The leaf has no ' +
      'equivalent and rejects. This is the pre- versus post-coercion distinction ' +
      'established in #64: the published types describe what a client may send, and ' +
      'the leaf enforces exactly that. A web app that refuses to send `{name: 42}` is ' +
      'not a bug — it is holding to the narrower contract the types state.',
    matches: (finding, sample, pair) =>
      finding.kind === 'LEAF-REJECTS' && !!sample.mutated && isTypeMismatch(pair, sample.mutated),
  },
  {
    name: 'cross-field rules the leaf carries and the route document leaves to the handler',
    why:
      '`backendCreateSchema` ends in a `superRefine`: an `http` backend must have an ' +
      'endpoint. No JSON Schema document carries it, so the server enforces it in the ' +
      'handler and returns 400 — the same arrangement C2 recorded for the MCP tools. ' +
      'The leaf refusing to send such a body does not deny the user anything: the ' +
      'request would have been rejected on arrival. It is only drift once a leaf ' +
      'refinement rejects something the server would have *accepted*, which is why this ' +
      'is scoped to the one rule rather than to the pair.',
    matches: (finding, sample) =>
      finding.kind === 'LEAF-REJECTS' &&
      finding.pair === 'backend.create' &&
      sample.value.backendType === 'http' &&
      !sample.value.endpoint,
  },
];

/**
 * Drift this phase fixed, kept as an empty list rather than deleted.
 *
 * It carried five causes while C3 was in progress — read-only fields in the
 * leaf's create shape, the Rule and DataBlock body literals, non-emptiness that
 * lived only in the leaf, the unsendable `id: null`, and `oneOf` on the SPARQL
 * request — and each came off as the schema that caused it was fixed. It is the
 * right home for the next such batch: a divergence that is going to be fixed
 * belongs here with its cause, not in KNOWN_DIVERGENCES with the ones that are
 * staying.
 */
const PRE_EXISTING_DRIFT: Cause[] = [];

/**
 * Individual divergences left standing, keyed `<pair> | <kind> | <sample>`.
 *
 * Empty as of Phase B2. It carried twelve, all with one cause: `backend` and
 * `ruleset` were the two entities whose route documents came from
 * `contracts/schema/routes` — the snapshot C1 took of the retired
 * `produceJsonSchema()` output — rather than from the entity model. That
 * round-trip could not carry `format`, `pattern` or `enum`, so those bodies
 * typed `endpoint`, `queryMethod`, `authEnvKey`, `currentVersion` and the two
 * date fields as bare strings and accepted `""` where the leaf did not; and
 * `ruleSet.create` still listed the read-only date fields that every generated
 * create body drops. B2 pointed both routes at the generated documents, so all
 * twelve came off together.
 *
 * An entry here is a divergence someone decided to keep. Prefer
 * `EXPECTED_CAUSES` for a *class* of divergence with a stated reason; this set
 * is for individual samples, listed one by one so that the next one still fails
 * the suite.
 */
const KNOWN_DIVERGENCES = new Set<string>([]);

/** Findings, each paired with the corpus entry that produced it. */
function analyse(): { finding: Finding; sample: Sample; pair: Pair }[] {
  const ajv = createValidatorAjv();
  const results: { finding: Finding; sample: Sample; pair: Pair }[] = [];

  for (const pair of PAIRS) {
    // $id would register the document in the shared instance and collide with
    // the entity schema of the same name; nothing here resolves a $ref by id.
    const { $id, $schema, ...document } = pair.server;
    const validate = ajv.compile(document);

    for (const sample of corpusFor(pair)) {
      const forAjv = structuredClone(sample.value);
      const serverOk = validate(forAjv) as boolean;

      let leafOk: boolean;
      try {
        leafOk = pair.leaf.safeParse(structuredClone(sample.value)).success;
      } catch (error) {
        results.push({
          finding: {
            pair: pair.name,
            sample: canonical(sample.value),
            kind: 'THROW',
            detail: `the leaf threw instead of returning a verdict: ${(error as Error).message}`,
          },
          sample,
          pair,
        });
        continue;
      }

      if (serverOk === leafOk) continue;

      results.push({
        finding: {
          pair: pair.name,
          sample: canonical(sample.value),
          kind: leafOk ? 'SERVER-REJECTS' : 'LEAF-REJECTS',
          detail: leafOk
            ? `web would send this; the server returns 400. Server document: ${pair.serverSource}`
            : `the server accepts this; web refuses to send it. Server document: ${pair.serverSource}`,
        },
        sample,
        pair,
      });
    }
  }

  return results;
}

function unexplained(results: ReturnType<typeof analyse>): Finding[] {
  return results
    .filter(({ finding, sample, pair }) => {
      if (KNOWN_DIVERGENCES.has(`${finding.pair} | ${finding.kind} | ${finding.sample}`)) return false;
      return ![...EXPECTED_CAUSES, ...PRE_EXISTING_DRIFT].some(cause =>
        cause.matches(finding, sample, pair)
      );
    })
    .map(({ finding }) => finding);
}

function report(findings: Finding[]): string {
  return findings
    .slice(0, 60)
    .map(f => `  [${f.kind}] ${f.pair}\n      sample: ${f.sample}\n      ${f.detail}`)
    .join('\n');
}

describe('Phase C3: the web zod leaf agrees with the server document', () => {
  /**
   * The gap this suite had until issue #212: `PAIRS` is an explicit list, so an
   * entity added to `ENTITY_CONTRACT_MODELS` after C3 landed got a zod leaf, a
   * route body and no comparison between them. `TupleSet` sat in that gap with
   * a real SERVER-REJECTS divergence — its hand-written create body omitted the
   * `currentVersion` the leaf offered — and would have stayed there silently.
   *
   * Every CRUD entity has a create and an update body web validates before
   * sending, so coverage is the whole list, and the next entry that lands
   * without a pair fails here rather than in production.
   */
  it('covers every entity that has a contract', () => {
    const covered = new Set(PAIRS.map(pair => pair.name));
    const missing = ENTITY_CONTRACT_MODELS.flatMap(model =>
      ['create', 'update']
        .map(operation => `${model.varName}.${operation}`)
        .filter(name => !covered.has(name))
    );

    expect(
      missing,
      `every entry in ENTITY_CONTRACT_MODELS needs a PAIRS entry per write operation, ` +
        `or the leaf and the route body for it are never compared`
    ).toEqual([]);
  });

  it('never lets web build a request the server rejects', () => {
    const findings = unexplained(analyse()).filter(finding => finding.kind !== 'LEAF-REJECTS');
    if (findings.length) {
      throw new Error(
        `${findings.length} payload(s) the web app considers valid and the server refuses. ` +
          `Each is a 400 a user can reach:\n${report(findings)}`
      );
    }
    expect(findings).toEqual([]);
  });

  it('every divergence has a recorded cause', () => {
    const findings = unexplained(analyse());
    if (findings.length) {
      throw new Error(
        `${findings.length} unexplained divergence(s) between the web leaf and the server. ` +
          `Each must become a deliberate decision — a KNOWN_DIVERGENCES entry, a new ` +
          `EXPECTED_CAUSES rule, or a fix to the schema:\n${report(findings)}`
      );
    }
    expect(findings).toEqual([]);
  });

  /**
   * The leaf does not only check payloads; `useApiClient` sends
   * `JSON.stringify(xCreateSchema.parse(input))`, so whatever the schema
   * transforms is what goes on the wire. Issue #65 asked for that to be a
   * decision rather than a side effect of keeping or dropping the leaf, so it is
   * measured here rather than argued.
   *
   * On the request path there is exactly one transform: the `z.preprocess` that
   * widens a bare `isPartOf` into a single-element array, on the four
   * library-scoped entities. (The twenty `.default([])` in the generated
   * contracts are all on response schemas — query group versions and detection
   * results — so nothing defaults on the way out.)
   */
  /**
   * Phase C's "one IRI-validation definition projected into both", asserted.
   *
   * Both columns used to exist: ajv-formats-draft2019's `iri` pattern on the
   * server, a `uri-js` parse in the leaf. The verdicts below are where they
   * disagreed — the first two rows being ordinary RDF IRIs the API refused while
   * the web app sent them, on every IRI-typed field of every entity.
   */
  it('server and leaf apply the same definition of a valid IRI', () => {
    const ajv = createValidatorAjv();
    const asFormat = ajv.compile({ type: 'string', format: 'iri' });
    const asLeaf = (value: string) => libraryCreateSchema.safeParse({ name: 'L', id: value }).success;

    const cases: [string, boolean, string][] = [
      ['https://example.org/ns#Thing', true, 'a fragment: rejected by the plugin pattern, and the commonest IRI shape in RDF'],
      ['https://example.org/a?b=c#d', true, 'query and fragment together'],
      ['a:b', true, 'a one-character scheme is still a scheme'],
      ['http://', false, 'a scheme identifying nothing: the plugin accepted it'],
      ['urn:', false, 'likewise'],
      ['urn:example:1', true, 'the ordinary case'],
      ['https://example.org/a', true, 'the ordinary case'],
      ['/relative/path', false, 'no scheme'],
      ['', false, 'empty'],
      ['not an iri', false, 'not parseable'],
    ];

    for (const [value, expected, why] of cases) {
      expect(asFormat(value), `ajv: ${value} (${why})`).toBe(expected);
      expect(asLeaf(value), `leaf: ${value} (${why})`).toBe(expected);
    }
  });

  it('the only outgoing transform is one the server would have performed anyway', () => {
    const ajv = createValidatorAjv();
    const normalising: [string, ZodLike, JsonSchema, Record<string, unknown>][] = [
      ['query.create', queryCreateSchema, createQuerySchema.body, { name: 'Q', isPartOf: LIBRARY }],
      ['rule.create', ruleCreateSchema, createRuleSchema.body, { name: 'R', isPartOf: LIBRARY }],
      ['ruleSet.create', ruleSetCreateSchema, createRuleSetSchema.body, { name: 'RS', isPartOf: LIBRARY }],
      ['dataBlock.create', dataBlockCreateSchema, createDataBlockSchema.body, { name: 'D', isPartOf: LIBRARY }],
      ['query.update', queryUpdateSchema, updateQuerySchema.body, { isPartOf: LIBRARY }],
      ['rule.update', ruleUpdateSchema, updateRuleSchema.body, { isPartOf: LIBRARY }],
      ['ruleSet.update', ruleSetUpdateSchema, updateRuleSetSchema.body, { isPartOf: LIBRARY }],
      ['dataBlock.update', dataBlockUpdateSchema, updateDataBlockSchema.body, { isPartOf: LIBRARY }],
    ];

    for (const [name, leaf, server, input] of normalising) {
      const transformed = leaf.safeParse(structuredClone(input));
      expect(transformed.success, name).toBe(true);
      expect((transformed.data as Record<string, unknown>).isPartOf, name).toEqual([LIBRARY]);

      // The same bare string, sent untransformed, arrives at the handler as the
      // same array: `coerceTypes: 'array'` wraps it. So the leaf's preprocess
      // changes what is on the wire but not what the server ends up with, and
      // removing it would not change behaviour — which is the answer to "is this
      // transform load-bearing?": no.
      const { $id, $schema, ...document } = server;
      const asSent = structuredClone(input);
      expect(ajv.compile(document)(asSent), name).toBe(true);
      expect((asSent as Record<string, unknown>).isPartOf, name).toEqual([LIBRARY]);
    }
  });
});
