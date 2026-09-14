/**
 * 🤖 This file is auto-generated from LDKit schemas.
 * Do not edit manually - run 'npm run generate-schemas' instead.
 */
import { z } from 'zod';

/**
 * Strip redundant propertyNames subschemas of the form { type: 'string' }.
 *
 * z.record(z.string(), ...) emits this, but JSON object keys are always
 * strings, so it constrains nothing. Meanwhile fast-json-stringify annotates it
 * with fjs_type / object type when building a response serializer, which makes
 * Fastify's strict Ajv log, on every response containing such a record:
 *   type "object" not allowed by context "string" at .../propertyNames
 * Value types are still enforced by additionalProperties, so dropping the
 * redundant form is lossless. A propertyNames carrying real constraints (e.g.
 * pattern) is left untouched.
 */
// Error schema (reusable)
const executionErrorSchema = z
  .object({
    message: z.string(),
    stack: z.string().optional(),
  })
  .strict();

// Data block execution record
const dataBlockExecutionSchema = z
  .object({
    dataBlockVersionId: z.string(),
    programSource: z.enum(['normalized', 'raw']),
    durationMs: z.number(),
    tripleDelta: z.number(),
    error: executionErrorSchema.nullable().optional(),
  })
  .strict();

export type DataBlockExecution = z.infer<typeof dataBlockExecutionSchema>;

// Rule execution record
const ruleExecutionRecordSchema = z
  .object({
    ruleVersionId: z.string(),
    /**
     * The author's "RULE <iri>", when the rule declares one — the identity the
     * rule set gives the rule, as against the entity id we executed. Absent for
     * an unnamed rule, which is attributed to ruleVersionId instead.
     */
    ruleIri: z.string().nullable().optional(),
    /**
     * The stratum this firing was evaluated in, 0-based as the stratifier
     * reports it. Absent on a run whose rule set was never stratified.
     */
    stratum: z.number().nullable().optional(),
    programSource: z.enum(['normalized', 'raw']),
    durationMs: z.number(),
    triplesInserted: z.number(),
    triplesDeleted: z.number(),
    quadSamples: z.array(z.string()),
    insertedQuads: z.array(z.string()),
    deletedQuads: z.array(z.string()),
    /** Named tuples this rule added to the workspace, rendered "TUPLE(a, b)". */
    insertedTuples: z.array(z.string()).nullable().optional(),
    timedOut: z.boolean(),
    error: executionErrorSchema.nullable().optional(),
  })
  .strict();

export type RuleExecutionRecord = z.infer<typeof ruleExecutionRecordSchema>;

// Iteration record
const iterationRecordSchema = z
  .object({
    index: z.number(),
    signature: z.string(),
    tripleCount: z.number(),
    /** Rows in the named-tuple workspace at the end of this iteration. */
    tupleCount: z.number().nullable().optional(),
    delta: z.number(),
    /**
     * Wall clock for the whole pass, milliseconds — not the sum of the rules',
     * which omits the dataset capture either side of each one. Absent on a
     * record produced before the field existed.
     */
    durationMs: z.number().nullable().optional(),
    /** The stratum this pass evaluated, 0-based as the stratifier reports it. */
    stratum: z.number().nullable().optional(),
    rules: z.array(ruleExecutionRecordSchema),
  })
  .strict();

export type IterationRecord = z.infer<typeof iterationRecordSchema>;

// Cycle detection info
const cycleSchema = z
  .object({
    startIteration: z.number(),
    endIteration: z.number(),
  })
  .strict();

export type Cycle = z.infer<typeof cycleSchema>;

// Request schema - used by both playground and library ruleset execution
export const ruleSetExecutionRequestSchema = z
  .object({
    /**
     * The rule set as one SRL document: prologue, DATA blocks and rules. This is
     * the authoring form — a rule set *is* a document — and the server splits it
     * into rules and data blocks. Takes precedence over the two arrays below.
     */
    srl: z.string().nullable().optional(),
    /** Initial named tuples (TUPLE rows). Requires the tuples flag. */
    tupleSeeds: z.string().nullable().optional(),
    /** Opt into the rule-tuples extension (w3c/data-shapes#752). */
    tuples: z.boolean().nullable().optional(),
    /** @deprecated Pre-split parts; send srl instead. */
    dataBlocks: z.array(z.string()).nullable().optional(),
    /** @deprecated Pre-split parts; send srl instead. */
    rules: z.array(z.string()).nullable().optional(),
    inferenceFormat: z.string().nullable().optional(),
    maxIterations: z.number().int().min(1).nullable().optional(),
    /**
     * The data graph the rules run against — the base graph G0, and the input
     * side of the ledger. Not to be confused with the document's DATA blocks,
     * which are part of the rule set and come *out* in the inference graph.
     *
     * A saved version id makes the run reproducible; a graph id floats to its
     * current version; inline RDF is ephemeral (the browser may keep it in
     * local scratch, the library never does). Sending more than one is an error
     * rather than a precedence rule, because there is no reading of "both" that
     * is not a mistake on the caller's part.
     */
    dataGraphVersionId: z.string().nullable().optional(),
    dataGraphId: z.string().nullable().optional(),
    dataGraphInline: z.string().nullable().optional(),
    dataGraphInlineFormat: z
      .enum(['text/turtle', 'application/n-triples', 'application/n-quads'])
      .nullable()
      .optional(),
  })
  .strict();

export type RuleSetExecutionRequest = z.infer<typeof ruleSetExecutionRequestSchema>;
// Response schema - used by both playground and library ruleset execution
export const ruleSetExecutionResponseSchema = z
  .object({
    status: z.enum(['converged', 'cycle', 'maxIterations', 'failed']),
    iterations: z.array(iterationRecordSchema),
    dataBlocks: z.array(dataBlockExecutionSchema),
    /**
     * The triples the DATA blocks seeded. With every rule's inserts and
     * deletes, this accounts for finalGraphNQuads in full, so a client can
     * replay a run and reconcile against the final graph.
     */
    seededQuads: z.array(z.string()).nullable().optional(),
    finalGraphNQuads: z.string().nullable().optional(),
    finalGraphContent: z.string().nullable().optional(),
    finalGraphContentType: z.string().nullable().optional(),
    /** The named-tuple workspace when the run ended. Absent when tuples were unused. */
    finalTuples: z.array(z.string()).nullable().optional(),
    cycle: cycleSchema.nullable().optional(),
    maxIterations: z.number().nullable().optional(),
    ruleNames: z.record(z.string(), z.string()).nullable().optional(),
  })
  .strict();

export type RuleSetExecutionResponse = z.infer<typeof ruleSetExecutionResponseSchema>;
// Backward compatibility aliases - playground names are deprecated but kept for compatibility
/** @deprecated Use ruleSetExecutionRequestSchema instead */
export const playgroundRulesExecuteRequestSchema = ruleSetExecutionRequestSchema;
/** @deprecated Use RuleSetExecutionRequest instead */
export type PlaygroundRulesExecuteRequest = RuleSetExecutionRequest;
/** @deprecated Use ruleSetExecutionResponseSchema instead */
export const playgroundRulesExecuteResponseSchema = ruleSetExecutionResponseSchema;
/** @deprecated Use RuleSetExecutionResponse instead */
export type PlaygroundRulesExecuteResponse = RuleSetExecutionResponse;

