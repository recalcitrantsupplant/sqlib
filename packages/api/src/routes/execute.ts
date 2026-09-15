import {FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest} from 'fastify';
import {backendTypeIriToKey, type LdkitBackend} from '../persistence/schemas/BackendSchema.js';
import { toError } from '../lib/toError.js';
import type {LdkitQuery} from '../persistence/schemas/QuerySchema.js';
import type {LdkitQueryVersion} from '../persistence/schemas/QueryVersionSchema.js';
import {ISparqlExecutor, SparqlExecutionResult, SparqlSelectJsonOutput} from '../server/ISparqlExecutor.js';
import {SparqlQueryParser} from '../lib/parser.js';
import { getCacheCoordinator } from '../lib/CacheCoordinatorProvider.js';
import {handleSparqlExecutionError} from '../lib/error-handler.js';
import {detectSparqlOperation, type SparqlOperation} from '../lib/queryTypeDetector.js';
import { QueryTypeIri } from '../constants/queryTypes.js';
import { getQueryTypeKeyFromIri, isQueryTypeIri, toQueryTypeIri } from '../lib/queryTypes.js';
import * as fs from 'fs';
import * as path from 'path';
import {meter} from '../lib/logger.js';
import {ValueType} from '@opentelemetry/api';
import {OUTPUT_MEDIA_TYPE_VALUES, PATCH_MEDIA_TYPES} from '../types/media-types.js';
import {previewUpdate, PatchTargetError, toRdfPatchDocument} from '../lib/patchService.js';
import {UnsupportedUpdateError} from '@sparql-query-lib/rdf-delta';
import {
    type ExecutionRequest,
    type ExecutionQuerystring,
    type ExecutionDataGraph,
} from '@sparql-query-lib/contracts';
import { executionRouteSchemas } from '@sparql-query-lib/contracts/schema/routes';
import {
    EPHEMERAL_BACKEND_ID,
    LIBRARY_STORAGE_BACKEND_ID,
    describeParameterKey,
    graphParameterKey,
    scalarParameterKey,
    tableParameterKey,
} from '@sparql-query-lib/types';
import { oxigraphStoreManager } from '../lib/OxigraphStoreManager.js';
import { OxigraphSparqlExecutor } from '../server/OxigraphSparqlExecutor.js';
import { ExecutorFactory } from '../lib/orchestration/ExecutorFactory.js';
import { requireLibraryMode, resolveOwningLibrary } from '../auth/enforce.js';
import type { NodeResult, ResolvedNode } from '../lib/orchestration/types.js';
import * as crypto from 'crypto';
import { ArgumentSetService } from '../lib/ArgumentSetService.js';
import { QueryGroupSignatureService } from '../lib/QueryGroupSignatureService.js';
import { applyExecutionArguments, normalizeUndefBindings } from '../lib/executionArguments.js';
import type { RuntimeArgumentPayload } from '../lib/ArgumentSetService.js';
import { resolveDataGraphInput, DataGraphContentError } from '../lib/dataGraphInput.js';
import type { ExecutionDataGraphInput } from '../lib/orchestration/ExecutionEngine.js';
import type { ArgumentSet as RuntimeArgumentSet } from '../lib/query-chaining.js';

// Alternative to import.meta for ES module compatibility
const __dirname = path.dirname(new URL(import.meta.url).pathname);

// Load execution examples from JSON files
function loadExecutionExample(filename: string): any | undefined {
    try {
        const examplePath = path.join(__dirname, '../../examples/workflows/basic-workflow', filename);
        if (fs.existsSync(examplePath)) {
            const content = fs.readFileSync(examplePath, 'utf8');
            return JSON.parse(content);
        }
    } catch (error) {
        console.warn(`Failed to load execution example from ${filename}:`, error);
    }
    return undefined;
}

const queryVersionExecutionExample = loadExecutionExample('04a-execute-query-version.json');
const queryGroupExecutionExample = loadExecutionExample('07-execute-query-group.json');
// --- Define Metrics ---
const queryExecutionCounter = meter.createCounter('query.execution.count', {
    description: 'Counts the number of SPARQL query executions',
});
const queryExecutionDuration = meter.createHistogram('query.execution.duration', {
    description: 'Measures the duration of SPARQL query executions',
    unit: 'ms', // Milliseconds
    valueType: ValueType.DOUBLE,
});

const argumentSetService = new ArgumentSetService();
const groupSignatureService = new QueryGroupSignatureService();
const cacheCoordinator = getCacheCoordinator();
/*
 * One spelling, shared with the service and the client.
 *
 * There were two here — one sorted, one not — and the map this route builds was
 * keyed with the unsorted one while validation used the sorted one. A set whose
 * variables were written in a different order from its clause therefore passed
 * validation and then missed the map lookup, and its rows were silently
 * dropped. See `packages/types/src/parameterKeys.ts`.
 */
const normalizedSignatureFromVars = (vars: string[]): string => tableParameterKey(vars);

type NodeDetail = {
    nodeId: string;
    status: 'pending' | 'running' | 'ok' | 'failed';
    durationMs?: number;
    rowCount?: number;
    tripleCount?: number;
    result?: NodeResult;
    error?: string;
};

function summarizeNodeResult(result: NodeResult): Pick<NodeDetail, 'rowCount' | 'tripleCount'> {
    if (typeof result === 'string') {
        return { tripleCount: result.trim() ? result.trim().split('\n').length : 0 };
    }
    if (result && typeof result === 'object' && 'results' in result) {
        return { rowCount: result.results.bindings.length };
    }
    return {};
}

function truncateNodeResult(result: NodeResult): NodeResult {
    if (result && typeof result === 'object' && 'results' in result) {
        return { ...result, results: { ...result.results, bindings: result.results.bindings.slice(0, 100) } };
    }
    if (typeof result === 'string') return result.slice(0, 100_000);
    return result;
}

function buildNodeDetailHooks(mode: 'timings' | 'results' | undefined) {
    const details: NodeDetail[] = [];
    const byId = new Map<string, NodeDetail>();
    if (!mode) return { details, hooks: undefined };
    return {
        details,
        hooks: {
            onNodeStart: (node: ResolvedNode) => {
                const detail: NodeDetail = { nodeId: node.id, status: 'running' };
                details.push(detail);
                byId.set(node.id, detail);
            },
            onNodeFinish: (node: ResolvedNode, result: NodeResult, durationMs: number) => {
                const detail = byId.get(node.id) ?? { nodeId: node.id, status: 'running' as const };
                Object.assign(detail, { status: 'ok', durationMs, ...summarizeNodeResult(result) });
                if (mode === 'results') detail.result = truncateNodeResult(result);
                if (!byId.has(node.id)) details.push(detail);
            },
            onNodeError: (node: ResolvedNode, error: Error, durationMs: number) => {
                const detail = byId.get(node.id) ?? { nodeId: node.id, status: 'running' as const };
                Object.assign(detail, { status: 'failed', durationMs, error: error.message });
                if (!byId.has(node.id)) details.push(detail);
            },
        },
    };
}

/**
 * Whether this run is asking for the update's diff rather than its effect.
 *
 * `text/rdf-patch` is the one output media type an update query has (#290), and
 * asking for it is what turns an execution into a derivation. It has to be
 * asked for explicitly: an update with no Accept header still runs, because
 * `/execute` is what a scheduled job, an MCP tool or a query group calls, and
 * silently turning every one of those into a dry run would be a far worse
 * surprise than having to name the format you want.
 */
/** Who is asking, as the patch log and the change feed spell it. */
const clientIdOf = (request: FastifyRequest): string | null => {
    const header = request.headers['x-sqlib-client-id'];
    return typeof header === 'string' && header.length > 0 ? header : null;
};

const wantsRdfPatch = (acceptHeader?: string | null): boolean =>
    !!acceptHeader && acceptHeader.toLowerCase().includes(PATCH_MEDIA_TYPES.RDF_PATCH);

const resolveRdfMediaTypeFromAccept = (acceptHeader?: string | null): string | undefined => {
    if (!acceptHeader || acceptHeader === '*/*') {
        return undefined;
    }
    const lower = acceptHeader.toLowerCase();
    for (const mediaType of OUTPUT_MEDIA_TYPE_VALUES) {
        if (lower.includes(mediaType)) {
            return mediaType;
        }
    }
    if (lower.includes('turtle')) return 'text/turtle';
    if (lower.includes('n-triples')) return 'application/n-triples';
    if (lower.includes('n-quads')) return 'application/n-quads';
    if (lower.includes('rdf+xml')) return 'application/rdf+xml';
    if (lower.includes('json-ld')) return 'application/ld+json';
    if (lower.includes('trig')) return 'application/trig';
    return undefined;
};

const resolvePreferredRdfMediaType = (acceptHeader?: string | null, fallback?: string | null): string | undefined => {
    const fromAccept = resolveRdfMediaTypeFromAccept(acceptHeader);
    if (fromAccept) return fromAccept;
    if (fallback && (OUTPUT_MEDIA_TYPE_VALUES as readonly string[]).includes(fallback)) {
        return fallback;
    }
    return undefined;
};

/**
 * The media type of the result *inside* a nodeDetail envelope.
 *
 * Without nodeDetail this is the reply's own Content-Type, set from the same
 * three cases below. With it the reply is `application/json` — the envelope's —
 * so a CONSTRUCT's N-Triples string would otherwise arrive as a bare string with
 * nothing saying what it is, and a client can only guess.
 */
const resultContentTypeFor = (result: unknown, preferredRdfMediaType?: string | null): string =>
    typeof result === 'string'
        ? (preferredRdfMediaType || 'application/n-triples')
        : 'application/sparql-results+json';

function validateArgumentPayloadAgainstInputs(
    detected: ReturnType<SparqlQueryParser['detectInputs']>,
    runtimePayload: RuntimeArgumentPayload
): string | null {
    const allowedTupleSignatures = new Set(detected.valuesInputs.map(group => normalizedSignatureFromVars(group)));
    const allowedLimitNames = new Set(detected.limitParameters);
    const allowedOffsetNames = new Set(detected.offsetParameters);

    for (const argSet of runtimePayload.tupleList) {
        const headVars = Array.isArray(argSet.head?.vars) ? argSet.head.vars : [];
        const signature = normalizedSignatureFromVars(headVars);
        if (!allowedTupleSignatures.has(signature)) {
            return `Argument set variables [${headVars.join(', ')}] do not match any VALUES clause in the target`;
        }
    }

    for (const limit of runtimePayload.limits) {
        if (!allowedLimitNames.has(limit.name)) {
            return `Limit parameter '${limit.name}' does not match any LIMIT placeholder in the target`;
        }
    }

    for (const offset of runtimePayload.offsets) {
        if (!allowedOffsetNames.has(offset.name)) {
            return `Offset parameter '${offset.name}' does not match any OFFSET placeholder in the target`;
        }
    }

    return null;
}

// --- Helper Type Guards ---
function isQuery(thing: unknown): thing is LdkitQuery {
    return !!thing && (thing as { '@type'?: unknown })['@type'] === 'Query';
}

function isQueryVersion(thing: unknown): thing is LdkitQueryVersion {
    return !!thing && (thing as { '@type'?: unknown })['@type'] === 'QueryVersion';
}

function isBackend(thing: unknown): thing is LdkitBackend {
    return !!thing && Boolean((thing as { $id?: unknown }).$id);
}

// --- Using inline schemas (no external imports) ---


// --- Plugin ---

export default async function (
    fastify: FastifyInstance,
    options: FastifyPluginOptions
) {
    // Schemas are expected to be added globally in index.ts or similar
    // No need to add errorMessageSchema or other dependent schemas here

    const parser = new SparqlQueryParser();
    // No plugin-scoped factory: executors are built per request from the
    // caller's scope, so there is no unscoped instance to reach for by mistake.

    // Define a more specific reply type if possible, though results vary by query type
    // Import SparqlSelectJsonOutput if not already imported
    // import { SparqlSelectJsonOutput } from '../server/ISparqlExecutor'; // Assuming it's exported there
    type ExecuteReply = SparqlSelectJsonOutput | string | { error: string } | { boolean: boolean } | any; // Allow flexibility

    // Shared execution logic function
    async function executeQuery(
        request: FastifyRequest,
        reply: FastifyReply,
        params: {
            targetId: string;
            backendId?: string;
            arguments?: any[];
            limits?: any;
            offsets?: any;
            argumentSetIds?: string[];
            dataGraphs?: ExecutionDataGraph[];
            nodeDetail?: 'timings' | 'results';
            acceptOverride?: string;
        }
    ) {
        const {targetId, backendId, arguments: rawInlineArgs, limits, offsets, argumentSetIds, dataGraphs, nodeDetail, acceptOverride} = params;
        const inlineArgs = normalizeUndefBindings(rawInlineArgs);
        let executionStatus: 'success' | 'failure' = 'failure'; // Default to failure
        let backendTypeAttr: string | undefined = undefined; // To store backend type for metrics
        const startTime = performance.now(); // Start timing
        let dbDuration = 0;
        let nodeExecutionDetails: NodeDetail[] = [];
        const setTimingHeader = (): number => {
            const duration = performance.now() - startTime;
            const appDuration = duration - dbDuration;
            const nodeEntries = nodeExecutionDetails
                .filter(detail => detail.durationMs !== undefined)
                .map((detail, index) => `node${index};dur=${detail.durationMs!.toFixed(2)};desc="${detail.nodeId.replace(/["\\]/g, '')}"`);
            reply.header('Server-Timing', [
                `db;dur=${dbDuration.toFixed(2)}`,
                `app;dur=${appDuration.toFixed(2)}`,
                ...nodeEntries,
            ].join(', '));
            return duration;
        };
        let targetTypeForError: string | undefined;
        let ephemeralStoreId: string | null = null; // Track ephemeral store for cleanup

        try {
            // 1. Fetch the target query/group using MEMORY CACHE (no SPARQL queries!)
            const targetCacheEntity = cacheCoordinator.get(targetId);

            // Use cache entities directly as LDKit format
            let targetEntity: any = null;
            if (targetCacheEntity) {
                targetEntity = targetCacheEntity;
            }

            // 2. Validate target entity first
            if (!targetEntity) {
                request.log.error(`Target entity with ID ${targetId} not found.`);
                return reply.code(404).send({error: `Target entity with ID ${targetId} not found.`});
            }
            targetTypeForError = targetEntity['@type'];

            // Execute on the owning library gates the operation; the same
            // library also enables curated access to its allowedBackends, which
            // is why it is threaded into the factory rather than only checked here.
            const targetLibrary = resolveOwningLibrary(targetEntity);
            requireLibraryMode(request, targetLibrary, 'execute');

            // Every executor for this request — including each query-group leg,
            // which acquires its own through the engine — comes from this
            // factory, so all of them carry the caller's grants.
            const scopedExecutorFactory = new ExecutorFactory({
                request,
                viaLibrary: targetLibrary,
            });

            // 3. Validate backendId based on target type
            if (targetTypeForError === 'Query' || targetTypeForError === 'QueryVersion') {
                // Query execution REQUIRES backendId
                if (!backendId) {
                    return reply.code(400).send({
                        error: 'backendId is required when executing a Query or QueryVersion'
                    });
                }
            } else if (targetTypeForError === 'QueryGroup' || targetTypeForError === 'QueryGroupVersion') {
                // Query group execution should NOT have backendId
                if (backendId) {
                    return reply.code(400).send({
                        error: 'backendId should not be provided when executing a QueryGroup or QueryGroupVersion. Each execution node has its own backend configuration.'
                    });
                }
            }

            // 4. Fetch backend entity if backendId is provided
            let backendEntity: LdkitBackend | null = null;
            let isEphemeralBackend = false;
            let isLibraryStorageBackend = false;
            if (backendId) {
                // Check for ephemeral backend special case
                if (backendId === EPHEMERAL_BACKEND_ID) {
                    isEphemeralBackend = true;
                    request.log.info(`Using ephemeral backend for target ${targetId}.`);
                } else if (backendId === LIBRARY_STORAGE_BACKEND_ID) {
                    isLibraryStorageBackend = true;
                    request.log.info(`Using internal library storage backend for target ${targetId}.`);
                } else {
                    const backendCacheEntity = cacheCoordinator.get(backendId);
                    if (backendCacheEntity) {
                        backendEntity = backendCacheEntity as LdkitBackend;
                    }

                    // Validate backend
                    if (!backendEntity || !isBackend(backendEntity)) {
                        request.log.error(`Backend with ID ${backendId} not found or is not a Backend.`);
                        return reply.code(404).send({error: `Backend with ID ${backendId} not found or is not a Backend.`});
                    }
                    request.log.info(`Successfully fetched target ${targetId} and backend ${backendId}.`);
                }
            } else {
                request.log.info(`Successfully fetched target ${targetId} (no backend required for query group).`);
            }

            // 3. Resolve executable target (QueryVersion); support stable Query by resolving currentVersion
            let sparqlQueryString: string | undefined;
            let queryType: SparqlOperation | undefined; // Stored as IRI (sqlibQueryType:* terms)
            let resolvedTargetId = targetId;
            let resolvedQueryVersion: LdkitQueryVersion | null = null;

            const hasInlineLimits = Array.isArray(limits)
                ? limits.length > 0
                : limits
                    ? Object.keys(limits as Record<string, number>).length > 0
                    : false;
            let normalizedLimits: Array<{ name: string; value: number }> = Array.isArray(limits)
                ? (limits as Array<{ name: string; value: number }>)
                : limits
                    ? Object.entries(limits as Record<string, number>).map(([name, value]) => ({ name, value: Number(value) }))
                    : [];

            const hasInlineOffsets = Array.isArray(offsets)
                ? offsets.length > 0
                : offsets
                    ? Object.keys(offsets as Record<string, number>).length > 0
                    : false;
            let normalizedOffsets: Array<{ name: string; value: number }> = Array.isArray(offsets)
                ? (offsets as Array<{ name: string; value: number }>)
                : offsets
                    ? Object.entries(offsets as Record<string, number>).map(([name, value]) => ({ name, value: Number(value) }))
                    : [];

            const hasArgumentSetIdRefs = Array.isArray(argumentSetIds) && argumentSetIds.length > 0;
            /*
             * The inline values, kept apart from whatever a named set carries.
             *
             * They used to be simply overwritten by the stored payload, which
             * was safe only because supplying both was refused outright. Now
             * that a run may complete the parameters a set leaves open, the two
             * have to be told apart: one to check for overlap, both to merge.
             */
            const inlineLimits = normalizedLimits;
            const inlineOffsets = normalizedOffsets;

            let runtimePayload: RuntimeArgumentPayload | null = null;
            let runtimeArgumentSets = inlineArgs as RuntimeArgumentSet[] | undefined;
            let argumentSetMap: Map<string, RuntimeArgumentSet> | null = null;
            if (hasArgumentSetIdRefs) {
                runtimePayload = await argumentSetService.exportRuntimePayload(argumentSetIds!);
                // Stored sets take the same null-as-UNDEF normalization as inline ones,
                // so `{"x":null}` and `{}` dedupe as one row downstream.
                runtimeArgumentSets = normalizeUndefBindings(runtimePayload.tupleList) as RuntimeArgumentSet[];
                argumentSetMap = new Map(
                    Array.from(runtimePayload.tupleMap.entries()).map(([signature, set]) => [
                        signature,
                        normalizeUndefBindings([set])![0] as RuntimeArgumentSet,
                    ])
                );
                // Stored first, then the inline values for names the set left
                // open. The conflict check below rules out any overlap.
                normalizedLimits = [...runtimePayload.limits, ...inlineLimits];
                normalizedOffsets = [...runtimePayload.offsets, ...inlineOffsets];
                if (inlineArgs?.length) {
                    for (const argSet of inlineArgs as RuntimeArgumentSet[]) {
                        const vars = Array.isArray(argSet?.head?.vars) ? argSet.head.vars : [];
                        if (!vars.length) continue;
                        const key = tableParameterKey(vars);
                        if (argumentSetMap.has(key)) continue;
                        const normalized = normalizeUndefBindings([argSet])![0] as RuntimeArgumentSet;
                        argumentSetMap.set(key, normalized);
                    }
                    runtimeArgumentSets = Array.from(argumentSetMap.values());
                }
            }

            /*
             * A group's LIMIT/OFFSET values are validated against what its
             * members declare, not refused.
             *
             * This used to be a flat refusal: "no unambiguous single query to
             * which a global LIMIT/OFFSET can be applied". True of a global
             * one — so these are not global. A placeholder is named
             * (`LIMIT 000pageSize`), so a value reaches exactly those nodes
             * whose query declares that name, and `ExecutionEngine` filters per
             * node. What is worth refusing is a name *no* member declares,
             * which is what `validateArgumentPayloadAgainstInputs` refuses on
             * the query path: silently ignoring it would page nothing and look
             * like it had.
             */
            if (targetTypeForError === 'QueryGroup' || targetTypeForError === 'QueryGroupVersion') {
                const groupVersionId = targetEntity['@type'] === 'QueryGroupVersion'
                    ? targetId
                    : (targetEntity.currentVersion as string | undefined) ?? null;
                if (groupVersionId && (normalizedLimits.length > 0 || normalizedOffsets.length > 0)) {
                    const declared = groupSignatureService.pageParametersFor(groupVersionId);
                    const unknown = (
                        supplied: Array<{ name: string; value: number }>,
                        declaredNames: string[],
                        label: string,
                    ): string | null => {
                        const known = new Set(declaredNames);
                        const miss = supplied.find(parameter => !known.has(parameter.name));
                        if (!miss) return null;
                        return `${label} parameter '${miss.name}' is not declared by any query in this group`
                            + (declaredNames.length
                                ? `; it declares ${declaredNames.map(name => `'${name}'`).join(', ')}`
                                : ' (it declares none)');
                    };
                    const problem = unknown(normalizedLimits, declared.limitParameters, 'Limit')
                        ?? unknown(normalizedOffsets, declared.offsetParameters, 'Offset');
                    if (problem) {
                        return reply.code(400).send({ error: problem });
                    }
                }
            }

            /*
             * A run is an argument set plus anything it left open.
             *
             * This used to be a blanket refusal: naming a set and supplying any
             * inline value at all was a 400. That is too coarse — an argument
             * set may deliberately leave a parameter unfilled (the `partial`
             * verdict the switcher already computes), and completing it at run
             * time is exactly how one set serves several fixtures without
             * becoming several sets. What is worth refusing is an *overlap*:
             * a value for a parameter the set already fills, where either
             * precedence rule would surprise half the callers.
             *
             * See `docs/concepts.md`.
             */
            if (hasArgumentSetIdRefs && runtimePayload) {
                const filled = runtimePayload.filledParameters;
                const conflicts: string[] = [];
                for (const argSet of inlineArgs ?? []) {
                    const vars = Array.isArray(argSet?.head?.vars) ? argSet.head.vars : [];
                    if (vars.length && filled.has(tableParameterKey(vars))) {
                        conflicts.push(describeParameterKey(tableParameterKey(vars)));
                    }
                }
                for (const limit of inlineLimits) {
                    if (filled.has(scalarParameterKey('limit', limit.name))) {
                        conflicts.push(describeParameterKey(scalarParameterKey('limit', limit.name)));
                    }
                }
                for (const offset of inlineOffsets) {
                    if (filled.has(scalarParameterKey('offset', offset.name))) {
                        conflicts.push(describeParameterKey(scalarParameterKey('offset', offset.name)));
                    }
                }
                for (const [index, entry] of (dataGraphs ?? []).entries()) {
                    // Slot-keyed: a run's graphs are an ordered list the group
                    // routes, so entry N conflicts with the set's slot N.
                    const key = graphParameterKey(index);
                    if (filled.has(key)) {
                        conflicts.push(describeParameterKey(key));
                    }
                }
                if (conflicts.length) {
                    return reply.code(400).send({
                        error: `The named argument set already fills ${conflicts.join(', ')}; `
                            + 'supply a value only for a parameter it leaves open.',
                    });
                }
            }

            /*
             * Graph bindings on a set are a query group's; a query declares no
             * graph parameter, so they are dropped for a query target exactly
             * as a table binding no clause matches is dropped. The screen warns
             * before the run; the route does not refuse, because the set may
             * legitimately serve a group as well.
             */
            const storedDataGraphs = (targetTypeForError === 'QueryGroup' || targetTypeForError === 'QueryGroupVersion')
                ? (runtimePayload?.dataGraphs ?? [])
                : [];

            // A data graph is a query group's input, supplied through its start
            // node. A query names its store with `backendId` and a rule set has
            // its own route, so neither has a start node to hand one to.
            const suppliedDataGraphs = dataGraphs ?? [];
            if (
                suppliedDataGraphs.length > 0 &&
                targetTypeForError !== 'QueryGroup' &&
                targetTypeForError !== 'QueryGroupVersion'
            ) {
                return reply.code(400).send({
                    error: 'dataGraphs are only supported when executing a QueryGroup or QueryGroupVersion: '
                        + 'they fill the data graph inputs its start node declares.',
                });
            }

            let initialDataGraphs: ExecutionDataGraphInput[] = [];
            try {
                initialDataGraphs = suppliedDataGraphs.map(entry => {
                    // `{ request }` because a run's own `dataGraphs[]` name
                    // stored graphs that need not live in the target's library,
                    // and Execute on the target says nothing about them. The
                    // stored half above came off an argument set, whose pins
                    // `ArgumentSetService` checked when the set was composed.
                    const resolved = resolveDataGraphInput(entry, { request });
                    if (!resolved) {
                        throw new DataGraphContentError(
                            'Each data graph needs a dataGraphVersionId, dataGraphId or dataGraphInline',
                        );
                    }
                    return { content: resolved.content, format: resolved.format };
                });
            } catch (dataGraphError__u: unknown) {
                const dataGraphError = toError(dataGraphError__u);
                if (dataGraphError instanceof DataGraphContentError) {
                    return reply.code(400).send({ error: dataGraphError.message });
                }
                throw dataGraphError;
            }
            // Stored first, then whatever the run supplied for the slots the
            // set left open; the conflict check above has already ruled out
            // overlap, so the two lists concatenate into one ordered run.
            initialDataGraphs = [...storedDataGraphs, ...initialDataGraphs];

            const resolveArgumentsForQuery = (queryString?: string): RuntimeArgumentSet[] | undefined => {
                if (!queryString) return runtimeArgumentSets;
                if (!argumentSetMap || argumentSetMap.size === 0) {
                    return runtimeArgumentSets;
                }
                try {
                    const detected = parser.detectInputs(queryString).valuesInputs;
                    if (!detected.length) {
                        return [];
                    }
                    return detected.map((group) => {
                        const signature = tableParameterKey(group);
                        const preset = argumentSetMap!.get(signature);
                        if (preset) return preset;
                        // No stored set covers this input: nothing arrived, so drop the
                        // filter rather than substituting an empty (match-nothing) set.
                        return {
                            head: { vars: group },
                            arguments: { bindings: [] },
                            whenEmpty: 'unconstrained' as const,
                        };
                    });
                } catch (error) {
                    request.log.error(error, 'Failed to detect VALUES inputs for argument sets');
                    return runtimeArgumentSets;
                }
            };

            const initialArgumentSets = argumentSetMap
                ? Array.from(argumentSetMap.values())
                : runtimeArgumentSets ?? [];

            if (isQuery(targetEntity)) {
                const current = targetEntity.currentVersion;
                if (!current) {
                    return reply.code(409).send({error: `Query ${targetId} has no currentVersion set.`});
                }
                const version = cacheCoordinator.get(current) as LdkitQueryVersion | null;
                if (!version) {
                    return reply.code(404).send({error: `Current version ${current} for Query ${targetId} not found.`});
                }
                resolvedQueryVersion = version;
                sparqlQueryString = version.queryString as string;
                const rawType = version.queryType as string | undefined;
                queryType = toQueryTypeIri(rawType) as SparqlOperation | undefined;
                resolvedTargetId = version.$id || current;
                reply.header('X-Resolved-Target', resolvedTargetId);

                const detectedInputs = sparqlQueryString ? parser.detectInputs(sparqlQueryString) : null;
                if (hasArgumentSetIdRefs && runtimePayload && detectedInputs) {
                    const validationError = validateArgumentPayloadAgainstInputs(detectedInputs, runtimePayload);
                    if (validationError) {
                        return reply.code(400).send({error: validationError});
                    }
                }

                if (sparqlQueryString) {
                    try {
                        // The substitution itself lives in `lib/executionArguments.ts`,
                        // so a stored version and the ad-hoc query `POST /sparql`
                        // runs go through exactly the same code.
                        sparqlQueryString = applyExecutionArguments(sparqlQueryString, {
                            argumentSets: resolveArgumentsForQuery(sparqlQueryString),
                            limits: normalizedLimits,
                            offsets: normalizedOffsets,
                        }, parser);
                    } catch (applyError__u: unknown) {
                        const applyError = toError(applyError__u);
                        request.log.error(applyError, `Error applying execution arguments to query version ${resolvedTargetId}`);
                        return reply.code(400).send({error: applyError.message});
                    }
                }

            } else if (isQueryVersion(targetEntity)) {
                sparqlQueryString = targetEntity.queryString as string;
                const rawType = targetEntity.queryType as string | undefined;
                queryType = toQueryTypeIri(rawType) as SparqlOperation | undefined;
                resolvedQueryVersion = targetEntity;
                resolvedTargetId = targetEntity.$id;
                reply.header('X-Resolved-Target', resolvedTargetId);

                const detectedInputs = sparqlQueryString ? parser.detectInputs(sparqlQueryString) : null;
                if (hasArgumentSetIdRefs && runtimePayload && detectedInputs) {
                    const validationError = validateArgumentPayloadAgainstInputs(detectedInputs, runtimePayload);
                    if (validationError) {
                        return reply.code(400).send({error: validationError});
                    }
                }

                if (sparqlQueryString) {
                    try {
                        // The substitution itself lives in `lib/executionArguments.ts`,
                        // so a stored version and the ad-hoc query `POST /sparql`
                        // runs go through exactly the same code.
                        sparqlQueryString = applyExecutionArguments(sparqlQueryString, {
                            argumentSets: resolveArgumentsForQuery(sparqlQueryString),
                            limits: normalizedLimits,
                            offsets: normalizedOffsets,
                        }, parser);
                    } catch (applyError__u: unknown) {
                        const applyError = toError(applyError__u);
                        request.log.error(applyError, `Error applying execution arguments to query version ${resolvedTargetId}`);
                        return reply.code(400).send({error: applyError.message});
                    }
                }

            } else if (targetEntity['@type'] === 'QueryGroup') {
                // DAG execution for QueryGroup via currentVersion
                const current = targetEntity.currentVersion as string | undefined;
                if (!current) {
                    return reply.code(409).send({error: `QueryGroup ${targetId} has no currentVersion set.`});
                }
                const version = cacheCoordinator.get(current);
                if (!version || version['@type'] !== 'QueryGroupVersion') {
                    return reply.code(404).send({error: `QueryGroupVersion ${current} not found for ${targetId}.`});
                }

                reply.header('X-Resolved-Target', current);

                // Build graph and execute
                const {GraphBuilder} = await import('../lib/orchestration/GraphBuilder.js');
                const {ExecutionEngine} = await import('../lib/orchestration/ExecutionEngine.js');

                const gb = new GraphBuilder();
                const graph = gb.buildFromGroupVersion(version);
                const engine = new ExecutionEngine(scopedExecutorFactory);
                const endNode = graph.endNodeIds.length > 0 ? graph.nodes.get(graph.endNodeIds[0]) : null;
                const endNodeMediaType = (endNode?.raw as { mediaType?: string } | undefined)?.mediaType ?? null;
                const preferredRdfMediaType = resolvePreferredRdfMediaType(request.headers.accept, endNodeMediaType);
                const nodeExecution = buildNodeDetailHooks(nodeDetail);
                nodeExecutionDetails = nodeExecution.details;
                const {result, resultNodeId} = await engine.execute(
                    graph,
                    initialArgumentSets,
                    nodeExecution.hooks,
                    {
                        acceptHeader: preferredRdfMediaType ?? null,
                        dataGraphs: initialDataGraphs,
                        limits: normalizedLimits,
                        offsets: normalizedOffsets,
                    }
                );
                if (resultNodeId) reply.header('X-Result-Node', resultNodeId);
                setTimingHeader();

                // The nodeDetail envelope is always JSON, whatever the result type it
                // wraps - an RDF media type here would make Fastify reject the object.
                if (nodeDetail) {
                    reply.header('Content-Type', 'application/json');
                    return reply.send({
                        result,
                        nodes: nodeExecution.details,
                        resultContentType: resultContentTypeFor(result, preferredRdfMediaType),
                    });
                }

                // Set Content-Type based on result type
                if (typeof result === 'string') {
                    // RDF string result (CONSTRUCT/DESCRIBE) - default to n-triples
                    reply.header('Content-Type', preferredRdfMediaType || 'application/n-triples');
                } else if (typeof result === 'object' && result !== null) {
                    // JSON result (SELECT) - default to SPARQL JSON
                    reply.header('Content-Type', 'application/sparql-results+json');
                } else if (typeof result === 'boolean') {
                    // ASK result - default to SPARQL JSON
                    reply.header('Content-Type', 'application/sparql-results+json');
                }

                // Return raw result (could be SELECT JSON, RDF string, or boolean)
                return reply.send(result);
            } else if (targetEntity['@type'] === 'QueryGroupVersion') {
                // DAG execution for QueryGroupVersion directly
                reply.header('X-Resolved-Target', targetId);

                // Build graph and execute
                const {GraphBuilder} = await import('../lib/orchestration/GraphBuilder.js');
                const {ExecutionEngine} = await import('../lib/orchestration/ExecutionEngine.js');

                const gb = new GraphBuilder();
                const graph = gb.buildFromGroupVersion(targetEntity);
                const engine = new ExecutionEngine(scopedExecutorFactory);
                const endNode = graph.endNodeIds.length > 0 ? graph.nodes.get(graph.endNodeIds[0]) : null;
                const endNodeMediaType = (endNode?.raw as { mediaType?: string } | undefined)?.mediaType ?? null;
                const preferredRdfMediaType = resolvePreferredRdfMediaType(request.headers.accept, endNodeMediaType);
                const nodeExecution = buildNodeDetailHooks(nodeDetail);
                nodeExecutionDetails = nodeExecution.details;
                const {result, resultNodeId} = await engine.execute(
                    graph,
                    initialArgumentSets,
                    nodeExecution.hooks,
                    {
                        acceptHeader: preferredRdfMediaType ?? null,
                        dataGraphs: initialDataGraphs,
                        limits: normalizedLimits,
                        offsets: normalizedOffsets,
                    }
                );
                if (resultNodeId) reply.header('X-Result-Node', resultNodeId);
                setTimingHeader();

                // The nodeDetail envelope is always JSON, whatever the result type it
                // wraps - an RDF media type here would make Fastify reject the object.
                if (nodeDetail) {
                    reply.header('Content-Type', 'application/json');
                    return reply.send({
                        result,
                        nodes: nodeExecution.details,
                        resultContentType: resultContentTypeFor(result, preferredRdfMediaType),
                    });
                }

                // Set Content-Type based on result type
                if (typeof result === 'string') {
                    // RDF string result (CONSTRUCT/DESCRIBE) - default to n-triples
                    reply.header('Content-Type', preferredRdfMediaType || 'application/n-triples');
                } else if (typeof result === 'object' && result !== null) {
                    // JSON result (SELECT) - default to SPARQL JSON
                    reply.header('Content-Type', 'application/sparql-results+json');
                } else if (typeof result === 'boolean') {
                    // ASK result - default to SPARQL JSON
                    reply.header('Content-Type', 'application/sparql-results+json');
                }

                // Return raw result (could be SELECT JSON, RDF string, or boolean)
                return reply.send(result);
            } else {
                return reply.code(400).send({error: `Target entity ${targetId} is not an executable type (Query/QueryVersion, QueryGroup, or QueryGroupVersion). Found type: ${targetEntity['@type']}`});
            }

    if (!queryType && sparqlQueryString) {
        try {
            queryType = detectSparqlOperation(sparqlQueryString);
        } catch (error__u: unknown) {
      const error = toError(error__u);
            request.log.warn(error, `Unable to detect query type for ${resolvedTargetId}`);
            return reply.code(400).send({error: error?.message || 'Invalid SPARQL query'});
        }
    }

    // 4. Instantiate the executor for the *target* backend based on its type
            // Skip executor instantiation for query groups (they handle backends internally)
            let targetExecutor: ISparqlExecutor | null = null;

            if (isEphemeralBackend) {
                // Create ephemeral store for this execution
                ephemeralStoreId = `ephemeral-query-${crypto.randomUUID()}`;
                const ephemeralStore = oxigraphStoreManager.createEphemeralStore(ephemeralStoreId);
                targetExecutor = new OxigraphSparqlExecutor(ephemeralStore);
                backendTypeAttr = 'oxigraphEphemeral'; // For metrics
                request.log.info(`Created ephemeral store ${ephemeralStoreId} for target ${targetId}`);
            } else if (isLibraryStorageBackend) {
                const resolvedNode = {
                    id: resolvedTargetId,
                    raw: resolvedQueryVersion ?? targetEntity,
                    backendId: LIBRARY_STORAGE_BACKEND_ID,
                    queryVersionId: resolvedQueryVersion?.$id ?? resolvedTargetId,
                    queryVersion: resolvedQueryVersion ?? undefined,
                    queryString: sparqlQueryString,
                    queryType,
                    inputTupleIds: [],
                    outputTupleIds: [],
                } as ResolvedNode;

                targetExecutor = await scopedExecutorFactory.getExecutorForNode(resolvedNode);
                backendTypeAttr = 'libraryStorage';
            } else if (backendEntity) {
                // Ensure backendType is present before resolving the executor
                if (typeof backendEntity.backendType !== 'string' || backendEntity.backendType.length === 0) {
                    request.log.error(`Backend ${backendId} is missing backendType.`);
                    return reply.code(400).send({error: 'Unsupported backend type'});
                }
                // Directly access backendType, assuming JSON-LD context ensures it's single
                const backendTypeKey = backendTypeIriToKey(backendEntity.backendType);
                if (!backendTypeKey) {
                    request.log.error(`Backend ${backendId} has an unsupported backend type IRI: ${String(backendEntity.backendType)}`);
                    return reply.code(400).send({error: `Unsupported backend type: ${backendEntity.backendType}`});
                }
                backendTypeAttr = backendTypeKey; // Capture for metrics

                request.log.info(`Instantiating executor for backend ${backendId} of type: ${backendTypeKey}`);

                const resolvedNode = {
                    id: resolvedTargetId,
                    raw: resolvedQueryVersion ?? targetEntity,
                    backendId,
                    queryVersionId: resolvedQueryVersion?.$id ?? resolvedTargetId,
                    queryVersion: resolvedQueryVersion ?? undefined,
                    queryString: sparqlQueryString,
                    queryType,
                    inputTupleIds: [],
                    outputTupleIds: [],
                } as ResolvedNode;

                targetExecutor = await scopedExecutorFactory.getExecutorForNode(resolvedNode);
            }

    let resolvedType: SparqlOperation | undefined = queryType && isQueryTypeIri(queryType) ? queryType : undefined;

    // 4.5 Determine Accept header
    let acceptHeader = acceptOverride || request.headers.accept;
    let defaultAcceptHeader: string | undefined = undefined;

    switch (resolvedType) {
        case QueryTypeIri.select:
        case QueryTypeIri.ask:
            defaultAcceptHeader = 'application/sparql-results+json';
            break;
        case QueryTypeIri.construct:
        case QueryTypeIri.describe:
            defaultAcceptHeader = 'text/turtle';
            break;
        default:
            defaultAcceptHeader = undefined;
    }

            // Use provided header if it exists and is specific, otherwise use default
            const finalAcceptHeader = (acceptHeader && acceptHeader !== '*/*') ? acceptHeader : defaultAcceptHeader;
            request.log.info(`Using Accept header: ${finalAcceptHeader || 'None (default behavior)'}`);

            // 5. Execute the query, passing the determined Accept header
            // Use the appropriate executor method based on query type
            // Ensure sparqlQueryString is not undefined before passing
            if (!sparqlQueryString) {
                // This should have been caught earlier, but defensive check
                throw new Error("Internal error: sparqlQueryString became undefined before execution.");
            }

            // Ensure targetExecutor is not null (should only be null for query groups which exit earlier)
            if (!targetExecutor) {
                throw new Error("Internal error: targetExecutor is null but required for query execution.");
            }

            // Pass finalAcceptHeader to executor methods
            switch (resolvedType) {
                case QueryTypeIri.select: {
                    const {result, duration, contentType} = await targetExecutor.selectQueryParsed(sparqlQueryString, {acceptHeader: finalAcceptHeader});
                    dbDuration = duration;
                    executionStatus = 'success';
                    // Set Content-Type header from backend response, or use default for SELECT JSON
                    if (contentType) {
                        reply.header('Content-Type', contentType);
                    } else if (typeof result === 'object') {
                        // Default to JSON for SELECT results when no content-type returned
                        reply.header('Content-Type', 'application/sparql-results+json');
                    }
                    setTimingHeader();
                    return reply.send(result);
                }
                case QueryTypeIri.construct:
                case QueryTypeIri.describe: {
                    const {result, duration, contentType} = await targetExecutor.constructQueryParsed(sparqlQueryString, {acceptHeader: finalAcceptHeader});
                    dbDuration = duration;
                    executionStatus = 'success';
                    if (typeof result === 'string') {
                        // Use Content-Type from backend response if available
                        if (contentType) {
                            reply.header('Content-Type', contentType);
                        } else if (finalAcceptHeader) {
                            // Fallback: infer from Accept header if no content-type returned
                            let responseContentType = 'text/plain';
                            if (finalAcceptHeader.includes('turtle')) responseContentType = 'text/turtle';
                            else if (finalAcceptHeader.includes('rdf+xml')) responseContentType = 'application/rdf+xml';
                            else if (finalAcceptHeader.includes('n-triples')) responseContentType = 'application/n-triples';
                            else if (finalAcceptHeader.includes('n-quads')) responseContentType = 'application/n-quads';
                            else if (finalAcceptHeader.includes('json-ld')) responseContentType = 'application/ld+json';
                            else if (finalAcceptHeader.includes('trig')) responseContentType = 'application/trig';
                            else responseContentType = finalAcceptHeader;
                            reply.header('Content-Type', responseContentType);
                        } else {
                            // Default to n-triples if no content-type and no accept header
                            reply.header('Content-Type', 'application/n-triples');
                        }
                    }
                    setTimingHeader();
                    return reply.send(result);
                }
                case QueryTypeIri.ask: {
                    const {result, duration, contentType} = await targetExecutor.askQuery(sparqlQueryString, {acceptHeader: finalAcceptHeader});
                    dbDuration = duration;
                    executionStatus = 'success';
                    // Set Content-Type header from backend response, or use default for ASK JSON
                    if (contentType) {
                        reply.header('Content-Type', contentType);
                    } else if (typeof result === 'boolean') {
                        // Default to JSON for ASK results when no content-type returned
                        reply.header('Content-Type', 'application/sparql-results+json');
                    }
                    // ASK results should be wrapped in a standard SPARQL JSON object
                    setTimingHeader();
                    return reply.send({head: {}, boolean: result});
                }
                case QueryTypeIri.update: {
                    if (wantsRdfPatch(finalAcceptHeader)) {
                        /*
                         * The output an update has (#290): the ground diff it
                         * would make, derived with two CONSTRUCTs and an
                         * existence check rather than executed. The store is
                         * left exactly as it was — applying the diff is
                         * `POST /patches/apply`, which is a different button.
                         */
                        if (!backendId) {
                            return reply.code(400).send({
                                error: 'Deriving a patch needs a registered backend to derive it against.',
                            });
                        }
                        try {
                            const patch = await previewUpdate({
                                backendId,
                                updateString: sparqlQueryString,
                                origin: clientIdOf(request),
                            });
                            if (patch.applyMode === 'graph-ops') {
                                /*
                                 * RDF Patch has rows for quads and nothing
                                 * else, so a graph-management operation that
                                 * was counted rather than enumerated has no
                                 * spelling in it — the document would show an
                                 * empty or partial change and read as the whole
                                 * truth. The JSON view carries `graphOps`, so
                                 * that is where such a preview is answered.
                                 */
                                return reply.code(422).send({
                                    error: 'This update performs a graph-management operation that RDF Patch cannot express; '
                                        + `read the patch as JSON at GET /patches/${patch.$id}.`,
                                });
                            }
                            executionStatus = 'success';
                            reply.header('Content-Type', `${PATCH_MEDIA_TYPES.RDF_PATCH}; charset=utf-8`);
                            reply.header('X-Sqlib-Patch-Id', patch.$id);
                            setTimingHeader();
                            return reply.send(toRdfPatchDocument(patch));
                        } catch (error__u: unknown) {
                            // A backend with no patch log and an update form the
                            // rewrite cannot express are both the caller asking
                            // for something this pairing cannot produce, not a
                            // failure of the run.
                            if (error__u instanceof PatchTargetError) {
                                return reply.code(error__u.statusCode).send({error: error__u.message});
                            }
                            if (error__u instanceof UnsupportedUpdateError) {
                                return reply.code(400).send({error: error__u.message});
                            }
                            throw error__u;
                        }
                    }
                    const {duration} = await targetExecutor.update(sparqlQueryString);
                    dbDuration = duration;
                    executionStatus = 'success';
                    request.log.info(`Executed UPDATE query ${targetId} successfully.`);
                    // Successful UPDATE should return 204 No Content
                    setTimingHeader();
                    return reply.code(204).send();
                }
                default: {
                    const reportedType = queryType ? (getQueryTypeKeyFromIri(queryType) || queryType) : 'UNRESOLVED';
                    request.log.warn(`Unknown query type '${reportedType}' for ${targetId}. Cannot execute.`);
                    return reply.code(400).send({error: `Unsupported or unknown query type: ${reportedType}`});
                }
            }

        } catch (error__u: unknown) {
      const error = toError(error__u);
            // Use backendId from request in error logging
            request.log.error(error, `Error executing query ${targetId}${backendId ? ` on backend ${backendId}` : ''}`);

            if ((targetTypeForError === 'QueryGroup' || targetTypeForError === 'QueryGroupVersion') && error?.message) {
                setTimingHeader();
                const nodeError = error as Error & { nodeId?: string; nodeName?: string };
                return reply.code(400).send({
                    error: `Query group execution failed: ${error.message}`,
                    ...(nodeError.nodeId ? { failedNodeId: nodeError.nodeId } : {}),
                    ...(nodeError.nodeName ? { failedNodeName: nodeError.nodeName } : {}),
                    ...(nodeDetail ? { nodes: nodeExecutionDetails } : {}),
                });
            }

            // Use centralized error handling (pass undefined for query groups without backend)
            const errorResponse = handleSparqlExecutionError(error, backendId || 'unknown');
            setTimingHeader();
            return reply.code(errorResponse.statusCode).send({ error: errorResponse.error });
        } finally {
            // Cleanup ephemeral store if created
            if (ephemeralStoreId) {
                oxigraphStoreManager.destroyEphemeralStore(ephemeralStoreId);
                request.log.info(`Destroyed ephemeral store ${ephemeralStoreId} for target ${targetId}`);
            }

            const duration = performance.now() - startTime;
            // Record metrics using the backend ID from the request (or 'none' for query groups)
            const attributes = {
                'query.id': targetId,
                'backend.id': backendId || 'none', // Use 'none' for query groups
                // 'backend.source' removed
                'backend.type': backendTypeAttr || 'unknown', // Use stored backend type
                // 'query.type': queryTypeAttr || 'unknown', // Removed query type attribute
                'status': executionStatus,
            };
            queryExecutionDuration.record(duration, attributes);
            queryExecutionCounter.add(1, attributes);
            request.log.info({duration, attributes}, `Recorded execution metrics for query ${targetId}`);
        }
    }

    // POST route
    fastify.post(
        '/',
        {
            schema: {
                ...executionRouteSchemas.post,
                headers: {
                    type: 'object',
                    properties: {
                        accept: {
                            type: 'string',
                            description: 'Desired response format for RDF data. Common values: ' + OUTPUT_MEDIA_TYPE_VALUES.slice(0, 3).join(', ') + '...',
                        },
                    },
                    additionalProperties: true,
                },
                body: {
                    ...(executionRouteSchemas.post.body as Record<string, any>),
                    examples: [queryVersionExecutionExample, queryGroupExecutionExample],
                },
            },
        },
        async (request: FastifyRequest<{ Body: ExecutionRequest }>, reply: FastifyReply) => {
            request.log.info(`Received /execute POST request with body:\n${JSON.stringify(request.body, null, 2)}`);

            const {targetId, backendId, arguments: args, limits, offsets, argumentSetIds, dataGraphs, nodeDetail} = request.body;

            return executeQuery(request, reply, {
                targetId,
                backendId,
                arguments: args,
                limits,
                offsets,
                argumentSetIds,
                dataGraphs,
                nodeDetail,
                acceptOverride: request.headers.accept
            });
        }
    );

    // GET route with query parameters
    fastify.get(
        '/',
        {
            schema: {
                ...executionRouteSchemas.get,
                headers: {
                    type: 'object',
                    properties: {
                        accept: {
                            type: 'string',
                            description: 'Desired response format for RDF data. Common values: ' + OUTPUT_MEDIA_TYPE_VALUES.slice(0, 3).join(', ') + '...',
                        },
                    },
                    additionalProperties: true,
                },
            },
        },
        async (request: FastifyRequest<{ Querystring: ExecutionQuerystring }>, reply: FastifyReply) => {
            request.log.info(`Received /execute GET request with query params:\n${JSON.stringify(request.query, null, 2)}`);

            const {
                targetId,
                backendId,
                arguments: argsString,
                limits: limitsString,
                offsets: offsetsString,
                argumentSetIds: argumentSetIdsString,
                dataGraphs: dataGraphsString,
                nodeDetail,
            } = request.query;

            // Parse arguments from JSON string if provided
            let args: any[] | undefined = undefined;
            if (argsString) {
                try {
                    args = JSON.parse(argsString);
                    if (!Array.isArray(args)) {
                        return reply.code(400).send({error: 'Arguments parameter must be a JSON array when provided.'});
                    }
                } catch (parseError__u: unknown) {
      const parseError = toError(parseError__u);
                    request.log.error(parseError, `Error parsing arguments parameter: ${argsString}`);
                    return reply.code(400).send({error: `Invalid JSON in arguments parameter: ${parseError.message}`});
                }
            }

            // Parse limits from JSON string if provided
            let limits: any | undefined = undefined;
            if (limitsString) {
                try {
                    limits = JSON.parse(limitsString);
                    if (typeof limits !== 'object' || limits === null || Array.isArray(limits)) {
                        return reply.code(400).send({error: 'Limits parameter must be a JSON object when provided.'});
                    }
                } catch (parseError__u: unknown) {
      const parseError = toError(parseError__u);
                    request.log.error(parseError, `Error parsing limits parameter: ${limitsString}`);
                    return reply.code(400).send({error: `Invalid JSON in limits parameter: ${parseError.message}`});
                }
            }

            // Parse offsets from JSON string if provided
            let offsets: any | undefined = undefined;
            if (offsetsString) {
                try {
                    offsets = JSON.parse(offsetsString);
                    if (typeof offsets !== 'object' || offsets === null || Array.isArray(offsets)) {
                        return reply.code(400).send({error: 'Offsets parameter must be a JSON object when provided.'});
                    }
                } catch (parseError__u: unknown) {
      const parseError = toError(parseError__u);
                    request.log.error(parseError, `Error parsing offsets parameter: ${offsetsString}`);
                    return reply.code(400).send({error: `Invalid JSON in offsets parameter: ${parseError.message}`});
                }
            }

            let argumentSetIds: string[] | undefined = undefined;
            if (argumentSetIdsString) {
                try {
                    const parsed = JSON.parse(argumentSetIdsString);
                    if (!Array.isArray(parsed) || !parsed.every((id: unknown) => typeof id === 'string')) {
                        return reply.code(400).send({ error: 'argumentSetIds parameter must be a JSON array when provided.' });
                    }
                    argumentSetIds = parsed;
                } catch (parseError__u: unknown) {
      const parseError = toError(parseError__u);
                    request.log.error(parseError, `Error parsing argumentSetIds parameter: ${argumentSetIdsString}`);
                    return reply.code(400).send({error: `Invalid JSON in argumentSetIds parameter: ${parseError.message}`});
                }
            }

            let getDataGraphs: ExecutionRequest['dataGraphs'] | undefined = undefined;
            if (dataGraphsString) {
                try {
                    const parsed = JSON.parse(dataGraphsString);
                    if (!Array.isArray(parsed)) {
                        return reply.code(400).send({ error: 'dataGraphs parameter must be a JSON array when provided.' });
                    }
                    getDataGraphs = parsed;
                } catch (parseError__u: unknown) {
                    const parseError = toError(parseError__u);
                    request.log.error(parseError, `Error parsing dataGraphs parameter: ${dataGraphsString}`);
                    return reply.code(400).send({ error: `Invalid JSON in dataGraphs parameter: ${parseError.message}` });
                }
            }

            return executeQuery(request, reply, {
                targetId,
                backendId,
                arguments: args,
                limits,
                offsets,
                argumentSetIds,
                dataGraphs: getDataGraphs,
                nodeDetail,
                acceptOverride: request.headers.accept
            });
        }
    );
}
