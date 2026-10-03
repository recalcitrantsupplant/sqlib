/**
 * The test routes' responses, against the contracts a client parses them with.
 *
 * The routes in `routes/tests.ts` declare their responses as JSON Schema by
 * hand; the web parses the same responses with the zod schemas in
 * `contracts/src/hand-written/tests.ts`. Until those were moved into
 * contracts, the web kept its own copies, and they drifted the way copies do:
 * its test case lacked `dataGraphs`, so a multi-graph test re-saved from the UI
 * lost its graphs (review C8), and its run inputs lacked `dataGraphVersions`.
 *
 * Fastify serialises a response through its schema and drops what the schema
 * does not name, and the contracts parse under `.strict()`, so a field on one
 * side only is either silently missing or a thrown parse. This pins the two
 * key sets together, all the way down.
 */
import { describe, expect, it } from 'vitest';
import {
  testCaseExpandedSchema,
  testCaseRunResultSchema,
  testRunResultSchema,
  testVersionExpandedSchema,
  taggedTestRunSchema,
} from '@sparql-query-lib/contracts';
import {
  runByTagsResponseSchema,
  testCaseResponseSchema,
  testCaseRunResponseSchema,
  testRunResponseSchema,
  testVersionResponseSchema,
} from '../../src/routes/tests.js';

type JsonSchema = Record<string, any>;

/** What a zod schema exposes about itself: its definition. */
interface ZodDef {
  type?: string;
  innerType?: unknown;
  element?: unknown;
  shape?: Record<string, unknown>;
}

function defOf(schema: unknown): ZodDef | undefined {
  const node = schema as { _zod?: { def?: ZodDef }; def?: ZodDef } | undefined;
  return node?._zod?.def ?? node?.def;
}

/** Strip optional/nullable/default wrappers down to the schema underneath. */
function unwrap(schema: unknown): unknown {
  let current = schema;
  for (let depth = 0; depth < 10; depth += 1) {
    const def = defOf(current);
    if (!def?.innerType) return current;
    current = def.innerType;
  }
  return current;
}

/**
 * Every field path on one side and not the other. Nested objects and arrays of
 * objects are walked, so a field missing inside a case or a run's inputs is
 * reported with its path.
 */
function divergences(zod: unknown, json: JsonSchema, path = ''): string[] {
  const def = defOf(unwrap(zod));

  if (def?.type === 'array') {
    return json.type === 'array' && json.items ? divergences(def.element, json.items, `${path}[]`) : [];
  }
  if (def?.type !== 'object' || !json.properties) return [];

  const shape: Record<string, unknown> = def.shape ?? {};
  const zodKeys = new Set(Object.keys(shape));
  const jsonKeys = new Set(Object.keys(json.properties));
  const found: string[] = [];
  for (const key of zodKeys) {
    if (!jsonKeys.has(key)) found.push(`contract only: ${path}${key}`);
  }
  for (const key of jsonKeys) {
    if (!zodKeys.has(key)) found.push(`route only: ${path}${key}`);
  }
  for (const key of zodKeys) {
    if (jsonKeys.has(key)) found.push(...divergences(shape[key], json.properties[key], `${path}${key}.`));
  }
  return found;
}

const PAIRS = [
  { name: 'test case', contract: testCaseExpandedSchema, route: testCaseResponseSchema },
  { name: 'test version', contract: testVersionExpandedSchema, route: testVersionResponseSchema },
  { name: 'case verdict', contract: testCaseRunResultSchema, route: testCaseRunResponseSchema },
  { name: 'run verdict', contract: testRunResultSchema, route: testRunResponseSchema },
  { name: 'run by tags', contract: taggedTestRunSchema, route: runByTagsResponseSchema },
];

describe('test routes and the test contracts agree', () => {
  it.each(PAIRS)('$name: same fields on both sides', ({ contract, route }) => {
    expect(divergences(contract, route as JsonSchema)).toEqual([]);
  });

  it('notices a field on one side only', () => {
    const route = {
      ...testCaseResponseSchema,
      properties: { ...testCaseResponseSchema.properties, extra: { type: 'string' } },
    };
    expect(divergences(testCaseExpandedSchema, route)).toEqual(['route only: extra']);
  });
});
