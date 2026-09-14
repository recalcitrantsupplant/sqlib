/**
 * CRUD Route Schema Builder
 *
 * Generates Fastify route validation schemas for standard CRUD operations.
 */

export interface RouteConfig {
  operations: ('get' | 'list' | 'create' | 'update' | 'delete')[];
  customOperations?: {
    endpoint: string;
    method: 'get' | 'post' | 'put' | 'delete';
    name: string;
    description: string;
    body?: any;
    response?: any;
    responses?: Record<number, any>;
  }[];
}

export interface RouteSchemaBuilderOptions {
  schemaName: string;
  entitySchema: any;
  config: RouteConfig;
  createExample?: any;
  /**
   * Contract fields the route body carries that the entity schema has no
   * property for — `rulesetMembership` and friends. Declared once in
   * `ENTITY_CONTRACT_MODELS` and projected into both the zod leaf and here, so
   * the body fastify registers and the schema web validates with list the same
   * fields.
   */
  extraBodyProperties?: Array<{ name: string; after: string; schema: Record<string, unknown> }>;
}

const ERROR_RESPONSE_SCHEMA = { type: 'object', properties: { error: { type: 'string' } } } as const;

function toExportConst(name: string, schemaObj: any): string {
  return `export const ${name} = ${JSON.stringify(schemaObj, null, 2)} as const;`;
}

function addErrorResponses(base: Record<number, any>, errorStatuses: number[]): Record<number, any> {
  const responses: Record<number, any> = { ...base };
  for (const status of errorStatuses) {
    responses[status] = ERROR_RESPONSE_SCHEMA;
  }
  return responses;
}

type ExtraProperty = { name: string; after: string; schema: Record<string, unknown> };

/** Append the contract-only fields declared to follow `key`, in order. */
function appendExtras(
  properties: Record<string, any>,
  key: string,
  extras: ExtraProperty[]
): void {
  for (const extra of extras) {
    if (extra.after === key) {
      properties[extra.name] = { ...extra.schema };
    }
  }
}

function deriveCreateBody(
  entitySchema: any,
  extras: ExtraProperty[] = []
): { properties: Record<string, any>; required: string[] } {
  const properties: Record<string, any> = {};
  const required: string[] = [];
  const requiredSet = new Set<string>(Array.isArray(entitySchema.required) ? entitySchema.required : []);

  for (const [key, rawProp] of Object.entries(entitySchema.properties ?? {})) {
    const prop = rawProp as any;
    if (prop && typeof prop === 'object' && prop.readOnly) {
      continue;
    }

    const base = prop && typeof prop === 'object' ? { ...prop } : {};
    if (base.readOnly) {
      delete base.readOnly;
    }

    if (key === 'id') {
      base.nullable = true;
    }

    properties[key] = base;

    if (requiredSet.has(key) && key !== 'id') {
      required.push(key);
    }

    appendExtras(properties, key, extras);
  }

  return { properties, required };
}

function deriveUpdateBody(entitySchema: any, extras: ExtraProperty[] = []): Record<string, any> {
  const properties: Record<string, any> = {};

  for (const [key, rawProp] of Object.entries(entitySchema.properties ?? {})) {
    if (key === 'id') {
      continue;
    }

    const prop = rawProp as any;
    if (prop && typeof prop === 'object' && prop.readOnly) {
      continue;
    }

    const base = prop && typeof prop === 'object' ? { ...prop } : {};
    if (base.readOnly) {
      delete base.readOnly;
    }

    properties[key] = base;

    appendExtras(properties, key, extras);
  }

  return properties;
}

/**
 * Build CRUD route schemas for an entity type
 */
export function buildCRUDRoutes(options: RouteSchemaBuilderOptions): string[] {
  const { schemaName, entitySchema, config, createExample, extraBodyProperties = [] } = options;
  const capitalizedName = schemaName;
  const schemaRef = `${schemaName.toLowerCase()}#`;
  const routeSchemas: string[] = [];

  const pushRoute = (name: string, schema: any) => {
    routeSchemas.push(toExportConst(name, schema));
  };

  const standardParams = {
    type: 'object',
    properties: { id: schemaName === 'Query' ? { type: 'string', examples: ['urn:example:query:cities-by-population'] } : { type: 'string' } },
    required: ['id']
  } as const;

  // List operation
  if (config.operations.includes('list')) {
    pushRoute(`get${capitalizedName}sSchema`, {
      tags: [capitalizedName],
      summary: `Get all ${schemaName.toLowerCase()}s`,
      response: addErrorResponses({ 200: { type: 'array', items: { $ref: schemaRef } } }, [500])
    });
  }

  // Get operation
  if (config.operations.includes('get')) {
    pushRoute(`get${capitalizedName}Schema`, {
      tags: [capitalizedName],
      summary: `Get ${schemaName.toLowerCase()} by ID`,
      params: standardParams,
      response: addErrorResponses({ 200: { $ref: schemaRef } }, [404, 500])
    });
  }

  // Create operation
  if (config.operations.includes('create')) {
    const { properties, required } = deriveCreateBody(entitySchema, extraBodyProperties);
    const body: Record<string, any> = {
      type: 'object',
      properties,
      required,
      additionalProperties: false
    };

    if (createExample) {
      body.examples = [createExample];
    }

    pushRoute(`create${capitalizedName}Schema`, {
      tags: [capitalizedName],
      summary: `Create new ${schemaName.toLowerCase()}`,
      body,
      response: addErrorResponses({ 201: { $ref: schemaRef } }, [422, 400, 500])
    });
  }

  // Update operation
  if (config.operations.includes('update')) {
    pushRoute(`update${capitalizedName}Schema`, {
      tags: [capitalizedName],
      summary: `Update ${schemaName.toLowerCase()}`,
      params: standardParams,
      body: {
        type: 'object',
        properties: deriveUpdateBody(entitySchema, extraBodyProperties),
        additionalProperties: false,
        minProperties: 1
      },
      response: addErrorResponses({ 200: { $ref: schemaRef } }, [422, 400, 404, 500])
    });
  }

  // Delete operation
  if (config.operations.includes('delete')) {
    pushRoute(`delete${capitalizedName}Schema`, {
      tags: [capitalizedName],
      summary: `Delete ${schemaName.toLowerCase()}`,
      params: standardParams,
      response: addErrorResponses({ 204: {} }, [404, 500])
    });
  }

  // Custom operations
  for (const op of config.customOperations ?? []) {
    const baseResponses = (() => {
      if (op.responses && Object.keys(op.responses).length > 0) {
        const responses = { ...op.responses };
        if (!('400' in responses)) {
          responses[400] = ERROR_RESPONSE_SCHEMA;
        }
        if (!('500' in responses)) {
          responses[500] = ERROR_RESPONSE_SCHEMA;
        }
        return responses;
      }
      return addErrorResponses({ 200: op.response ?? {} }, [400, 500]);
    })();

    const opSchema: Record<string, any> = {
      tags: [capitalizedName],
      summary: op.description,
      response: baseResponses
    };

    if (op.body) {
      opSchema.body = op.body;
    }

    pushRoute(`${op.name}${capitalizedName}Schema`, opSchema);
  }

  return routeSchemas;
}

/**
 * Format route schemas as a single string with header
 */
export function formatRouteSchemas(schemaName: string, routeSchemas: string[]): string {
  return routeSchemas.length > 0
    ? `\n// Route schemas for ${schemaName}\n${routeSchemas.join('\n\n')}`
    : '';
}
