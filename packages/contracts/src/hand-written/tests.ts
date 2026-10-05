/**
 * Test contracts, and the data graph and tuple set version leaves: what the
 * version and run endpoints return, and what a test version is written with.
 *
 * Hand-written, and kept out of `generated/`, because what is here is the part
 * the entity model cannot say. The leaves themselves — `TestVersion`,
 * `TestCase`, `DataGraphVersion`, `TupleSetVersion` — are projected from the
 * model in `generated/version-shapes.ts`; this module only expands them the way
 * the routes do.
 *
 * The web used to declare all of these itself, and its test case had fallen
 * behind by `dataGraphs`: a client that parses a response with a schema that
 * does not know a field drops it, and the next save writes the version back
 * without it (review C8). Declaring the expansion here, once, is what the web
 * and the API's own route test now both read.
 */
import { z } from 'zod';
import { isIri, IRI_ERROR_MESSAGE } from '../iri.js';
import {
  dataGraphVersionSchema,
  tupleSetVersionSchema,
  testCaseSchema,
  testVersionSchema,
  testCaseShape,
  testVersionShape,
} from '../generated/version-shapes.js';

/*
 * The stored leaves, as the model has them (cases and graphs as IRIs). No
 * route returns these as they are; they are exported for the parity check
 * against the model, and the expanded schemas below are what a client parses.
 */
export { dataGraphVersionSchema, tupleSetVersionSchema, testCaseSchema, testVersionSchema };
export type { DataGraphVersion, TupleSetVersion } from '../generated/version-shapes.js';

const iriString = z
  .string()
  .min(1, 'IRI must be a non-empty string')
  .refine(isIri, IRI_ERROR_MESSAGE);

/**
 * One RDF input a case supplies. The stored `TestCaseDataGraph` child is
 * returned in the shape it is written with, so what a client reads it can send
 * back. Order is the array's.
 */
export const testCaseGraphInputSchema = z
  .object({
    dataGraphVersion: iriString,
  })
  .strict();

export type TestCaseGraphInput = z.infer<typeof testCaseGraphInputSchema>;

/** A case as a version returns it: inlined, with its graphs expanded. */
export const testCaseExpandedSchema = z
  .object({
    ...testCaseShape,
    dataGraphs: z.array(testCaseGraphInputSchema).optional().nullable(),
  })
  .strict();

export type TestCaseExpanded = z.infer<typeof testCaseExpandedSchema>;

/** A test version with its cases inlined, in position order. */
export const testVersionExpandedSchema = z
  .object({
    ...testVersionShape,
    cases: z.array(testCaseExpandedSchema).default([]),
  })
  .strict();

export type TestVersionExpanded = z.infer<typeof testVersionExpandedSchema>;

/**
 * A case as a new version is written with it. No id, version or position:
 * the server assigns those, and position is the order sent.
 */
export const testCaseWriteSchema = testCaseExpandedSchema
  .omit({ id: true, isPartOf: true, position: true, dateCreated: true, dateModified: true })
  .extend({
    dataGraphs: z
      .array(testCaseGraphInputSchema.extend({ port: z.string().optional().nullable() }))
      .optional()
      .nullable(),
  });

export type TestCaseWrite = z.infer<typeof testCaseWriteSchema>;

/** The comparator's diff for one case, when it has one. */
export const comparisonDetailSchema = z
  .object({
    missing: z.array(z.string()).optional(),
    unexpected: z.array(z.string()).optional(),
    matched: z.number().int().optional(),
  })
  .strict()
  .nullable()
  .optional();

/**
 * One case's verdict.
 *
 * The diff is here rather than at the top level because it belongs to the case
 * that produced it — one flattened diff across N cases would be a diff of
 * nothing in particular.
 */
export const testCaseRunResultSchema = z
  .object({
    caseId: z.string(),
    name: z.string(),
    position: z.number().int(),
    passed: z.boolean(),
    message: z.string(),
    detail: comparisonDetailSchema,
    /** What the subject produced, capped server-side. */
    result: z.string().nullable().optional(),
    resultTruncated: z.boolean().nullable().optional(),
    inputs: z
      .object({
        argumentSetVersion: z.string().nullable().optional(),
        /** The first graph. `dataGraphVersions` is the whole list. */
        dataGraphVersion: z.string().nullable().optional(),
        dataGraphVersions: z.array(z.string()).nullable().optional(),
      })
      .strict()
      .optional(),
    durationMs: z.number(),
  })
  .strict();

export type TestCaseRunResult = z.infer<typeof testCaseRunResultSchema>;

/** One verdict per case, plus the summary across them. */
export const testRunResultSchema = z
  .object({
    testId: z.string(),
    testVersionId: z.string(),
    passed: z.boolean(),
    message: z.string(),
    expectationKind: z.string(),
    hermetic: z.boolean(),
    durationMs: z.number(),
    subjectVersionId: z.string().nullable().optional(),
    ranAt: z.string(),
    cases: z.array(testCaseRunResultSchema).default([]),
    passedCount: z.number().int().default(0),
    failedCount: z.number().int().default(0),
  })
  .strict();

export type TestRunResult = z.infer<typeof testRunResultSchema>;

/**
 * The answer to a run-by-tag: the tally, and every verdict behind it.
 *
 * `requested` is how many tests the tags selected — always `results.length`,
 * and present so "no test carries this tag" is a fact a caller can read rather
 * than infer from an empty array.
 */
export const TAG_MATCH_MODES = ['any', 'all'] as const;

/** `any` unions the tags, `all` intersects them. The API defaults to `any`. */
export type TagMatchMode = (typeof TAG_MATCH_MODES)[number];

export const taggedTestRunSchema = z
  .object({
    tags: z.array(z.string()),
    match: z.string(),
    requested: z.number().int(),
    passed: z.number().int(),
    failed: z.number().int(),
    results: z.array(testRunResultSchema).default([]),
  })
  .strict();

export type TaggedTestRun = z.infer<typeof taggedTestRunSchema>;
