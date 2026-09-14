/**
 * Phase 2 graph-construction harness.
 *
 * Both Phase 2 layers - the deterministic legality matrix and the fast-check
 * graph fuzzer - need the same thing: turn a compact description of a DAG into a
 * real query group version through the real API, then validate and execute it.
 * Doing that inline (as the numbered scenario tests do) costs ~150 lines per
 * graph, which is fine for a handful of hand-written scenarios and impossible
 * for a few hundred generated ones.
 *
 * The harness deliberately does NOT sanitise the spec it is given. The legality
 * matrix's whole job is to build illegal wirings - a VARIABLE_BINDINGS edge from
 * an RDF port, a QUERY_ID edge into a plain QueryNode - and watch the validator
 * reject them. Anything the harness "helpfully" fixed up would be a combination
 * the matrix silently stopped covering.
 *
 * See `docs/guides/query-groups.md`.
 */
import type { FastifyInstance } from 'fastify';
import { oxigraphStoreManager } from '../../../src/lib/OxigraphStoreManager.js';
import { OxigraphSparqlExecutor } from '../../../src/server/OxigraphSparqlExecutor.js';
import { ScenarioTestBaseUnmocked, type ScenarioTestContext } from '../../scenarios/fixtures/scenario-test-base-unmocked.js';

export type FlowType = 'CONTROL_FLOW' | 'VARIABLE_BINDINGS' | 'RDF_GRAPH' | 'BOOLEAN' | 'QUERY_ID';
export type NodeKind = 'QueryNode' | 'DynamicQueryNode' | 'RuleSetNode';
export type WhenEmpty = 'unconstrained' | 'propagateEmpty' | 'require';

export const START = 'START' as const;
export const END = 'END' as const;

/** A query version created for the harness, with its inferred ports classified. */
export interface QueryHandle {
  key: string;
  queryId: string;
  versionId: string;
  queryString: string;
  /** Inferred QueryInputTuples, one per VALUES parameter slot, in detection order. */
  inputTuples: string[];
  /** The auto "All query outputs" tuple, present for SELECT. */
  outputTuple?: string;
  /** The auto RDF port, present for CONSTRUCT/DESCRIBE. */
  rdfOutput?: string;
  /** The auto boolean port, present for ASK. */
  booleanOutput?: string;
}

/**
 * How an edge end names its port. `node`/`declared` cover the legal shapes;
 * `literal` is the escape hatch mutations use to point an edge at a dangling or
 * wrong-typed IRI.
 */
export type PortRef =
  | { node: string; port: 'outputTuple' | 'rdf' | 'boolean' }
  | { node: string; input: number }
  | { declared: string }
  | { literal: string };

/** An IO entity the spec creates itself, rather than inheriting from a query version. */
export interface DeclaredPort {
  key: string;
  type: 'TriplesQuadsIO' | 'BooleanIO' | 'QueryIdInput' | 'QueryInputTuple' | 'QueryOutputTuple';
  /** Variable names, in tuple member order. Tuples only. */
  vars?: string[];
  /** Node (or START/END) that declares this port, and on which side. */
  attachTo?: string;
  attachAs?: 'inputs' | 'outputs';
}

export interface NodeSpec {
  key: string;
  /** Key of a query registered with `defineQuery`. Omitted for RuleSetNode. */
  query?: string;
  kind?: NodeKind;
  /** Key of a rule set registered with `defineRuleSet`. RuleSetNode only. */
  ruleSet?: string;
  /** Raw override, for pointing a RuleSetNode at a missing RuleSetVersion. */
  ruleSetVersionId?: string;
  /** Overrides the harness backend, e.g. to point a node at a missing backend. */
  backendId?: string | null;
}

export interface EdgeSpec {
  from: string;
  to: string;
  flow: FlowType;
  source?: PortRef;
  target?: PortRef;
  whenEmpty?: WhenEmpty;
  /**
   * Explicit source->target variable pairing, as the JSON string the edge
   * persists. Passed through verbatim, including deliberately malformed values:
   * the engine's fallback behaviour is part of what gets tested.
   */
  variableMappings?: string;
  /** Overrides the generated edge id, so a mutation can collide two ids. */
  id?: string;
}

export interface GraphSpec {
  nodes: NodeSpec[];
  edges: EdgeSpec[];
  declaredPorts?: DeclaredPort[];
  endNodeMediaType?: string;
}

export interface BuiltGroup {
  groupId: string;
  versionId: string;
  version: number;
  /** Temp URN -> minted IRI, as returned by the flat create endpoint. */
  iriMap: Record<string, string>;
  /** Node key -> minted node IRI. START/END included. */
  nodeIris: Record<string, string>;
  /** Edge id (temp URN) -> minted edge IRI. */
  edgeIris: Record<string, string>;
  /** Declared port key -> minted IRI. */
  portIris: Record<string, string>;
  spec: GraphSpec;
}

export interface ValidationIssue {
  level: 'error' | 'warning';
  message: string;
  entityType?: string;
  entityId?: string | null;
  code?: string | null;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  issues: ValidationIssue[];
}

export interface ExecuteOptions {
  /** Execute the QueryGroupVersion directly instead of the QueryGroup. */
  target?: 'group' | 'version';
  arguments?: unknown[];
  argumentSetIds?: string[];
  nodeDetail?: 'timings' | 'results';
  accept?: string;
}

/** Response shape from `app.inject`, narrowed to what the harness uses. */
export interface InjectedResponse {
  statusCode: number;
  payload: string;
  headers: Record<string, unknown>;
  json: () => any;
}

const TEMP = 'urn:ui-temp:';

/** Classify an inferred output IRI by its minting prefix. */
const portKindOf = (iri: string): 'outputTuple' | 'rdf' | 'boolean' | 'other' => {
  if (iri.startsWith('urn:sqlib:output-tuple:')) return 'outputTuple';
  if (iri.startsWith('urn:sqlib:triples-quads-io:')) return 'rdf';
  if (iri.startsWith('urn:sqlib:boolean-io:')) return 'boolean';
  return 'other';
};

export class GroupHarness {
  private queries = new Map<string, QueryHandle>();
  private ruleSets = new Map<string, string>();
  private groupCounter = 0;

  private constructor(
    readonly context: ScenarioTestContext,
    readonly app: FastifyInstance,
  ) {}

  static async create(scenarioName: string, dataFile = 'phase2-graph.ttl'): Promise<GroupHarness> {
    const context = await ScenarioTestBaseUnmocked.createTestContext(scenarioName);
    await ScenarioTestBaseUnmocked.loadTurtleDataIntoBackend(context, dataFile);
    await ScenarioTestBaseUnmocked.createOxigraphBackend(context, `${scenarioName} backend`);
    await ScenarioTestBaseUnmocked.createLibrary(context, `${scenarioName} library`);
    return new GroupHarness(context, context.app);
  }

  async destroy(): Promise<void> {
    await ScenarioTestBaseUnmocked.cleanupTestContext(this.context);
  }

  get backendId(): string {
    return this.context.backendId;
  }

  /**
   * A bare executor over the same store the group's nodes query. The reference
   * interpreter uses it to dispatch the SPARQL it built itself: sending a string
   * to Oxigraph is transport, and sharing transport with the engine is not the
   * same as sharing its semantics.
   */
  rawExecutor(): OxigraphSparqlExecutor {
    const store = oxigraphStoreManager.getEphemeralStore(this.context.backendId);
    if (!store) throw new Error(`No store for backend ${this.context.backendId}`);
    return new OxigraphSparqlExecutor(store);
  }

  /**
   * Register a query. Queries are content-addressed by key so a fuzz run that
   * reuses a template across dozens of graphs pays for it once.
   */
  async defineQuery(key: string, queryString: string): Promise<QueryHandle> {
    const existing = this.queries.get(key);
    if (existing) return existing;

    const query = await this.app.inject({
      method: 'POST',
      url: '/queries/',
      payload: { name: `phase2-${key}`, isPartOf: [this.context.libraryId] },
    });
    if (query.statusCode !== 201) {
      throw new Error(`Failed to create query ${key}: ${query.statusCode} ${query.payload}`);
    }
    const queryId = query.json().id as string;

    const version = await this.app.inject({
      method: 'POST',
      url: `/queries/${encodeURIComponent(queryId)}/v`,
      payload: { queryVersion: { queryString } },
    });
    if (version.statusCode !== 201) {
      throw new Error(`Failed to create version for ${key}: ${version.statusCode} ${version.payload}`);
    }
    const qv = version.json().queryVersion;
    const inferredOutputs: string[] = qv.inferredOutputs || [];

    const handle: QueryHandle = {
      key,
      queryId,
      versionId: qv.id,
      queryString,
      inputTuples: qv.inferredInputs || [],
      outputTuple: inferredOutputs.find(id => portKindOf(id) === 'outputTuple'),
      rdfOutput: inferredOutputs.find(id => portKindOf(id) === 'rdf'),
      booleanOutput: inferredOutputs.find(id => portKindOf(id) === 'boolean'),
    };
    this.queries.set(key, handle);
    return handle;
  }

  queryHandle(key: string): QueryHandle {
    const handle = this.queries.get(key);
    if (!handle) throw new Error(`Query ${key} was never defined on this harness`);
    return handle;
  }

  /**
   * Create a real RuleSetVersion so a RuleSetNode can actually run. `rules` are
   * SRL rule bodies; an empty list gives an identity ruleset, which is still a
   * useful pass-through for RDF flow tests.
   */
  async defineRuleSet(key: string, rules: string[] = []): Promise<string> {
    const existing = this.ruleSets.get(key);
    if (existing) return existing;

    const ruleVersionIds: string[] = [];
    for (const [index, ruleString] of rules.entries()) {
      const rule = await this.app.inject({
        method: 'POST',
        url: '/rules/',
        payload: { name: `phase2-rule-${key}-${index}`, isPartOf: [this.context.libraryId] },
      });
      if (rule.statusCode !== 201) {
        throw new Error(`Failed to create rule ${key}-${index}: ${rule.statusCode} ${rule.payload}`);
      }
      const version = await this.app.inject({
        method: 'POST',
        url: `/rules/${encodeURIComponent(rule.json().id)}/versions`,
        payload: { ruleString },
      });
      if (version.statusCode !== 201) {
        throw new Error(`Failed to create rule version ${key}-${index}: ${version.statusCode} ${version.payload}`);
      }
      ruleVersionIds.push(version.json().id);
    }

    const ruleSet = await this.app.inject({
      method: 'POST',
      url: '/rule-sets/',
      payload: { name: `phase2-ruleset-${key}`, isPartOf: this.context.libraryId },
    });
    if (ruleSet.statusCode !== 201) {
      throw new Error(`Failed to create rule set ${key}: ${ruleSet.statusCode} ${ruleSet.payload}`);
    }
    const versionResponse = await this.app.inject({
      method: 'POST',
      url: `/rule-sets/${encodeURIComponent(ruleSet.json().id)}/versions`,
      payload: { hasRule: ruleVersionIds },
    });
    if (versionResponse.statusCode !== 201) {
      throw new Error(`Failed to create rule set version ${key}: ${versionResponse.statusCode} ${versionResponse.payload}`);
    }
    const versionId = versionResponse.json().ruleSetVersion.id as string;
    this.ruleSets.set(key, versionId);
    return versionId;
  }

  ruleSetVersionId(key: string): string {
    const found = this.ruleSets.get(key);
    if (!found) throw new Error(`RuleSet ${key} was never defined on this harness`);
    return found;
  }

  /**
   * Build the flat POST body for a spec. Exposed separately from `build` so the
   * round-trip and mutation tests can tamper with the payload before it is sent.
   */
  buildPayload(spec: GraphSpec): Record<string, unknown> {
    const nodeTempId = (key: string) => {
      if (key === START) return 'urn:__START__';
      if (key === END) return 'urn:__END__';
      return `${TEMP}node-${key}`;
    };

    const declared = spec.declaredPorts || [];
    const declaredById = new Map(declared.map(port => [port.key, port]));
    const portTempId = (key: string) => `${TEMP}port-${key}`;

    const resolvePort = (ref: PortRef | undefined): string | undefined => {
      if (!ref) return undefined;
      if ('literal' in ref) return ref.literal;
      if ('declared' in ref) {
        if (!declaredById.has(ref.declared)) {
          throw new Error(`Edge references undeclared port ${ref.declared}`);
        }
        return portTempId(ref.declared);
      }
      const nodeSpec = spec.nodes.find(n => n.key === ref.node);
      if (!nodeSpec?.query) {
        throw new Error(`Port reference targets node ${ref.node}, which has no query`);
      }
      const handle = this.queryHandle(nodeSpec.query);
      if ('input' in ref) {
        const tuple = handle.inputTuples[ref.input];
        if (!tuple) {
          throw new Error(`Query ${handle.key} has no input tuple at index ${ref.input}`);
        }
        return tuple;
      }
      const resolved = ref.port === 'outputTuple' ? handle.outputTuple
        : ref.port === 'rdf' ? handle.rdfOutput
        : handle.booleanOutput;
      if (!resolved) {
        throw new Error(`Query ${handle.key} has no ${ref.port} port`);
      }
      return resolved;
    };

    // Declared IO entities, bucketed into the payload arrays the writer reads.
    const inputs: Record<string, unknown>[] = [];
    const outputs: Record<string, unknown>[] = [];
    const tupleMembers: Record<string, unknown>[] = [];
    const inputTuples: Record<string, unknown>[] = [];
    const outputTuples: Record<string, unknown>[] = [];
    const rdfOutputs: Record<string, unknown>[] = [];
    const booleanOutputs: Record<string, unknown>[] = [];
    const queryIdInputs: Record<string, unknown>[] = [];

    for (const port of declared) {
      const id = portTempId(port.key);
      if (port.type === 'TriplesQuadsIO') {
        rdfOutputs.push({ id, name: port.key, ioType: 'output', outputType: 'RDFGraph', triplesOrQuads: 'triples' });
        continue;
      }
      if (port.type === 'BooleanIO') {
        booleanOutputs.push({ id, name: port.key, ioType: 'output', outputType: 'Boolean' });
        continue;
      }
      if (port.type === 'QueryIdInput') {
        queryIdInputs.push({ id, name: port.key });
        continue;
      }
      const vars = port.vars || [];
      const memberIds = vars.map((_, index) => `${TEMP}member-${port.key}-${index}`);
      vars.forEach((variableName, index) => {
        const variableId = `${TEMP}var-${port.key}-${index}`;
        if (port.type === 'QueryInputTuple') {
          inputs.push({ id: variableId, variableName });
        } else {
          outputs.push({ id: variableId, variableName });
        }
        tupleMembers.push({ id: memberIds[index], position: index, variable: variableId });
      });
      const tuple = { id, name: port.key, memberEntries: memberIds };
      if (port.type === 'QueryInputTuple') inputTuples.push(tuple);
      else outputTuples.push(tuple);
    }

    // Ports a node declares beyond whatever its query version inferred.
    const attachedInputs = new Map<string, string[]>();
    const attachedOutputs = new Map<string, string[]>();
    for (const port of declared) {
      if (!port.attachTo) continue;
      const bucket = port.attachAs === 'outputs' ? attachedOutputs : attachedInputs;
      const list = bucket.get(port.attachTo) || [];
      list.push(portTempId(port.key));
      bucket.set(port.attachTo, list);
    }

    const executionNodes = spec.nodes.map(node => {
      const kind = node.kind || 'QueryNode';
      const base: Record<string, unknown> = { id: nodeTempId(node.key), nodeType: kind };
      const extraInputs = attachedInputs.get(node.key) || [];
      const extraOutputs = attachedOutputs.get(node.key) || [];

      if (kind === 'RuleSetNode') {
        base.ruleSetVersion = node.ruleSetVersionId ?? this.ruleSetVersionId(node.ruleSet!);
        if (extraInputs.length) base.inputs = extraInputs;
        if (extraOutputs.length) base.outputs = extraOutputs;
        return base;
      }

      const handle = this.queryHandle(node.query!);
      base.queryId = handle.versionId;
      if (node.backendId !== null) base.backendId = node.backendId ?? this.backendId;
      // The writer merges the query version's inferred ports in for us, so only
      // the spec's own additions need listing.
      if (extraInputs.length) base.inputs = extraInputs;
      if (extraOutputs.length) base.outputs = extraOutputs;
      return base;
    });

    const edges = spec.edges.map((edge, index) => {
      const payload: Record<string, unknown> = {
        id: edge.id ?? `${TEMP}edge-${index}-${edge.from}-${edge.to}`,
        sourceNodeId: nodeTempId(edge.from),
        targetNodeId: nodeTempId(edge.to),
        dataFlowType: edge.flow,
      };
      const source = resolvePort(edge.source);
      const target = resolvePort(edge.target);
      if (source) payload.sourceOutputId = source;
      if (target) payload.targetInputId = target;
      if (edge.whenEmpty) payload.whenEmpty = edge.whenEmpty;
      if (edge.variableMappings !== undefined) payload.variableMappings = edge.variableMappings;
      return payload;
    });

    const startOutputs = attachedOutputs.get(START) || [];

    const body: Record<string, unknown> = {
      queryGroupVersion: {},
      endNode: { mediaType: spec.endNodeMediaType ?? 'application/sparql-results+json' },
      executionNodes,
      edges,
    };
    if (startOutputs.length) body.startNode = { outputs: startOutputs };
    if (tupleMembers.length) body.tupleMembers = tupleMembers;
    if (inputs.length) body.inputs = inputs;
    if (outputs.length) body.outputs = outputs;
    if (inputTuples.length) body.inputTuples = inputTuples;
    if (outputTuples.length) body.outputTuples = outputTuples;
    if (rdfOutputs.length) body.rdfOutputs = rdfOutputs;
    if (booleanOutputs.length) body.booleanOutputs = booleanOutputs;
    if (queryIdInputs.length) body.queryIdInputs = queryIdInputs;
    return body;
  }

  /** Create the group and POST the version. Throws if creation is rejected. */
  async build(spec: GraphSpec, name?: string): Promise<BuiltGroup> {
    const { built, response } = await this.tryBuild(spec, name);
    if (!built) {
      throw new Error(`Failed to create group version: ${response.statusCode} ${response.payload}`);
    }
    return built;
  }

  /**
   * Create the group and POST the version, surfacing a rejection instead of
   * throwing. Some illegal wirings are refused by the writer or the route schema
   * rather than by GraphBuilder, and the matrix has to be able to see that.
   */
  async tryBuild(spec: GraphSpec, name?: string): Promise<{ built: BuiltGroup | null; response: InjectedResponse }> {
    const groupName = name ?? `phase2-group-${this.groupCounter++}`;
    const group = await this.app.inject({
      method: 'POST',
      url: '/query-groups/',
      payload: { name: groupName, isPartOf: this.context.libraryId },
    });
    if (group.statusCode !== 201) {
      throw new Error(`Failed to create group: ${group.statusCode} ${group.payload}`);
    }
    const groupId = group.json().id as string;

    const response = await this.app.inject({
      method: 'POST',
      url: `/query-groups/${encodeURIComponent(groupId)}/v`,
      payload: this.buildPayload(spec),
    }) as unknown as InjectedResponse;

    if (response.statusCode !== 201) {
      return { built: null, response };
    }

    const body = response.json();
    const iriMap: Record<string, string> = body.iriMap || {};
    const nodeIris: Record<string, string> = {};
    for (const node of spec.nodes) {
      nodeIris[node.key] = iriMap[`${TEMP}node-${node.key}`];
    }
    nodeIris[START] = iriMap['urn:__START__'];
    nodeIris[END] = iriMap['urn:__END__'];

    const edgeIris: Record<string, string> = {};
    spec.edges.forEach((edge, index) => {
      const tempId = edge.id ?? `${TEMP}edge-${index}-${edge.from}-${edge.to}`;
      edgeIris[tempId] = iriMap[tempId];
    });

    const portIris: Record<string, string> = {};
    for (const port of spec.declaredPorts || []) {
      portIris[port.key] = iriMap[`${TEMP}port-${port.key}`];
    }

    return {
      built: {
        groupId,
        versionId: body.queryGroupVersion.id,
        version: Number(body.queryGroupVersion.version),
        iriMap,
        nodeIris,
        edgeIris,
        portIris,
        spec,
      },
      response,
    };
  }

  async validate(built: BuiltGroup): Promise<ValidationResult> {
    const response = await this.app.inject({
      method: 'GET',
      url: `/query-groups/${encodeURIComponent(built.groupId)}/v/${built.version}/validate`,
    });
    if (response.statusCode !== 200) {
      throw new Error(`Validate failed: ${response.statusCode} ${response.payload}`);
    }
    return response.json() as ValidationResult;
  }

  async execute(built: BuiltGroup, options: ExecuteOptions = {}): Promise<InjectedResponse> {
    const payload: Record<string, unknown> = {
      targetId: options.target === 'version' ? built.versionId : built.groupId,
    };
    if (options.arguments) payload.arguments = options.arguments;
    if (options.argumentSetIds) payload.argumentSetIds = options.argumentSetIds;
    if (options.nodeDetail) payload.nodeDetail = options.nodeDetail;

    return await this.app.inject({
      method: 'POST',
      url: '/execute/',
      headers: { accept: options.accept ?? 'application/sparql-results+json' },
      payload,
    }) as unknown as InjectedResponse;
  }
}
