#!/usr/bin/env tsx

/**
 * Schema Generator - Build-time code generation
 * 
 * Generates OpenAPI schemas and TypeScript types from LDKit schemas.
 * This ensures consistency between RDF persistence layer and REST API.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Property, Schema } from '../src/persistence/schema.js';
import { inferOpenAPIType } from './lib/type-mappings.js';
import { loadEntitySchemas, writeGeneratedFiles, loadExample as loadExampleFromFileOps, buildCreateExampleLookup, type GeneratedFiles } from './lib/file-ops.js';
import { buildCRUDRoutes, formatRouteSchemas, type RouteConfig } from './lib/route-builders/crud.js';
import { buildVersionRoutes } from './lib/route-builders/versions.js';
import { incrementalQueryGroupSchemas } from './lib/route-builders/incremental-query-group.js';
import { emitContractModule } from './lib/emitters/contract-module.js';
import { buildEntityContractDefinition, contractExtraProperties } from './lib/emitters/entity-contract-builder.js';
import { ENTITY_CONTRACT_MODELS } from './lib/emitters/entity-contract-models.js';
import { buildBenchmarkContractDefinition } from './lib/emitters/benchmark-contract-builder.js';
import { buildVersionShapesDefinition } from './lib/emitters/version-shapes-builder.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCHEMAS_DIR = path.join(__dirname, '../src/persistence/schemas');
const OUTPUT_DIR = path.join(__dirname, '../../contracts/src/schema');
const EXAMPLES_DIR = path.join(__dirname, '../examples');
const ENTITIES_FILE = path.join(OUTPUT_DIR, 'entities.generated.ts');
const ROUTES_FILE = path.join(OUTPUT_DIR, 'routes.generated.ts');
const INDEX_FILE = path.join(OUTPUT_DIR, 'index.generated.ts');
const CONTRACTS_OUTPUT_DIR = path.join(__dirname, '../../contracts/src/generated');
const BENCHMARK_CONTRACT_FILE = path.join(CONTRACTS_OUTPUT_DIR, 'benchmark.ts');
const VERSION_SHAPES_FILE = path.join(CONTRACTS_OUTPUT_DIR, 'version-shapes.ts');
const DETECTION_CONTRACT_FILE = path.join(CONTRACTS_OUTPUT_DIR, 'detection.ts');
const EXECUTION_CONTRACT_FILE = path.join(CONTRACTS_OUTPUT_DIR, 'execution.ts');
const PLAYGROUND_CONTRACT_FILE = path.join(CONTRACTS_OUTPUT_DIR, 'playground.ts');

// Load example lookup once at module initialization
const CREATE_EXAMPLE_LOOKUP = buildCreateExampleLookup(EXAMPLES_DIR);

function toKebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

function loadExample(examplePath: string): any | undefined {
  return loadExampleFromFileOps(EXAMPLES_DIR, examplePath);
}

function loadCreateExampleFor(schemaName: string): any | undefined {
  const slug = toKebabCase(schemaName);
  const examplePath = CREATE_EXAMPLE_LOOKUP[slug];
  if (!examplePath) {
    return undefined;
  }
  return loadExample(examplePath);
}

/**
 * Convert an entity schema property to an OpenAPI property
 */
/** An array `isPartOf` that must hold exactly one `Library`. See `hasLibraryMembership`. */
function isLibraryMembership(prop: Property | string | readonly string[]): boolean {
  if (typeof prop === 'string' || Array.isArray(prop)) return false;
  const property = prop as Property;
  return property['@array'] === true && property['@references']?.exactlyOne === 'Library';
}

function convertPropertyToOpenAPI(key: string, prop: Property | string | readonly string[]): any {
  if (typeof prop === 'string' || Array.isArray(prop)) {
    return { type: 'string' };
  }

  const property = prop as Property;
  return inferOpenAPIType(
    key,
    property['@type'],
    property['@id'],
    {
      isArray: property['@array'],
      isOptional: property['@optional'],
      values: property['@values'],
      jsonShape: property['@jsonShape']
    }
  );
}

/**
 * The JSON Schema type of a projected field: the target property's own type.
 *
 * Resolved rather than declared, so a projection cannot drift from the thing
 * it projects. The target and its property are both guaranteed to exist by
 * `schemaIntrospection.resolveProjection` and the corpus test beside it; the
 * throws here are for the generator being run against a half-edited schema.
 */
function projectedPropertyType(
  schemaName: string,
  propertyName: string,
  property: Property,
  projects: NonNullable<Property['@projects']>,
  schemasByName: Map<string, Schema>,
): any {
  const targetType = property['@references']?.types?.[0];
  const where = `${schemaName}.${propertyName}`;
  if (!targetType) {
    throw new Error(`${where} declares "@projects" without a single "@references" type.`);
  }

  const targetSchema = schemasByName.get(targetType);
  if (!targetSchema) {
    throw new Error(`${where} projects from ${targetType}, which has no schema.`);
  }

  const targetProperty = (targetSchema as Record<string, unknown>)[projects.property];
  if (!targetProperty || typeof targetProperty !== 'string' && typeof targetProperty !== 'object') {
    throw new Error(`${where} projects "${projects.property}", which ${targetType} does not have.`);
  }

  const inferred = convertPropertyToOpenAPI(projects.as, targetProperty as Property | string);
  // The target's own optionality says nothing about the projection: the
  // reference may simply be absent, so the field is nullable either way.
  const { nullable: _ignored, readOnly: _alsoIgnored, ...rest } = inferred;
  return rest;
}

/**
 * Convert an entity schema to an OpenAPI schema
 */
function convertToOpenAPISchema(
  schemaName: string,
  entitySchema: Schema,
  schemasByName: Map<string, Schema>,
): any {
  const properties: Record<string, any> = {
    id: { type: 'string', format: 'iri' }
  };
  const required: string[] = ['id'];

  for (const [key, value] of Object.entries(entitySchema)) {
    if (key === '@type') continue; // Skip @type in REST API

    const cleanKey = key.replace('https://schema.org/', '').replace('https://sparql-query-lib/', '');
    properties[cleanKey] = convertPropertyToOpenAPI(cleanKey, value);

    // Override embedded BenchmarkExperimentVersion subject specs to match API shape
    if (schemaName === 'BenchmarkExperimentVersion' && cleanKey === 'subjectSpecs') {
      properties[cleanKey] = {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            subject: { type: 'string', format: 'iri' },
            inputs: { type: 'array', items: { type: 'string', format: 'iri' }, nullable: true },
            backends: { type: 'array', items: { type: 'string', format: 'iri' }, nullable: true },
            // The graph axis, rule-set subjects only. Which entity types are
            // legal on each axis is a per-subject-kind rule, so it is stated in
            // `assertBenchmarkVersionDependencies` rather than here, where the
            // shape can only say "IRIs".
            dataGraphs: { type: 'array', items: { type: 'string', format: 'iri' }, nullable: true },
          },
          required: ['subject'],
        },
      };
    }

    // A declared `@pattern` reaches both emissions from one place; this used to
    // be a hand-patch naming Backend and authEnvKey explicitly (issue #65).
    if (typeof value === 'object' && !Array.isArray(value) && (value as Property)['@pattern']) {
      properties[cleanKey].pattern = (value as Property)['@pattern'];
    }

    // Non-emptiness. Until Phase C3 this lived only in the contract leaf, whose
    // `deriveFieldZod` gave every non-nullable plain string a `.min(1)` and every
    // library-membership array a `.min(1)` — so the web app refused to send an
    // empty name that the server, validating the JSON Schema emitted from this
    // same property, accepted. (`format: iri` and `format: date-time` already
    // reject the empty string, so only formatless strings need this.) The
    // constraint is stated here, once, and the leaf now projects it.
    //
    // Deliberately not applied to nullable properties: ajv preserves an explicit
    // `null` rather than coercing it, so `minLength` and `nullable` do not
    // interact — but "" and null are different values to the leaf, and a
    // nullable string there carries no `.min(1)`.
    // An `enum` already states which strings are legal, so `minLength` on top of
    // it constrains nothing.
    const property = properties[cleanKey];
    if (property.type === 'string' && !property.format && !property.enum && !property.nullable) {
      property.minLength = 1;
    }
    // "at least one parent, exactly one of them a library" — the entity model
    // states it on the property (`@references`), and both the JSON Schema here
    // and the contract leaf's `iriArray.min(1)` project from that one statement.
    if (cleanKey === 'isPartOf' && property.type === 'array' && isLibraryMembership(value)) {
      property.minItems = 1;
    }

    // Add to required if not optional
    if (typeof value !== 'string' && !value['@optional']) {
      required.push(cleanKey);
    }

    /*
     * A declared projection becomes a second, read-only property beside the
     * IRI it follows: `currentVersion` stays the reference and
     * `currentVersionNumber` carries the number read from the version.
     *
     * Its type comes from the target property so it is never restated, and
     * `readOnly` is what keeps it off create and update bodies — the emitters
     * and route builders already drop read-only keys, so nothing new is needed
     * to stop a client sending one. Always nullable: an entity may have no
     * current version, and a dangling reference must read as absent.
     */
    const projects = typeof value === 'object' && !Array.isArray(value)
      ? (value as Property)['@projects']
      : undefined;
    if (projects) {
      properties[projects.as] = {
        ...projectedPropertyType(schemaName, cleanKey, value as Property, projects, schemasByName),
        readOnly: true,
        nullable: true,
      };
    }
  }

  return {
    $id: schemaName.toLowerCase(),
    type: 'object',
    properties,
    required,
  };
}

/**
 * Generate TypeScript interface from OpenAPI schema
 */
function generateTypeScriptInterface(schemaName: string, openApiSchema: any): string {
  const interfaceName = `${schemaName}RestApi`;
  const properties: string[] = [];

  for (const [key, prop] of Object.entries(openApiSchema.properties)) {
    const propDef = prop as any;
    let typeStr = 'string';
    
    if (propDef.type === 'array') {
      const itemType = (propDef.items && (propDef.items as any).type) || 'string';
      typeStr = itemType === 'integer' ? 'number[]' : itemType === 'boolean' ? 'boolean[]' : 'string[]';
    } else if (propDef.type === 'boolean') {
      typeStr = 'boolean';
    } else if (propDef.type === 'integer') {
      typeStr = 'number';
    }

    const optional = propDef.nullable || !openApiSchema.required.includes(key) ? '?' : '';
    const nullable = propDef.nullable ? ' | null' : '';
    
    properties.push(`  ${key}${optional}: ${typeStr}${nullable};`);
  }

  return `export interface ${interfaceName} {
${properties.join('\n')}
}`;
}

function generateBenchmarkContractModule(experimentSchema: any, versionSchema: any): string {
  const definition = buildBenchmarkContractDefinition(experimentSchema, versionSchema);
  return emitContractModule(definition);
}

function generateDetectionContractModule(): string {
  return `/**
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
export const detectQueryRequestSchema = z
  .object({
    query: z.string().min(1, 'Query is required'),
  })
  .strict();

export type DetectQueryRequest = z.infer<typeof detectQueryRequestSchema>;
export const detectInputsResponseSchema = z
  .object({
    valuesInputs: z.array(z.array(z.string()).min(1)).default([]),
    limitParameters: z.array(z.string()).default([]),
    offsetParameters: z.array(z.string()).default([]),
    // Advisory only: parameter groups whose VALUES clause sits inside FILTER EXISTS /
    // NOT EXISTS and reuses an enclosing variable, where SPARQL 1.1 leaves evaluation
    // undefined (SEP-0007). Empty for virtually every query.
    correlatedExistsInputs: z
      .array(
        z
          .object({
            parameters: z.array(z.string()).min(1),
            correlatedVariables: z.array(z.string()).min(1),
          })
          .strict()
      )
      .default([]),
  })
  .strict();

export type DetectInputsResponse = z.infer<typeof detectInputsResponseSchema>;
export const detectOutputsResponseSchema = z.array(z.string());
export type DetectOutputsResponse = z.infer<typeof detectOutputsResponseSchema>;
export const validateQueryResponseSchema = z
  .object({
    valid: z.literal(true),
  })
  .strict();

export type ValidateQueryResponse = z.infer<typeof validateQueryResponseSchema>;
export const validateQueryErrorResponseSchema = z
  .object({
    valid: z.literal(false),
    error: z.string(),
  })
  .strict();

export type ValidateQueryErrorResponse = z.infer<typeof validateQueryErrorResponseSchema>;
export const validateRuleDataRequestSchema = z
  .object({
    ruleOrData: z.string().min(1, 'Rule or data string is required'),
  })
  .strict();

export type ValidateRuleDataRequest = z.infer<typeof validateRuleDataRequestSchema>;
// One rules dialect: SRL (SHACL 1.2 Rules), plus raw SPARQL for callers that
// supply an already-normalized UPDATE. The previous tri-grammar split
// ('shacl-rules' / 'rules-with-aggregation' / 'rules-with-negation') was
// retired with the vendored sparqljs fork — negation is part of SRL and
// aggregation is unsupported.
export const grammarTypeSchema = z.enum([
  'srl',
  'sparql',
]);
export type GrammarType = z.infer<typeof grammarTypeSchema>;
export const grammarValidationResultSchema = z
  .object({
    grammar: grammarTypeSchema,
    valid: z.boolean(),
    normalized: z.string().optional(),
    error: z.string().optional(),
  })
  .strict();

export type GrammarValidationResult = z.infer<typeof grammarValidationResultSchema>;
export const validateRuleDataResponseSchema = z
  .object({
    valid: z.literal(true),
    normalized: z.string(),
    primaryGrammar: grammarTypeSchema.optional(),
    validations: z.array(grammarValidationResultSchema).optional(),
  })
  .strict();

export type ValidateRuleDataResponse = z.infer<typeof validateRuleDataResponseSchema>;
export const validateRuleDataErrorResponseSchema = z
  .object({
    valid: z.literal(false),
    error: z.string(),
    validations: z.array(grammarValidationResultSchema).optional(),
  })
  .strict();

export type ValidateRuleDataErrorResponse = z.infer<typeof validateRuleDataErrorResponseSchema>;
export const formatRequestSchema = z
  .object({
    code: z.string().min(1, 'Code is required'),
  })
  .strict();

export type FormatRequest = z.infer<typeof formatRequestSchema>;
export const formatResponseSchema = z
  .object({
    formatted: z.string(),
  })
  .strict();

export type FormatResponse = z.infer<typeof formatResponseSchema>;
const errorResponseSchema = {
  type: 'object',
  properties: {
    error: { type: 'string' },
  },
  required: ['error'],
  additionalProperties: false,
} as const;

const detectQueryQuerystringSchema = {
  type: 'object',
  properties: {
    query: { type: 'string' },
  },
  required: ['query'],
  additionalProperties: false,
} as const;

`;
}

// RouteConfig interface is imported from crud.ts

const CRUD_OPERATIONS = ['get', 'list', 'create', 'update', 'delete'] as const;

const ROUTE_CONFIGS: Record<string, RouteConfig> = {
  Backend: {
    operations: [...CRUD_OPERATIONS]
  },
  Library: {
    operations: [...CRUD_OPERATIONS]
  },
  Query: {
    operations: [...CRUD_OPERATIONS]
  },
  QueryGroup: {
    operations: [...CRUD_OPERATIONS]
  },
  RuleSet: {
    operations: [...CRUD_OPERATIONS]
  },
  // Only the write operations: `routes/rules.ts` and `routes/data-blocks.ts`
  // register no schema for list/get/delete, so emitting those would be dead
  // exports. The bodies were module-local literals until Phase C3 (issue #65),
  // which is how they came to differ from the projection every other entity
  // gets — see test/contracts/web-leaf-parity.test.ts.
  Rule: {
    operations: ['create', 'update']
  },
  DataBlock: {
    operations: ['create', 'update']
  },
  // Same as Rule/DataBlock: the routes register their own list/get/delete
  // schemas, so only the write bodies are projected here.
  DataGraph: {
    operations: ['create', 'update']
  },
  Test: {
    operations: ['create', 'update']
  },
  // Same as DataGraph/Test: `routes/tags.ts` registers its own list/get/delete
  // schemas, so only the write bodies are projected here.
  Tag: {
    operations: ['create', 'update']
  },
  // Same as DataGraph/Test/Tag: the write bodies are projected here, the rest
  // of `routes/tuple-sets.ts` registers its own schemas. It is the *version*
  // create body that is not a projection of any entity — content arrives in one
  // of four source formats and is normalised before storage — and that one is
  // still declared in the route. This used to say `operations: []` for the
  // whole entity, which is how the hand-written tuple-set create body came to
  // omit `currentVersion` while the leaf offered it (issue #212).
  TupleSet: {
    operations: ['create', 'update']
  },
  BenchmarkExperiment: {
    operations: [...CRUD_OPERATIONS]
  },
  BenchmarkExperimentVersion: {
    operations: [...CRUD_OPERATIONS]
  },
  EtlJob: {
    operations: [...CRUD_OPERATIONS]
  },
  EtlJobVersion: {
    operations: ['get', 'list', 'create']
  },
  QueryVersion: {
    operations: ['get', 'list', 'create'],
    customOperations: [
      {
        endpoint: '/detect-inputs',
        method: 'post',
        name: 'detectInputs',
        description: 'Detect input groups in a SPARQL query',
        body: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'The SPARQL query string to analyze.' }
          },
          required: ['query'],
          additionalProperties: false,
          examples: [loadExample('detect-inputs/query-with-inputs.json')]
        },
        response: {
          type: 'object',
          description: 'Detected inputs including VALUES groups, LIMIT placeholders, and OFFSET placeholders.',
          properties: {
            valuesInputs: {
              type: 'array',
              description: 'An array of input groups (from VALUES clauses), where each group is an array of variable names.',
              items: { type: 'array', items: { type: 'string' } }
            },
            limitParameters: {
              type: 'array',
              description: 'An array of detected LIMIT parameter placeholder names.',
              items: { type: 'string' }
            },
            offsetParameters: {
              type: 'array',
              description: 'An array of detected OFFSET parameter placeholder names.',
              items: { type: 'string' }
            }
          },
          required: ['valuesInputs', 'limitParameters', 'offsetParameters']
        }
      },
      {
        endpoint: '/detect-outputs',
        method: 'post',
        name: 'detectOutputs',
        description: 'Detect output variables in a SELECT query',
        body: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'The SPARQL query string to analyze.' }
          },
          required: ['query'],
          additionalProperties: false,
          examples: [loadExample('detect-outputs/query-with-outputs.json')]
        },
        response: {
          type: 'array',
          items: { type: 'string' }
        }
      },
      {
        endpoint: '/validate',
        method: 'post',
        name: 'validateQuery',
        description: 'Validate SPARQL query syntax',
        body: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'The SPARQL query string to validate.' }
          },
          required: ['query'],
          additionalProperties: false
        },
        responses: {
          200: {
            type: 'object',
            additionalProperties: false,
            properties: {
              valid: { type: 'boolean', const: true }
            },
            required: ['valid']
          },
          400: {
            type: 'object',
            additionalProperties: false,
            properties: {
              valid: { type: 'boolean', const: false },
              error: { type: 'string' }
            },
            required: ['valid', 'error']
          }
        }
      }
    ]
  }
};

// Helper functions moved to scripts/lib/route-builders/crud.ts and versions.ts

/**
 * Generate Fastify route schemas for an entity
 */
function generateRouteSchemas(schemaName: string, entitySchema: any): string {
  const config = ROUTE_CONFIGS[schemaName];
  if (!config) {
    return '';
  }

  const createExample = loadCreateExampleFor(schemaName);
  const contractModel = ENTITY_CONTRACT_MODELS.find(model => model.entityName === schemaName);
  const routeSchemas = buildCRUDRoutes({
    schemaName,
    entitySchema,
    config,
    createExample,
    // One declaration, two emissions: whatever the contract adds to the leaf's
    // shape is added to the body fastify registers for the same route.
    extraBodyProperties: contractModel ? contractExtraProperties(contractModel) : []
  });

  return formatRouteSchemas(schemaName, routeSchemas);
}

// REMOVED: generateVersionRouteSchemas - empty stub
// Canonical routes are built by buildCanonicalVersionRoutes()

export const createQueryVersionForQueryFlatSchema = {
  tags: ['Query'],
  summary: 'Create new query version',
  params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  body: {
    oneOf: [
      // Preferred wrapper shape first so UI example shows it
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          queryVersion: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string', pattern: '^urn:', nullable: true },
              queryString: { type: 'string' },
              comment: { type: 'string', nullable: true },
              queryType: { type: 'string', nullable: true },
              defaultBackend: { type: 'string', format: 'uri', nullable: true },
              limitParameters: { type: 'array', nullable: true, items: { type: 'string' } },
              offsetParameters: { type: 'array', nullable: true, items: { type: 'string' } },
              inputTuples: { type: 'array', nullable: true, items: { type: 'string' } },
              outputs: { type: 'array', nullable: true, items: { type: 'string' } }
            },
            required: ['queryString']
          },
          limitParameters: { type: 'array', nullable: true, items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', pattern: '^urn:' }, name: { type: 'string' }, value: { type: 'integer', nullable: true }, defaultValue: { type: 'integer', nullable: true } }, required: ['id', 'name'] } },
          offsetParameters: { type: 'array', nullable: true, items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', pattern: '^urn:' }, name: { type: 'string' }, value: { type: 'integer', nullable: true }, defaultValue: { type: 'integer', nullable: true } }, required: ['id', 'name'] } },
          inputs: { type: 'array', nullable: true, items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', pattern: '^urn:' }, variableName: { type: 'string' }, allowedTypes: { type: 'array', nullable: true, items: { type: 'string', format: 'uri' } } }, required: ['id', 'variableName'] } },
          outputs: { type: 'array', nullable: true, items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', pattern: '^urn:' }, variableName: { type: 'string' }, description: { type: 'string', nullable: true } }, required: ['id', 'variableName'] } },
          tupleMembers: { type: 'array', nullable: true, items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', pattern: '^urn:' }, position: { type: 'integer' }, variable: { type: 'string' } }, required: ['id', 'position', 'variable'] } },
          inputTuples: { type: 'array', nullable: true, items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', pattern: '^urn:' }, name: { type: 'string', nullable: true }, memberEntries: { type: 'array', items: { type: 'string', pattern: '^urn:' } } }, required: ['id', 'memberEntries'] } },
          outputTuples: { type: 'array', nullable: true, items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', pattern: '^urn:' }, name: { type: 'string' }, memberEntries: { type: 'array', items: { type: 'string', pattern: '^urn:' } } }, required: ['id', 'name', 'memberEntries'] } }
        },
        required: ['queryVersion']
      },
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', pattern: '^urn:', nullable: true },
          queryString: { type: 'string' },
          comment: { type: 'string', nullable: true },
          queryType: { type: 'string', nullable: true },
          defaultBackend: { type: 'string', format: 'uri', nullable: true },
          limitParameters: { type: 'array', nullable: true, items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', pattern: '^urn:' }, name: { type: 'string' }, value: { type: 'integer', nullable: true }, defaultValue: { type: 'integer', nullable: true } }, required: ['id', 'name'] } },
          offsetParameters: { type: 'array', nullable: true, items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', pattern: '^urn:' }, name: { type: 'string' }, value: { type: 'integer', nullable: true }, defaultValue: { type: 'integer', nullable: true } }, required: ['id', 'name'] } },
          inputs: { type: 'array', nullable: true, items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', pattern: '^urn:' }, variableName: { type: 'string' }, allowedTypes: { type: 'array', nullable: true, items: { type: 'string', format: 'uri' } } }, required: ['id', 'variableName'] } },
          outputs: { type: 'array', nullable: true, items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', pattern: '^urn:' }, variableName: { type: 'string' }, description: { type: 'string', nullable: true } }, required: ['id', 'variableName'] } },
          tupleMembers: { type: 'array', nullable: true, items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', pattern: '^urn:' }, position: { type: 'integer' }, variable: { type: 'string' } }, required: ['id', 'position', 'variable'] } },
          inputTuples: { type: 'array', nullable: true, items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', pattern: '^urn:' }, name: { type: 'string', nullable: true }, memberEntries: { type: 'array', items: { type: 'string', pattern: '^urn:' } } }, required: ['id', 'memberEntries'] } },
          outputTuples: { type: 'array', nullable: true, items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', pattern: '^urn:' }, name: { type: 'string' }, memberEntries: { type: 'array', items: { type: 'string', pattern: '^urn:' } } }, required: ['id', 'name', 'memberEntries'] } }
        },
        required: ['queryString']
      },
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          queryVersion: {
            type: 'object',
            additionalProperties: false,
            properties: {
              queryString: { type: 'string' },
              comment: { type: 'string', nullable: true },
              queryType: { type: 'string', nullable: true },
              defaultBackend: { type: 'string', format: 'uri', nullable: true },
              limitParameters: { type: 'array', nullable: true, items: { type: 'string' } },
              offsetParameters: { type: 'array', nullable: true, items: { type: 'string' } },
              inputTuples: { type: 'array', nullable: true, items: { type: 'string' } },
              outputs: { type: 'array', nullable: true, items: { type: 'string' } }
            },
            required: ['queryString']
          },
          limitParameters: { type: 'array', nullable: true, items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', pattern: '^urn:' }, name: { type: 'string' }, value: { type: 'integer', nullable: true }, defaultValue: { type: 'integer', nullable: true } }, required: ['id', 'name'] } },
          offsetParameters: { type: 'array', nullable: true, items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', pattern: '^urn:' }, name: { type: 'string' }, value: { type: 'integer', nullable: true }, defaultValue: { type: 'integer', nullable: true } }, required: ['id', 'name'] } },
          inputs: { type: 'array', nullable: true, items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', pattern: '^urn:' }, variableName: { type: 'string' }, allowedTypes: { type: 'array', nullable: true, items: { type: 'string', format: 'uri' } } }, required: ['id', 'variableName'] } },
          outputs: { type: 'array', nullable: true, items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', pattern: '^urn:' }, variableName: { type: 'string' }, description: { type: 'string', nullable: true } }, required: ['id', 'variableName'] } },
          tupleMembers: { type: 'array', nullable: true, items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', pattern: '^urn:' }, position: { type: 'integer' }, variable: { type: 'string' } }, required: ['id', 'position', 'variable'] } },
          inputTuples: { type: 'array', nullable: true, items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', pattern: '^urn:' }, name: { type: 'string', nullable: true }, memberEntries: { type: 'array', items: { type: 'string', pattern: '^urn:' } } }, required: ['id', 'memberEntries'] } },
          outputTuples: { type: 'array', nullable: true, items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', pattern: '^urn:' }, name: { type: 'string' }, memberEntries: { type: 'array', items: { type: 'string', pattern: '^urn:' } } }, required: ['id', 'name', 'memberEntries'] } }
        },
        required: ['queryVersion']
      }
    ]
  },
  response: {
    201: { type: 'object', additionalProperties: false, properties: {
      queryVersion: { $ref: 'queryversion#' },
      limitParameters: { type: 'array', items: { $ref: 'limitparameter#' } },
      offsetParameters: { type: 'array', items: { $ref: 'offsetparameter#' } },
      inputs: { type: 'array', items: { $ref: 'queryinput#' } },
      outputs: { type: 'array', items: { $ref: 'queryoutput#' } },
      inputTuples: { type: 'array', items: { $ref: 'queryinputtuple#' } },
      outputTuples: { type: 'array', items: { $ref: 'queryoutputtuple#' } },
      inferredOutputs: { type: 'array', items: { type: 'object' } },
      tupleMembers: { type: 'array', items: { $ref: 'tuplemember#' } },
      iriMap: { type: 'object', additionalProperties: { type: 'string', format: 'uri' }, nullable: true }
    }, required: ['queryVersion','limitParameters','offsetParameters','inputs','inputTuples','outputs','outputTuples','tupleMembers'] },
    404: { type: 'object', properties: { error: { type: 'string' } } },
    500: { type: 'object', properties: { error: { type: 'string' } } }
  }
} as const;

export const getQueryVersionForQuerySchema = {
  tags: ['Query'],
  summary: 'Get query version',
  params: { type: 'object', properties: { id: { type: 'string', examples: ['urn:example:query:cities-by-population'] }, version: { type: 'string' } }, required: ['id','version'] },
  response: {
    200: { type: 'object', additionalProperties: false, properties: {
      queryVersion: { $ref: 'queryversion#' },
      limitParameters: { type: 'array', items: { $ref: 'limitparameter#' } },
      offsetParameters: { type: 'array', items: { $ref: 'offsetparameter#' } },
      inputs: { type: 'array', items: { $ref: 'queryinput#' } },
      outputs: { type: 'array', items: { $ref: 'queryoutput#' } },
      inputTuples: { type: 'array', items: { $ref: 'queryinputtuple#' } },
      outputTuples: { type: 'array', items: { $ref: 'queryoutputtuple#' } },
      inferredOutputs: { type: 'array', items: { type: 'object' } },
      tupleMembers: { type: 'array', items: { $ref: 'tuplemember#' } }
    }, required: ['queryVersion'] },
    404: { type: 'object', properties: { error: { type: 'string' } } },
    500: { type: 'object', properties: { error: { type: 'string' } } }
  }
} as const;

export const patchQueryVersionForQuerySchema = {
  tags: ['Query'],
  summary: 'Update query version (same version)',
  params: { type: 'object', properties: { id: { type: 'string', examples: ['urn:example:query:cities-by-population'] }, version: { type: 'string' } }, required: ['id','version'] },
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      queryString: { type: 'string' },
      comment: { type: 'string', nullable: true },
      queryType: { type: 'string', nullable: true },
      defaultBackend: { type: 'string', format: 'uri', nullable: true },
      limitParameters: { type: 'array', nullable: true, items: { type: 'string', format: 'uri' } },
      offsetParameters: { type: 'array', nullable: true, items: { type: 'string', format: 'uri' } },
      inputTuples: { type: 'array', nullable: true, items: { type: 'string', format: 'uri' } },
      outputs: { type: 'array', nullable: true, items: { type: 'string', format: 'uri' } },
      dateCreated: { type: 'string', format: 'date-time', nullable: true }
    }
  },
  response: {
    200: { type: 'object', additionalProperties: false, properties: {
      queryVersion: { $ref: 'queryversion#' },
      limitParameters: { type: 'array', items: { $ref: 'limitparameter#' } },
      offsetParameters: { type: 'array', items: { $ref: 'offsetparameter#' } },
      inputs: { type: 'array', items: { $ref: 'queryinput#' } },
      outputs: { type: 'array', items: { $ref: 'queryoutput#' } },
      inputTuples: { type: 'array', items: { $ref: 'queryinputtuple#' } },
      outputTuples: { type: 'array', items: { $ref: 'queryoutputtuple#' } },
      inferredOutputs: { type: 'array', items: { type: 'object' } },
      tupleMembers: { type: 'array', items: { $ref: 'tuplemember#' } }
    }, required: ['queryVersion'] },
    400: { type: 'object', properties: { error: { type: 'string' } } },
    404: { type: 'object', properties: { error: { type: 'string' } } },
    500: { type: 'object', properties: { error: { type: 'string' } } }
  }
} as const;

// QueryGroup versions  
// Note: These static exports are moved to buildCanonicalVersionRoutes() to avoid reference errors
export const listQueryGroupVersionsForGroupSchema = {
  tags: ['QueryGroup'],
  summary: 'List versions for a query group',
  params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  response: {
    200: { type: 'array', items: { $ref: 'querygroupversion#' } },
    500: { type: 'object', properties: { error: { type: 'string' } } }
  }
} as const;

export const createQueryGroupVersionForGroupFlatSchema = {
  tags: ['QueryGroup'],
  summary: 'Create new group version from a single flat payload',
  params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      queryGroupVersion: {
        type: 'object',
        additionalProperties: false,
        properties: {
          comment: { type: 'string', nullable: true },
          canvasData: { type: 'object', nullable: true, additionalProperties: true },
        }
      },
      executionNodes: { type: 'array', nullable: true, items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', pattern: '^urn:' },
          nodeType: { type: 'string', nullable: true },
          '@type': { type: 'string', nullable: true },
          queryId: { type: 'string', format: 'uri' },
          backendId: { type: 'string', format: 'uri', nullable: true },
        },
        required: ['id', 'queryId']
      } },
      edges: { type: 'array', nullable: true, items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', format: 'iri' },
          sourceNodeId: { type: 'string', format: 'iri' },
          targetNodeId: { type: 'string', format: 'iri' },
          sourceOutputId: { type: 'string', format: 'iri', nullable: true },
          targetInputId: { type: 'string', format: 'iri', nullable: true },
          dataFlowType: { type: 'string', nullable: true },
        },
        required: ['id', 'sourceNodeId', 'targetNodeId']
      } },
      tupleMembers: { type: 'array', nullable: true, items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', format: 'iri' },
          position: { type: 'integer' },
          variable: { type: 'string' }
        },
        required: ['id', 'position', 'variable']
      } },
      inputTuples: { type: 'array', nullable: true, items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', format: 'iri' },
          name: { type: 'string', nullable: true },
          memberEntries: { type: 'array', items: { type: 'string', format: 'iri' } }
        },
        required: ['id', 'memberEntries']
      } },
      outputTuples: { type: 'array', nullable: true, items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', format: 'iri' },
          name: { type: 'string' },
          memberEntries: { type: 'array', items: { type: 'string', pattern: '^urn:' } }
        },
        required: ['id', 'name', 'memberEntries']
      } },
      inputs: { type: 'array', nullable: true, items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', format: 'iri' },
          variableName: { type: 'string' },
          allowedTypes: { type: 'array', nullable: true, items: { type: 'string', format: 'uri' } }
        },
        required: ['id', 'variableName']
      } },
      outputs: { type: 'array', nullable: true, items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', format: 'iri' },
          variableName: { type: 'string' },
          description: { type: 'string', nullable: true }
        },
        required: ['id', 'variableName']
      } },
      rdfOutputs: { type: 'array', nullable: true, items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', format: 'iri' },
          name: { type: 'string' },
          description: { type: 'string', nullable: true },
          mediaType: { type: 'string', nullable: true },
          serializationFormat: { type: 'string', nullable: true }
        },
        required: ['id', 'name']
      } },
      booleanOutputs: { type: 'array', nullable: true, items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', format: 'iri' },
          name: { type: 'string' },
          value: { type: 'boolean', nullable: true }
        },
        required: ['id', 'name']
      } },
      queryIdInputs: { type: 'array', nullable: true, items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', format: 'iri' },
          name: { type: 'string' },
        },
        required: ['id', 'name']
      } }
    }
  },
  response: {
    201: { type: 'object', additionalProperties: false, properties: {
      queryGroupVersion: { $ref: 'querygroupversion#' },
      executionNodes: { type: 'array', items: { anyOf: [ { $ref: 'querynode#' }, { $ref: 'dynamicquerynode#' } ] } },
      edges: { type: 'array', items: { $ref: 'queryedge#' } },
      queryNodes: { type: 'array', items: { $ref: 'querynode#' } },
      dynamicQueryNodes: { type: 'array', items: { $ref: 'dynamicquerynode#' } },
      startNodes: { type: 'array', items: { $ref: 'startnode#' } },
      endNodes: { type: 'array', items: { $ref: 'endnode#' } },
      rdfOutputs: { type: 'array', items: { $ref: 'rdfoutput#' } },
      inputs: { type: 'array', items: { $ref: 'queryinput#' } },
      inputTuples: { type: 'array', items: { $ref: 'queryinputtuple#' } },
      outputs: { type: 'array', items: { $ref: 'queryoutput#' } },
      outputTuples: { type: 'array', items: { $ref: 'queryoutputtuple#' } },
      tupleMembers: { type: 'array', items: { $ref: 'tuplemember#' } },
      iriMap: { type: 'object', additionalProperties: { type: 'string', format: 'uri' }, nullable: true }
    }, required: ['queryGroupVersion', 'iriMap'] },
    404: { type: 'object', properties: { error: { type: 'string' } } },
    500: { type: 'object', properties: { error: { type: 'string' } } }
  }
} as const;

export const getQueryGroupVersionForGroupSchema = {
  tags: ['QueryGroup'],
  summary: 'Get group version',
  params: { type: 'object', properties: { id: { type: 'string', examples: ['urn:example:querygroup:city-analysis'] }, version: { type: 'string' } }, required: ['id','version'] },
  response: {
    200: { type: 'object', additionalProperties: false, properties: {
      queryGroupVersion: { $ref: 'querygroupversion#' },
      executionNodes: { type: 'array', items: { anyOf: [ { $ref: 'querynode#' }, { $ref: 'dynamicquerynode#' } ] } },
      edges: { type: 'array', items: { $ref: 'queryedge#' } },
      queryNodes: { type: 'array', items: { $ref: 'querynode#' } },
      dynamicQueryNodes: { type: 'array', items: { $ref: 'dynamicquerynode#' } },
      startNodes: { type: 'array', items: { $ref: 'startnode#' } },
      endNodes: { type: 'array', items: { $ref: 'endnode#' } },
      rdfOutputs: { type: 'array', items: { $ref: 'rdfoutput#' } },
      inputs: { type: 'array', items: { $ref: 'queryinput#' } },
      inputTuples: { type: 'array', items: { $ref: 'queryinputtuple#' } },
      outputs: { type: 'array', items: { $ref: 'queryoutput#' } },
      outputTuples: { type: 'array', items: { $ref: 'queryoutputtuple#' } },
      tupleMembers: { type: 'array', items: { $ref: 'tuplemember#' } }
    }, required: ['queryGroupVersion'] },
    404: { type: 'object', properties: { error: { type: 'string' } } },
    500: { type: 'object', properties: { error: { type: 'string' } } }
  }
} as const;

export const patchQueryGroupVersionForGroupSchema = {
  tags: ['QueryGroup'],
  summary: 'Update group version (same version)',
  params: { type: 'object', properties: { id: { type: 'string', examples: ['urn:example:querygroup:city-analysis'] }, version: { type: 'string' } }, required: ['id','version'] },
  body: {
    type: 'object',
    // PATCH accepts both the entity wrapper and the legacy flat/expanded form.
    // The route normalizes these representations before enforcing writable fields.
    additionalProperties: true,
    properties: {
      queryGroupVersion: {
        type: 'object',
        additionalProperties: true,
        properties: { immutable: { type: 'boolean', nullable: true } }
      }
    },
    minProperties: 1
  },
  response: {
    200: { type: 'object', additionalProperties: false, properties: {
      queryGroupVersion: { $ref: 'querygroupversion#' },
      executionNodes: { type: 'array', items: { anyOf: [ { $ref: 'querynode#' }, { $ref: 'dynamicquerynode#' } ] } },
      edges: { type: 'array', items: { $ref: 'queryedge#' } },
      queryNodes: { type: 'array', items: { $ref: 'querynode#' } },
      dynamicQueryNodes: { type: 'array', items: { $ref: 'dynamicquerynode#' } },
      startNodes: { type: 'array', items: { $ref: 'startnode#' } },
      endNodes: { type: 'array', items: { $ref: 'endnode#' } },
      rdfOutputs: { type: 'array', items: { $ref: 'rdfoutput#' } },
      inputs: { type: 'array', items: { $ref: 'queryinput#' } },
      inputTuples: { type: 'array', items: { $ref: 'queryinputtuple#' } },
      outputs: { type: 'array', items: { $ref: 'queryoutput#' } },
      outputTuples: { type: 'array', items: { $ref: 'queryoutputtuple#' } },
      tupleMembers: { type: 'array', items: { $ref: 'tuplemember#' } }
    }, required: ['queryGroupVersion'] },
    400: { type: 'object', properties: { error: { type: 'string' } } },
    404: { type: 'object', properties: { error: { type: 'string' } } },
    409: { type: 'object', properties: { error: { type: 'string' } } },
    412: { type: 'object', additionalProperties: true, properties: { error: { type: 'string' }, expected: { type: 'string' } } },
    500: { type: 'object', properties: { error: { type: 'string' } } }
  }
} as const;

/**
 * Main generator function
 */
async function generateSchemas() {
  const schemaFiles = await loadEntitySchemas(SCHEMAS_DIR);
  
  const headerComment = `/**
 * 🤖 This file is auto-generated from LDKit schemas.
 * Do not edit manually - run 'npm run generate-schemas' instead.
 */

`;

  const schemas: string[] = [];
  // The same schema objects the entities file is written from, keyed by their
  // export name, so the version-route builder reads this run's shapes instead of
  // the previous run's file.
  const entitySchemasByExport: Record<string, any> = {};
  const interfaces: string[] = [];
  const routeSchemas: string[] = [];
  const schemaNames: string[] = [];
  const entityContractContent = new Map<string, string>();
  let benchmarkContractContent: string | null = null;
  let benchmarkExperimentSchema: any | null = null;
  let benchmarkExperimentVersionSchema: any | null = null;
const detectionContractContent = generateDetectionContractModule();
  const executionContractContent = generateExecutionContractModule();
  const playgroundContractContent = generatePlaygroundContractModule();

  // Every CRUD entity's contract is projected from its entity schema by the
  // one generic builder; only its declared deviations differ.
  const contractEmitters: Record<string, (openApiSchema: any, entitySchema: Schema) => void> = Object.fromEntries(
    ENTITY_CONTRACT_MODELS.map(model => [
      model.entityName,
      (openApiSchema: any, entitySchema: Schema) => {
        entityContractContent.set(
          model.entityName,
          emitContractModule(buildEntityContractDefinition(model, openApiSchema, entitySchema))
        );
      },
    ])
  );

  // The benchmark contract spans two entities, so it is emitted after the loop
  contractEmitters.BenchmarkExperiment = s => { benchmarkExperimentSchema = s; };
  contractEmitters.BenchmarkExperimentVersion = s => { benchmarkExperimentVersionSchema = s; };

  // These lead the output so their tags come first in the API docs; the rest
  // follow in directory order.
  const orderedSchemas = ['Backend', 'Library', 'Query', 'QueryGroup', 'QueryVersion'];
  const rank = (name: string) => {
    const index = orderedSchemas.indexOf(name);
    return index === -1 ? orderedSchemas.length : index;
  };
  const ordered = schemaFiles
    .map((file, index) => ({ file, index }))
    .sort((a, b) => rank(a.file.name) - rank(b.file.name) || a.index - b.index)
    .map(entry => entry.file);

  // A projection reads its target's datatype rather than restating it, so the
  // converter needs every schema, not just the one it is converting.
  const schemasByName = new Map<string, Schema>(ordered.map(file => [file.name, file.schema]));

  for (const schemaFile of ordered) {
    const schemaName = schemaFile.name;
    const schemaVarName = `${schemaName.toLowerCase()}Schema`;

    const generatedSchema = convertToOpenAPISchema(schemaName, schemaFile.schema, schemasByName);
    entitySchemasByExport[schemaVarName] = generatedSchema;

    schemas.push(`export const ${schemaVarName} = ${JSON.stringify(generatedSchema, null, 2)} as const;`);
    interfaces.push(generateTypeScriptInterface(schemaName, generatedSchema));

    const routeSchemaStr = generateRouteSchemas(schemaName, generatedSchema);
    if (routeSchemaStr) {
      routeSchemas.push(routeSchemaStr);
    }

    schemaNames.push(schemaName);

    contractEmitters[schemaName]?.(generatedSchema, schemaFile.schema);
  }

  if (benchmarkExperimentSchema && benchmarkExperimentVersionSchema) {
    benchmarkContractContent = generateBenchmarkContractModule(
      benchmarkExperimentSchema,
      benchmarkExperimentVersionSchema
    );
  }

  // Prepare file contents
  const entitiesContent = headerComment +
    '// Entity Schemas\n' +
    schemas.join('\n\n') +
    '\n\n// TypeScript Interfaces\n' +
    interfaces.join('\n\n') +
    '\n';

  const incrementalSchemas = Object.entries(incrementalQueryGroupSchemas)
    .map(([exportName, schema]) => `export const ${exportName} = ${JSON.stringify(schema, null, 2)} as const;`)
    .join('\n');
  const incrementalSection = incrementalSchemas ? incrementalSchemas + '\n' : '';

const routesContent = headerComment +
    "import { " + schemas.map(s => s.match(/export const (\w+Schema)/)?.[1]).filter(Boolean).join(', ') + " } from './entities.generated.js';\n\n" +
    '// Route Validation Schemas\n' +
    routeSchemas.join('\n') +
    '\n' + await buildCanonicalVersionRoutes(schemaNames, entitySchemasByExport) +
    (incrementalSection ? '\n' + incrementalSection : '') +
    '\n';

  const indexContent = headerComment +
    "// Re-export all schemas and interfaces\n" +
    "export * from './entities.generated.js';\n" +
    "export * from './routes.generated.js';\n";

  // Write all files using file-ops module
  writeGeneratedFiles(OUTPUT_DIR, {
    entities: entitiesContent,
    routes: routesContent,
    index: indexContent
  });

  // Write contract modules
  fs.mkdirSync(CONTRACTS_OUTPUT_DIR, { recursive: true });

  const entityContractFiles: string[] = [];
  for (const model of ENTITY_CONTRACT_MODELS) {
    const content = entityContractContent.get(model.entityName);
    if (!content) {
      throw new Error(`No entity schema found for declared contract model ${model.entityName}`);
    }
    // The contract file is named for the schema $id: backend.ts, ruleset.ts, …
    const file = path.join(CONTRACTS_OUTPUT_DIR, `${model.schemaId}.ts`);
    fs.writeFileSync(file, content + '\n', 'utf8');
    entityContractFiles.push(file);
  }

  if (benchmarkContractContent) {
    fs.writeFileSync(BENCHMARK_CONTRACT_FILE, benchmarkContractContent + '\n', 'utf8');
  }
  // The entity shapes the two version contract modules used to hand-write.
  // Emitted from this run's schemas, not the ones on disk.
  fs.writeFileSync(
    VERSION_SHAPES_FILE,
    emitContractModule(buildVersionShapesDefinition(entitySchemasByExport as never)) + '\n',
    'utf8'
  );
  if (detectionContractContent) {
    fs.writeFileSync(DETECTION_CONTRACT_FILE, detectionContractContent + '\n', 'utf8');
  }
  if (executionContractContent) {
    fs.writeFileSync(EXECUTION_CONTRACT_FILE, executionContractContent + '\n', 'utf8');
  }
  if (playgroundContractContent) {
    fs.writeFileSync(PLAYGROUND_CONTRACT_FILE, playgroundContractContent + '\n', 'utf8');
  }

  console.log(`✅ Generated schemas written to:`);
  console.log(`   📄 ${ENTITIES_FILE}`);
  console.log(`   🛣️  ${ROUTES_FILE}`);
  console.log(`   📋 ${INDEX_FILE}`);

  // Log contract files
  const contractFiles: string[] = [...entityContractFiles];
  if (benchmarkContractContent) contractFiles.push(BENCHMARK_CONTRACT_FILE);
  if (detectionContractContent) contractFiles.push(DETECTION_CONTRACT_FILE);
  if (executionContractContent) contractFiles.push(EXECUTION_CONTRACT_FILE);
  if (playgroundContractContent) contractFiles.push(PLAYGROUND_CONTRACT_FILE);

  if (contractFiles.length > 0) {
    console.log(`   🧩 Contract modules:`);
    contractFiles.forEach(file => console.log(`      - ${file}`));
  }

  console.log(`📊 Generated ${schemas.length} entity schemas, ${interfaces.length} interfaces, and route schemas for ${routeSchemas.length} entities`);
}

/**
 * Build execution contract module (non-LDKit, API-only)
 */
function generateExecutionContractModule(): string {
  return `/**
 * 🤖 This file is auto-generated from LDKit schemas.
 * Do not edit manually - run 'npm run generate-schemas' instead.
 */
import { z } from 'zod';
import { isIri, IRI_ERROR_MESSAGE } from '../iri.js';

const iriString = z
  .string()
  .min(1, 'IRI must be a non-empty string')
  .refine(isIri, IRI_ERROR_MESSAGE);

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
const sparqlBindingValueSchema = z
  .object({
    type: z.enum(['uri', 'literal']),
    value: z.string(),
    'xml:lang': z.string().optional(),
    datatype: iriString.optional(),
  })
  .strict();

const sparqlBindingSchema = z.union([
  z.record(z.string(), sparqlBindingValueSchema.nullable()),
  z.null(),
]);

const executionArgumentHeadSchema = z
  .object({
    vars: z.array(z.string()),
  })
  .strict();

const executionArgumentPayloadSchema = z
  .object({
    bindings: z.array(sparqlBindingSchema),
  })
  .strict();

export const executionArgumentSchema = z
  .object({
    head: executionArgumentHeadSchema,
    arguments: executionArgumentPayloadSchema,
    whenEmpty: z.enum(['unconstrained', 'propagateEmpty', 'require']).optional(),
  })
  .strict();

export type ExecutionArgument = z.infer<typeof executionArgumentSchema>;

/** One LIMIT or OFFSET parameter. Exported: \`POST /sparql\` takes the same list. */
export const executionParameterSchema = z
  .object({
    name: z.string(),
    value: z.number().int().min(0),
  })
  .strict();

const executionLimitSchema = executionParameterSchema;
const executionOffsetSchema = executionParameterSchema;

/**
 * One data graph a run hands to a query group's start node.
 *
 * The RDF counterpart of \`arguments\`: a start node declares tuple inputs and
 * data graph inputs independently, so a run may carry both. \`port\` names which
 * declared input the graph fills, by IRI or by name; omit it when the group
 * declares a single one, or supply the graphs in declaration order.
 *
 * Exactly one of three ways in, the same three every input slot takes:
 * \`dataGraphVersionId\` pins an immutable version, so the run is reproducible;
 * \`dataGraphId\` names the graph and floats to whatever its current version is;
 * \`dataGraphInline\` is ephemeral RDF, never written to the library.
 */
export const executionDataGraphSchema = z
  .object({
    port: z.string().min(1).optional(),
    dataGraphVersionId: iriString.optional(),
    dataGraphId: iriString.optional(),
    dataGraphInline: z.string().optional(),
    dataGraphInlineFormat: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    const hasInline = typeof data.dataGraphInline === 'string' && data.dataGraphInline.trim().length > 0;
    const supplied = [Boolean(data.dataGraphVersionId), Boolean(data.dataGraphId), hasInline].filter(Boolean).length;
    if (supplied !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dataGraphVersionId'],
        message: 'Each data graph needs exactly one of dataGraphVersionId, dataGraphId or dataGraphInline',
      });
    }
  });

export type ExecutionDataGraph = z.infer<typeof executionDataGraphSchema>;

export const executionRequestSchema = z
  .object({
    targetId: iriString,
    backendId: iriString.optional(),
    arguments: z.array(executionArgumentSchema).optional(),
    limits: z.array(executionLimitSchema).optional(),
    offsets: z.array(executionOffsetSchema).optional(),
    argumentSetIds: z.array(iriString).optional(),
    dataGraphs: z.array(executionDataGraphSchema).optional(),
    nodeDetail: z.enum(['timings', 'results']).optional(),
  })
  .strict();
/*
 * A run may name argument sets *and* supply inline values, for the parameters
 * those sets leave open. This carried a superRefine refusing the combination
 * outright; that is no longer the rule, and it could not have been expressed
 * here anyway: whether a value overlaps depends on what the named sets actually
 * fill, which the route knows and a shape schema cannot. The execute route
 * refuses an overlap per parameter, naming it. See docs/concepts.md.
 */

export type ExecutionRequest = z.infer<typeof executionRequestSchema>;
export const executionQuerystringSchema = z
  .object({
    targetId: iriString,
    backendId: iriString.optional(),
    arguments: z.string().optional(),
    limits: z.string().optional(),
    offsets: z.string().optional(),
    argumentSetIds: z.string().optional(),
    /*
     * JSON, like the four above. Present for parity with the POST body: a group
     * run that needed a data graph could only be expressed one way round, and a
     * caller reaching for GET had no way to say so at all.
     */
    dataGraphs: z.string().optional(),
    nodeDetail: z.enum(['timings', 'results']).optional(),
  })
  .strict();

export type ExecutionQuerystring = z.infer<typeof executionQuerystringSchema>;
export const executionResponseSchema = z.any();
export type ExecutionResponse = z.infer<typeof executionResponseSchema>;

const errorResponseSchema = {
  type: 'object',
  properties: {
    error: { type: 'string' },
    failedNodeId: { type: 'string' },
    failedNodeName: { type: 'string' },
    nodes: { type: 'array', items: { type: 'object', additionalProperties: true } },
  },
  required: ['error'],
  additionalProperties: false,
} as const;

`;
}

function generatePlaygroundContractModule(): string {
  return `/**
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
`;
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  generateSchemas().catch(console.error);
}

export { generateSchemas };

// Canonical version route generator - now uses buildVersionRoutes from versions.ts
async function buildCanonicalVersionRoutes(
  schemaNames: string[],
  entitySchemas: Record<string, any>
): Promise<string> {
  const queryVersionExample = loadExample('workflows/basic-workflow/04-create-query-version.json');
  const queryGroupVersionExample = loadExample('workflows/basic-workflow/06-create-query-group-version.json');

  return buildVersionRoutes({
    schemaNames,
    queryVersionExample,
    queryGroupVersionExample,
    entitySchemas
  });
}

// Old buildCanonicalVersionRoutes implementation removed (340+ lines of template strings)
