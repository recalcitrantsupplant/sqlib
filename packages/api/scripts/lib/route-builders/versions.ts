/**
 * Version Route Schema Builder
 *
 * Generates Fastify route validation schemas for query version and query group version operations.
 * These are "canonical" routes that handle the wrapper object pattern with nested child arrays.
 */

export interface VersionRouteOptions {
  schemaNames: string[];
  queryVersionExample?: any;
  queryGroupVersionExample?: any;
  /**
   * The entity schemas built by the run in progress, keyed as they are exported
   * (`limitparameterSchema`, …).
   *
   * Without them this reads `entities.generated.js` off disk — the file the same
   * run is about to overwrite — so a change to an entity property reached the
   * version routes only on the *next* generation. Every such change needed two
   * runs to settle, and one run left the two files describing different shapes.
   */
  entitySchemas?: Record<string, any>;
}

/**
 * One generated JSON Schema document.
 *
 * The fields below are `any` because that is what they are — hand-shaped JSON
 * that `deriveCreateShape` reads structurally. A new one gets this name rather
 * than a twenty-eighth `any`, which the repo's ratchet counts and refuses.
 */
type GeneratedSchemaDoc = Record<string, unknown>;

interface ImportedSchemas {
  limitparameterSchema: any;
  offsetparameterSchema: any;
  queryinputvariableSchema: any;
  queryoutputvariableSchema: any;
  tuplememberSchema: any;
  queryinputtupleSchema: any;
  queryoutputtupleSchema: any;
  queryedgeSchema: any;
  triplesquadsioSchema: any;
  booleanioSchema: any;
  queryidinputSchema: any;
  queryversionSchema: any;
  querygroupversionSchema?: any;
  startnodeSchema?: any;
  endnodeSchema?: any;
  dynamicquerynodeSchema?: any;
  querynodeSchema?: any;
  rulesetnodeSchema?: any;
  patchnodeSchema?: GeneratedSchemaDoc;
}

/**
 * Helper function to format example JSON as an OpenAPI examples block
 */
function formatExamplesBlock(example: any | undefined, indent: string): string {
  if (!example) {
    return '';
  }

  const lines = JSON.stringify(example, null, 2)
    .split('\n')
    .map(line => `${indent}  ${line}`)
    .join('\n');

  return `,\n${indent}examples: [\n${lines}\n${indent}]`;
}

/**
 * Derives a "create" shape from a base schema:
 * - Allows providing an `id` (temporary URN) while keeping it optional
 * - Removes readOnly fields
 * - Removes isPartOf from required
 */
function deriveCreateShape(base: any): any {
  return {
    type: 'object',
    additionalProperties: false,
    properties: (() => {
      const out: Record<string, any> = {
        id: { type: 'string', pattern: '^urn:', nullable: true }
      };
      const src: any = base.properties || {};
      for (const k of Object.keys(src)) {
        if (k === 'id' || k === 'isPartOf') continue;
        const p: any = { ...src[k] };
        if (p.readOnly) delete p.readOnly;
        if (p && p.type === 'string' && p.format === 'uri') delete p.format;
        out[k] = p;
      }
      return out;
    })(),
    required: (base.required || []).filter((r: string) => r !== 'id' && r !== 'isPartOf')
  } as const;
}

/**
 * Build query version and query group version route schemas
 */
export async function buildVersionRoutes(options: VersionRouteOptions): Promise<string> {
  const { schemaNames, queryVersionExample, queryGroupVersionExample } = options;

  // Identify execution node types
  const executionNodeIds = schemaNames
    .filter((n) => /(QueryNode|DynamicQueryNode|RuleSetNode|PatchNode)$/.test(n))
    .map((n) => n.toLowerCase());
  const startNodeId = schemaNames.find((n) => /StartNode$/.test(n))?.toLowerCase();
  const endNodeId = schemaNames.find((n) => /EndNode$/.test(n))?.toLowerCase();

  const queryVersionExampleSnippet = formatExamplesBlock(queryVersionExample, '    ');
  const queryGroupVersionExampleSnippet = formatExamplesBlock(queryGroupVersionExample, '    ');

  // Prefer this run's schemas; fall back to the last generated file for callers
  // that have none to hand (the snapshot tests import this module directly).
  const importedSchemas = (options.entitySchemas ??
    (await import('../../../../contracts/src/schema/entities.generated.js'))) as ImportedSchemas;

  // Pre-compute derived shapes
  const limitParameterCreateShape = deriveCreateShape(importedSchemas.limitparameterSchema);
  const offsetParameterCreateShape = deriveCreateShape(importedSchemas.offsetparameterSchema);
  const queryInputCreateShape = deriveCreateShape(importedSchemas.queryinputvariableSchema);
  const queryOutputCreateShape = deriveCreateShape(importedSchemas.queryoutputvariableSchema);
  const tupleMemberCreateShape = deriveCreateShape(importedSchemas.tuplememberSchema);
  const queryInputTupleCreateShape = deriveCreateShape(importedSchemas.queryinputtupleSchema);
  const queryOutputTupleCreateShape = deriveCreateShape(importedSchemas.queryoutputtupleSchema);
  const queryEdgeCreateShape = deriveCreateShape(importedSchemas.queryedgeSchema);
  const rdfOutputCreateShape = deriveCreateShape(importedSchemas.triplesquadsioSchema);
  const booleanOutputCreateShape = deriveCreateShape(importedSchemas.booleanioSchema);
  const queryIdInputCreateShape = deriveCreateShape(importedSchemas.queryidinputSchema);

  // Also pre-compute node shapes - import them conditionally since they might not exist
  let startnodeCreateShape, endnodeCreateShape, dynamicquerynodeCreateShape, querynodeCreateShape, rulesetnodeCreateShape, patchnodeCreateShape;

  startnodeCreateShape = importedSchemas.startnodeSchema ? deriveCreateShape(importedSchemas.startnodeSchema) : null;
  endnodeCreateShape = importedSchemas.endnodeSchema ? deriveCreateShape(importedSchemas.endnodeSchema) : null;
  dynamicquerynodeCreateShape = importedSchemas.dynamicquerynodeSchema ? deriveCreateShape(importedSchemas.dynamicquerynodeSchema) : null;
  querynodeCreateShape = importedSchemas.querynodeSchema ? deriveCreateShape(importedSchemas.querynodeSchema) : null;
  rulesetnodeCreateShape = importedSchemas.rulesetnodeSchema ? deriveCreateShape(importedSchemas.rulesetnodeSchema) : null;
  patchnodeCreateShape = importedSchemas.patchnodeSchema ? deriveCreateShape(importedSchemas.patchnodeSchema) : null;
  // The flat write payload calls this `ruleSetVersion`, the same name the
  // property, the predicate and every read response use. It used to be renamed
  // to `ruleSetVersionId` here and nowhere else, which is why the writer had a
  // `?? ` fallback that no validated request could ever reach — the create body
  // accepted only the renamed form.
  //
  // `ruleSetVersionId` stays accepted, as a deprecated alias, because it is the
  // only spelling clients can be sending today. Neither is `required` on its
  // own; the pair is, which is what the `anyOf` says. `GroupVersionWriter`
  // already rejects a RuleSetNode carrying neither, naming the node it found.
  if (rulesetnodeCreateShape) {
    const props = rulesetnodeCreateShape.properties || {};
    if (props.ruleSetVersion) {
      props.ruleSetVersionId = { ...props.ruleSetVersion };
    }
    const requiredList: string[] = rulesetnodeCreateShape.required || [];
    const idx = requiredList.indexOf('ruleSetVersion');
    if (idx !== -1) {
      requiredList.splice(idx, 1);
      rulesetnodeCreateShape.anyOf = [
        { required: ['ruleSetVersion'] },
        { required: ['ruleSetVersionId'] },
      ];
    }
    if (requiredList.length === 0) {
      delete rulesetnodeCreateShape.required;
    }
  }

  /**
   * The order of the `executionNodes` `anyOf`, most specific first.
   *
   * This is not cosmetic. Fastify serializes an `anyOf` with the **first**
   * branch the value validates against, and none of the four node schemas sets
   * `additionalProperties: false` — so a branch matches on its `required` list
   * alone, and everything a branch does not declare is dropped on the way out.
   *
   * `dynamicquerynode` requires only `id`, so with the schemas in name order it
   * came first and *every* node serialized as one. A `RuleSetNode` therefore
   * came back with no `ruleSetVersion` and a `PatchNode` with neither of its
   * halves, both silently: the node arrives naming nothing to run, and a client
   * that saves what it read sends back a node the writer refuses. Nothing
   * noticed because a `QueryNode` under the dynamic branch loses nothing — its
   * properties are a subset — which is the only case the suites covered.
   *
   * So the branches are ordered by how much they demand: `ruleSetVersion` and
   * then `queryId` are what separate the four, and the least demanding goes
   * last. Adding a node type means putting it here, above anything it would
   * validate against.
   */
  const EXECUTION_NODE_SERIALIZATION_ORDER = ['rulesetnode', 'patchnode', 'querynode', 'dynamicquerynode'];
  const orderedExecutionNodeIds = [...executionNodeIds].sort((a, b) => {
    const rank = (id: string) => {
      const index = EXECUTION_NODE_SERIALIZATION_ORDER.indexOf(id);
      return index === -1 ? EXECUTION_NODE_SERIALIZATION_ORDER.length : index;
    };
    return rank(a) - rank(b) || executionNodeIds.indexOf(a) - executionNodeIds.indexOf(b);
  });

  // Now compute the shapes for template usage
  const executionNodeAnyOf = orderedExecutionNodeIds.map((id) => `{ $ref: '${id}#' }`).join(', ');
  const executionNodeCreateAnyOf = [dynamicquerynodeCreateShape, querynodeCreateShape, rulesetnodeCreateShape, patchnodeCreateShape]
    .filter(Boolean)
    .map(shape => JSON.stringify(shape, null, 6))
    .join(', ');

  const startNodeShape = startnodeCreateShape ? JSON.stringify(startnodeCreateShape, null, 6) : '{ type: "object" }';
  const endNodeShape = endnodeCreateShape ? JSON.stringify(endnodeCreateShape, null, 6) : '{ type: "object" }';
  const startNodeRef = startNodeId ? `{ $ref: '${startNodeId}#' }` : '{ type: "object" }';
  const endNodeRef = endNodeId ? `{ $ref: '${endNodeId}#' }` : '{ type: "object" }';

  // Build query version body schema
  const queryversionBodySchema = {
    type: 'object',
    additionalProperties: false,
    properties: (() => {
      const src: any = importedSchemas.queryversionSchema.properties || {};
      const out: Record<string, any> = {};
      // Include optional id for client-supplied or temporary URNs
      out.id = { type: 'string', pattern: '^urn:', nullable: true };
      for (const k of Object.keys(src)) {
        if (k === 'id' || k === 'isPartOf' || k === 'version' || k === 'dateCreated' || k === 'limitParameters' || k === 'offsetParameters' || k === 'inputTuples' || k === 'outputs') continue;
        out[k] = src[k];
      }
      return out;
    })(),
    required: (importedSchemas.queryversionSchema.required || []).filter((r: string) =>
      r !== 'id' && r !== 'isPartOf' && r !== 'version' && r !== 'dateCreated' && r !== 'limitParameters' && r !== 'offsetParameters' && r !== 'inputTuples' && r !== 'outputs'
    )
  } as const;

  // Build query group version body schema
  const querygroupversionBodySchema = importedSchemas.querygroupversionSchema ? {
    type: 'object',
    additionalProperties: false,
    properties: (() => {
      const src: any = importedSchemas.querygroupversionSchema.properties || {};
      const out: Record<string, any> = {};
      for (const k of Object.keys(src)) {
        if (k === 'id' || k === 'version' || k === 'isPartOf' || k === 'dateCreated' || k === 'executionNodes' || k === 'edges') continue;
        out[k] = src[k];
      }
      return out;
    })(),
    required: []
  } as const : null;

  return `
// Version route schemas (canonical)

// Query versions
export const listQueryVersionsForQuerySchema = {
  tags: ['Query'],
  summary: 'List versions for a query',
  params: { type: 'object', properties: { id: { type: 'string', examples: ['urn:example:query:cities-by-population'] } }, required: ['id'] },
  response: { 200: { type: 'array', items: { $ref: 'queryversion#' } }, 500: { type: 'object', properties: { error: { type: 'string' } } } }
} as const;

const __createQueryVersionBodySchema = ${JSON.stringify(queryversionBodySchema, null, 2)} as const;

export const createQueryVersionForQuerySchema = {
  tags: ['Query'],
  summary: 'Create new query version',
  params: { type: 'object', properties: { id: { type: 'string', examples: ['urn:example:query:cities-by-population'] } }, required: ['id'] },
  body: {
    type: 'object', additionalProperties: false,
    properties: {
      queryVersion: __createQueryVersionBodySchema,
      limitParameters: { type: 'array', items: ${JSON.stringify(limitParameterCreateShape, null, 6)} },
      offsetParameters: { type: 'array', items: ${JSON.stringify(offsetParameterCreateShape, null, 6)} },
      inputs: { type: 'array', items: ${JSON.stringify(queryInputCreateShape, null, 6)} },
      outputs: { type: 'array', items: ${JSON.stringify(queryOutputCreateShape, null, 6)} },
      tupleMembers: { type: 'array', items: ${JSON.stringify(tupleMemberCreateShape, null, 6)} },
      inputTuples: { type: 'array', items: ${JSON.stringify(queryInputTupleCreateShape, null, 6)} },
      outputTuples: { type: 'array', items: ${JSON.stringify(queryOutputTupleCreateShape, null, 6)} }
    },
    required: ['queryVersion']${queryVersionExampleSnippet}
  },
  response: {
    201: { type: 'object', additionalProperties: false, properties: {
      queryVersion: { $ref: 'queryversion#' },
      limitParameters: { type: 'array', items: { $ref: 'limitparameter#' } },
      offsetParameters: { type: 'array', items: { $ref: 'offsetparameter#' } },
      inputs: { type: 'array', items: { $ref: 'queryinputvariable#' } },
      outputs: { type: 'array', items: { $ref: 'queryoutputvariable#' } },
      inputTuples: { type: 'array', items: { $ref: 'queryinputtuple#' } },
      outputTuples: { type: 'array', items: { $ref: 'queryoutputtuple#' } },
      inferredOutputs: { type: 'array', items: { type: 'object' } },
      tupleMembers: { type: 'array', items: { $ref: 'tuplemember#' } },
      iriMap: { type: 'object', additionalProperties: { type: 'string' } }
    }, required: ['queryVersion', 'iriMap'] },
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
      inputs: { type: 'array', items: { $ref: 'queryinputvariable#' } },
      outputs: { type: 'array', items: { $ref: 'queryoutputvariable#' } },
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
  summary: 'Annotate a query version (comment only; content is immutable)',
  description:
    'A version is a snapshot: POST mints the next one, PATCH annotates an existing one, and there is no PUT. ' +
    'Writable: \`comment\`, plus \`immutable: true\` to freeze a version stored before freeze-on-create. ' +
    'Everything else — \`queryString\` and what is derived from it — is content and answers 409.',
  params: { type: 'object', properties: { id: { type: 'string', examples: ['urn:example:query:cities-by-population'] }, version: { type: 'string' } }, required: ['id','version'] },
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      queryString: { type: 'string' },
      comment: { type: 'string', nullable: true },
      queryType: { type: 'string', nullable: true },
      defaultBackend: { type: 'string', format: 'iri', nullable: true },
      limitParameters: { type: 'array', nullable: true, items: { type: 'string', format: 'iri' } },
      offsetParameters: { type: 'array', nullable: true, items: { type: 'string', format: 'iri' } },
      inputTuples: { type: 'array', nullable: true, items: { type: 'string', format: 'iri' } },
      outputs: { type: 'array', nullable: true, items: { type: 'string', format: 'iri' } },
      immutable: { type: 'boolean', nullable: true }
    },
    minProperties: 1
  },
  response: {
    200: { type: 'object', additionalProperties: false, properties: {
      queryVersion: { $ref: 'queryversion#' },
      limitParameters: { type: 'array', items: { $ref: 'limitparameter#' } },
      offsetParameters: { type: 'array', items: { $ref: 'offsetparameter#' } },
      inputs: { type: 'array', items: { $ref: 'queryinputvariable#' } },
      outputs: { type: 'array', items: { $ref: 'queryoutputvariable#' } },
      inputTuples: { type: 'array', items: { $ref: 'queryinputtuple#' } },
      outputTuples: { type: 'array', items: { $ref: 'queryoutputtuple#' } },
      inferredOutputs: { type: 'array', items: { type: 'object' } },
      tupleMembers: { type: 'array', items: { $ref: 'tuplemember#' } }
    }, required: ['queryVersion'] },
    400: { type: 'object', properties: { error: { type: 'string' }, fields: { type: 'array', items: { type: 'string' } } } },
    404: { type: 'object', properties: { error: { type: 'string' } } },
    409: { type: 'object', properties: { error: { type: 'string' }, fields: { type: 'array', items: { type: 'string' } } } },
    500: { type: 'object', properties: { error: { type: 'string' } } }
  }
} as const;

// QueryGroup versions
${querygroupversionBodySchema ? `const __createQueryGroupVersionBodySchema = ${JSON.stringify(querygroupversionBodySchema, null, 2)} as const;

export const listQueryGroupVersionsForGroupSchema = {
  tags: ['QueryGroup'],
  summary: 'List versions for a query group',
  params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  response: { 200: { type: 'array', items: { $ref: 'querygroupversion#' } }, 500: { type: 'object', properties: { error: { type: 'string' } } } }
} as const;

export const createQueryGroupVersionForGroupFlatSchema = {
  tags: ['QueryGroup'],
  summary: 'Create new group version',
  params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  body: {
    type: 'object', additionalProperties: false,
    properties: {
      queryGroupVersion: __createQueryGroupVersionBodySchema,
      startNode: { anyOf: [ ${startNodeShape}, { type: 'null' } ] },
      endNode: { anyOf: [ ${endNodeShape}, { type: 'null' } ] },
      executionNodes: { type: 'array', items: { anyOf: [ ${executionNodeCreateAnyOf} ] } },
      edges: { type: 'array', items: ${JSON.stringify(queryEdgeCreateShape, null, 6)} },
      tupleMembers: { type: 'array', items: ${JSON.stringify(tupleMemberCreateShape, null, 6)} },
      inputTuples: { type: 'array', items: ${JSON.stringify(queryInputTupleCreateShape, null, 6)} },
      outputTuples: { type: 'array', items: ${JSON.stringify(queryOutputTupleCreateShape, null, 6)} },
      inputs: { type: 'array', items: ${JSON.stringify(queryInputCreateShape, null, 6)} },
      outputs: { type: 'array', items: ${JSON.stringify(queryOutputCreateShape, null, 6)} },
      rdfOutputs: { type: 'array', items: ${JSON.stringify(rdfOutputCreateShape, null, 6)} }
      ,booleanOutputs: { type: 'array', items: ${JSON.stringify(booleanOutputCreateShape, null, 6)} }
      ,queryIdInputs: { type: 'array', items: ${JSON.stringify(queryIdInputCreateShape, null, 6)} }
    },
    required: ['queryGroupVersion']${queryGroupVersionExampleSnippet}
  },
  response: {
    201: { type: 'object', additionalProperties: false, properties: {
      queryGroupVersion: { $ref: 'querygroupversion#' },
      executionNodes: { type: 'array', items: { anyOf: [ ${executionNodeAnyOf} ] } },
      startNode: { anyOf: [ ${startNodeRef}, { type: 'null' } ] },
      endNode: { anyOf: [ ${endNodeRef}, { type: 'null' } ] },
      edges: { type: 'array', items: { $ref: 'queryedge#' } },
      tupleMembers: { type: 'array', items: { $ref: 'tuplemember#' } },
      inputTuples: { type: 'array', items: { $ref: 'queryinputtuple#' } },
      outputs: { type: 'array', items: { $ref: 'queryoutputvariable#' } },
      outputTuples: { type: 'array', items: { $ref: 'queryoutputtuple#' } },
      inputs: { type: 'array', items: { $ref: 'queryinputvariable#' } },
      rdfOutputs: { type: 'array', items: { $ref: 'triplesquadsio#' } },
      booleanOutputs: { type: 'array', items: { $ref: 'booleanio#' } },
      queryIdInputs: { type: 'array', items: { $ref: 'queryidinput#' } },
      iriMap: { type: 'object', additionalProperties: { type: 'string' } }
    }, required: ['queryGroupVersion', 'iriMap'] },
    404: { type: 'object', properties: { error: { type: 'string' } } },
    // The body is well-formed but names entities that do not exist, or that
    // exist with the wrong type. Every offending reference is listed, so one
    // round trip is enough to fix a hand-written payload.
    422: { type: 'object', properties: {
      error: { type: 'string' },
      references: { type: 'array', items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          field: { type: 'string' },
          reference: { type: 'string' },
          reason: { type: 'string' }
        },
        required: ['field', 'reference', 'reason']
      } }
    } },
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
      executionNodes: { type: 'array', items: { anyOf: [ ${executionNodeAnyOf} ] } },
      startNode: { anyOf: [ ${startNodeRef}, { type: 'null' } ] },
      endNode: { anyOf: [ ${endNodeRef}, { type: 'null' } ] },
      edges: { type: 'array', items: { $ref: 'queryedge#' } },
      queryNodes: { type: 'array', items: { $ref: 'querynode#' } },
      dynamicQueryNodes: { type: 'array', items: { $ref: 'dynamicquerynode#' } },
      startNodes: { type: 'array', items: { $ref: 'startnode#' } },
      endNodes: { type: 'array', items: { $ref: 'endnode#' } },
      tupleMembers: { type: 'array', items: { $ref: 'tuplemember#' } },
      inputTuples: { type: 'array', items: { $ref: 'queryinputtuple#' } },
      outputs: { type: 'array', items: { $ref: 'queryoutputvariable#' } },
      outputTuples: { type: 'array', items: { $ref: 'queryoutputtuple#' } },
      inputs: { type: 'array', items: { $ref: 'queryinputvariable#' } },
      rdfOutputs: { type: 'array', items: { $ref: 'triplesquadsio#' } },
      booleanOutputs: { type: 'array', items: { $ref: 'booleanio#' } },
      queryIdInputs: { type: 'array', items: { $ref: 'queryidinput#' } },
      queryVersions: { type: 'array', items: { $ref: 'queryversion#' } },
      // The LIMIT / OFFSET names this group accepts: the union of what its
      // member queries declare. Named here for the same reason the map below
      // is — \`additionalProperties: false\` drops anything the handler computes
      // and this does not list, so an unlisted field is a feature that silently
      // does nothing.
      limitParameters: { type: 'array', items: { type: 'string' } },
      offsetParameters: { type: 'array', items: { type: 'string' } },
      // Query version IRI -> the name of the query it belongs to. The route
      // computed this and \`additionalProperties: false\` dropped it on the way
      // out, so the canvas had no source for query names and fell back to the
      // literal label "Query Node" (issue #49).
      //
      // Not the same map the create route returns under this key: there it is
      // temp-urn -> minted IRI, so those values are URIs and these are display
      // names. Hence plain \`type: 'string'\` and no \`format: 'uri'\`.
      //
      // Not required, unlike on create: the handler falls back to the
      // un-enriched \`detailed\` payload if \`expandGroupVersionDetailed\` throws,
      // and that one carries no iriMap. Requiring it would turn that fallback
      // into a serialization failure.
      iriMap: { type: 'object', additionalProperties: { type: 'string' } }
    }, required: ['queryGroupVersion'] },
    404: { type: 'object', properties: { error: { type: 'string' } } },
    500: { type: 'object', properties: { error: { type: 'string' } } }
  }
} as const;

export const patchQueryGroupVersionForGroupSchema = {
  tags: ['QueryGroup'],
  summary: 'Annotate a group version (comment only; content is immutable)',
  description:
    'A version is a snapshot: POST mints the next one, PATCH annotates an existing one, and there is no PUT. ' +
    'Writable: \`comment\`, plus \`immutable: true\` to freeze a version stored before freeze-on-create. ' +
    'Everything else — including \`canvasData\` — is content and answers 409.',
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
      executionNodes: { type: 'array', items: { anyOf: [ ${executionNodeAnyOf} ] } },
      startNode: { anyOf: [ ${startNodeRef}, { type: 'null' } ] },
      endNode: { anyOf: [ ${endNodeRef}, { type: 'null' } ] },
      edges: { type: 'array', items: { $ref: 'queryedge#' } },
      queryNodes: { type: 'array', items: { $ref: 'querynode#' } },
      dynamicQueryNodes: { type: 'array', items: { $ref: 'dynamicquerynode#' } },
      startNodes: { type: 'array', items: { $ref: 'startnode#' } },
      endNodes: { type: 'array', items: { $ref: 'endnode#' } },
      tupleMembers: { type: 'array', items: { $ref: 'tuplemember#' } },
      inputTuples: { type: 'array', items: { $ref: 'queryinputtuple#' } },
      outputs: { type: 'array', items: { $ref: 'queryoutputvariable#' } },
      outputTuples: { type: 'array', items: { $ref: 'queryoutputtuple#' } },
      inputs: { type: 'array', items: { $ref: 'queryinputvariable#' } },
      rdfOutputs: { type: 'array', items: { $ref: 'triplesquadsio#' } },
      queryVersions: { type: 'array', items: { $ref: 'queryversion#' } }
    }, required: ['queryGroupVersion'] },
    400: { type: 'object', properties: { error: { type: 'string' }, fields: { type: 'array', items: { type: 'string' } } } },
    404: { type: 'object', properties: { error: { type: 'string' } } },
    409: { type: 'object', properties: { error: { type: 'string' }, fields: { type: 'array', items: { type: 'string' } } } },
    412: { type: 'object', additionalProperties: true, properties: { error: { type: 'string' }, expected: { type: 'string' } } },
    500: { type: 'object', properties: { error: { type: 'string' } } }
  }
} as const;` : '// No QueryGroupVersion schema found'}
`;
}
