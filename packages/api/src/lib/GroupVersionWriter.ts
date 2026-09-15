/**
 * Flat group-version writer.
 *
 * Two phases:
 *
 * - **stage** — pure. Mint IRIs for temporary ids, resolve and validate every
 *   reference, run every precondition, and build the complete ordered list of
 *   entities to write, including a fully-formed QueryGroupVersion. Accumulates
 *   all failures and throws once. Nothing has been written at this point.
 * - **flush** — I/O only. Loop and create. The version number is computed
 *   immediately before the version row is written, and the version row is
 *   written *last*.
 *
 * Writing the version row last is what makes partial writes harmless without
 * transactions: nothing lists a group version until every entity it references
 * exists. A store failure mid-flush leaves unreferenced children — garbage, but
 * invisible garbage — instead of a listed half-version and a burned version
 * number.
 *
 * Keeping the flush free of computation is the point. A pre-flight pass bolted
 * onto the front would hold only for as long as every future check remembered
 * to live in it.
 */

import type { FastifyRequest } from 'fastify';
import { mintId } from './id.js';
import { AuthorizationError, requireLibraryMode, resolveOwningLibrary } from '../auth/enforce.js';
import type { LdkitQueryGroup } from '../persistence/schemas/QueryGroupSchema.js';
import type { LdkitLibrary } from '../persistence/schemas/LibrarySchema.js';
import type { LdkitQueryVersion } from '../persistence/schemas/QueryVersionSchema.js';
import type { LdkitQueryGroupVersion } from '../persistence/schemas/QueryGroupVersionSchema.js';
import type { EphemeralBackendConfig } from '../persistence/schemas/QueryNodeSchema.js';
import { getCacheCoordinator } from './CacheCoordinatorProvider.js';
import { toLdkit } from '../persistence/utils/id-adapter.js';
import { WHEN_EMPTY_MODES } from '../persistence/schemas/QueryEdgeSchema.js';
import type { WhenEmptyMode } from '../persistence/schemas/QueryEdgeSchema.js';
import type { EntityType } from './EntityRegistry.js';
import {
  IO_REFERENCE_TYPES,
  NODE_REFERENCE_RULES,
  NODE_REFERENCE_TYPES,
  OPTIONAL_NODE_REFERENCES,
  ReferenceResolver,
  TEMP_ID_PREFIX,
  type ReferenceRule,
} from './groupVersionReferences.js';

type AnyRecord = Record<string, any>;

/** One entity to write, in order. */
interface StagedEntity {
  type: EntityType;
  payload: AnyRecord & { $id: string };
}

const IO_REF: ReferenceRule = { category: 'mintedOrExternal', allowedTypes: IO_REFERENCE_TYPES };
const NODE_REF: ReferenceRule = {
  category: 'mintedOrExternal',
  allowedTypes: NODE_REFERENCE_TYPES,
};

export async function createGroupVersionFlat(
  groupId: string,
  body: AnyRecord,
  authScope?: { request: FastifyRequest }
): Promise<{ created: LdkitQueryGroupVersion; iriMap: Record<string, string> }> {
  const cacheCoordinator = getCacheCoordinator();
  const iriMap: Record<string, string> = {};

  /**
   * The stored entities this version's nodes will *run*, collected as they
   * resolve and checked in one pass at the staging/flush boundary below.
   */
  const composed: Array<{ field: string; reference: string }> = [];

  // ---------------------------------------------------------------- stage --

  // Mint permanent IRIs for every temporary id first, so that references
  // between resources in this payload resolve regardless of declaration order.
  const processAndMapIds = (resources: AnyRecord[] | undefined, kind: string) => {
    if (!resources) return;
    for (const resource of resources) {
      const id = resource.id;
      if (id && typeof id === 'string' && id.startsWith(TEMP_ID_PREFIX)) {
        if (iriMap[id]) {
          throw new Error(`Duplicate temporary ID '${id}' detected.`);
        }
        iriMap[id] = mintId(kind);
      }
    }
  };

  const executionNodes = (body.executionNodes as AnyRecord[] | undefined) || [];

  processAndMapIds(executionNodes, 'node');
  processAndMapIds(body.edges, 'edge');
  processAndMapIds(body.tupleMembers, 'tupleMember');
  processAndMapIds(body.inputTuples, 'inputTuple');
  processAndMapIds(body.outputTuples, 'outputTuple');
  processAndMapIds(body.inputs, 'input');
  processAndMapIds(body.outputs, 'output');
  processAndMapIds(body.rdfOutputs, 'triplesQuadsIO');
  processAndMapIds(body.booleanOutputs, 'booleanIO');
  processAndMapIds(body.queryIdInputs, 'queryIdInput');

  const startNodeId = mintId('startNode');
  const endNodeId = mintId('endNode');
  iriMap['urn:__START__'] = startNodeId;
  iriMap['urn:__END__'] = endNodeId;
  if (typeof body.startNode?.id === 'string' && body.startNode.id.startsWith(TEMP_ID_PREFIX)) {
    iriMap[body.startNode.id] = startNodeId;
  }
  if (typeof body.endNode?.id === 'string' && body.endNode.id.startsWith(TEMP_ID_PREFIX)) {
    iriMap[body.endNode.id] = endNodeId;
  }

  const refs = new ReferenceResolver(iriMap, cacheCoordinator);

  /** An id this payload declares for a resource it is creating. */
  const ownId = (id: string | undefined): string => iriMap[id ?? ''] || (id as string);

  const staged: StagedEntity[] = [];
  const stage = (type: EntityType, payload: AnyRecord & { $id: string }) =>
    staged.push({ type, payload });

  for (const [i, m] of ((body.tupleMembers as AnyRecord[] | undefined) || []).entries()) {
    const variable = await refs.resolve(`tupleMembers[${i}].variable`, m.variable, IO_REF);
    stage('TupleMember', toLdkit({
      $id: ownId(m.id),
      position: m.position,
      variable,
      '@type': 'TupleMember',
    }) as AnyRecord & { $id: string });
  }

  for (const inp of (body.inputs as AnyRecord[] | undefined) || []) {
    stage('QueryInputVariable', toLdkit({
      $id: ownId(inp.id),
      variableName: inp.variableName,
      allowedTypes: inp.allowedTypes,
      '@type': 'QueryInputVariable',
    }) as AnyRecord & { $id: string });
  }

  for (const out of (body.outputs as AnyRecord[] | undefined) || []) {
    stage('QueryOutputVariable', toLdkit({
      $id: ownId(out.id),
      variableName: out.variableName,
      description: out.description,
      '@type': 'QueryOutputVariable',
    }) as AnyRecord & { $id: string });
  }

  for (const [i, t] of ((body.inputTuples as AnyRecord[] | undefined) || []).entries()) {
    const memberEntries = await refs.resolveAll(
      `inputTuples[${i}].memberEntries`, t.memberEntries, IO_REF);
    stage('QueryInputTuple', toLdkit({
      $id: ownId(t.id), name: t.name, memberEntries, '@type': 'QueryInputTuple',
    }) as AnyRecord & { $id: string });
  }

  for (const [i, t] of ((body.outputTuples as AnyRecord[] | undefined) || []).entries()) {
    const memberEntries = await refs.resolveAll(
      `outputTuples[${i}].memberEntries`, t.memberEntries, IO_REF);
    stage('QueryOutputTuple', toLdkit({
      $id: ownId(t.id), name: t.name, memberEntries, '@type': 'QueryOutputTuple',
    }) as AnyRecord & { $id: string });
  }

  for (const r of (body.rdfOutputs as AnyRecord[] | undefined) || []) {
    stage('TriplesQuadsIO', toLdkit({
      $id: ownId(r.id), ...r, '@type': 'TriplesQuadsIO',
    }) as AnyRecord & { $id: string });
  }

  for (const b of (body.booleanOutputs as AnyRecord[] | undefined) || []) {
    stage('BooleanIO', toLdkit({
      $id: ownId(b.id), ...b, '@type': 'BooleanIO',
    }) as AnyRecord & { $id: string });
  }

  for (const [i, q] of ((body.queryIdInputs as AnyRecord[] | undefined) || []).entries()) {
    const id = ownId(q.id);
    // QueryIdInput.isPartOf is required and means "the DynamicQueryNode this
    // slot belongs to". The flat create shape strips isPartOf, so the client
    // cannot send it and the owner has to be derived from whichever node
    // declares the port. Without this the entity is written incomplete, which
    // only stayed invisible while nothing loaded the QueryIdInput repository.
    const owner = executionNodes.find(node =>
      (node.inputs || []).includes(q.id) || (node.inputs || []).includes(id));
    if (!owner) {
      refs.fail(
        `queryIdInputs[${i}]`,
        q.id,
        'is not declared as an input of any execution node',
      );
      continue;
    }
    stage('QueryIdInput', toLdkit({
      $id: id, ...q, isPartOf: ownId(owner.id), '@type': 'QueryIdInput',
    }) as AnyRecord & { $id: string });
  }

  const startNodeOutputs = await refs.resolveAll(
    'startNode.outputs', body.startNode?.outputs, IO_REF);
  stage('StartNode', toLdkit({
    $id: startNodeId, outputs: startNodeOutputs, '@type': 'StartNode',
  }) as AnyRecord & { $id: string });

  // The library's default backend is a fallback for nodes that name none.
  let libraryDefaultBackend: string | undefined;
  try {
    const group = cacheCoordinator.get(groupId) as LdkitQueryGroup | null;
    const libId = group?.isPartOf as string | undefined;
    if (libId) {
      const lib = cacheCoordinator.get(libId) as LdkitLibrary | null;
      libraryDefaultBackend = lib?.defaultBackend as string | undefined;
    }
  } catch { /* the fallback is optional; a node may name its own backend */ }

  const mergeUnique = (...groups: Array<Array<string | undefined>>): string[] => {
    const seen = new Set<string>();
    const merged: string[] = [];
    for (const value of groups.flat()) {
      if (value && !seen.has(value)) {
        seen.add(value);
        merged.push(value);
      }
    }
    return merged;
  };

  const nodeIds: string[] = [];

  for (const [i, n] of executionNodes.entries()) {
    const id = ownId(n.id);
    const nodeType: string = n.nodeType || 'QueryNode';
    const at = (field: string) => `executionNodes[${i}].${field}`;
    const rules = NODE_REFERENCE_RULES[nodeType] ?? NODE_REFERENCE_RULES.QueryNode;
    const optional = OPTIONAL_NODE_REFERENCES[nodeType] ?? [];

    /*
     * A PatchNode may not be carried over as anything else.
     *
     * The same reasoning as the `backendConfig` guard below (issue #301), with
     * a worse consequence: a client that has never heard of this node type
     * reads one, sees a node with a `queryId`, and sends it back as a
     * QueryNode. The saved group then *runs* the update the node existed to
     * only describe — a destructive change with nothing in the author's diff
     * to explain it. Only a node carried over by IRI can be checked; one the
     * payload is minting has no previous type to lose.
     */
    if (nodeType !== 'PatchNode' && !n.id?.startsWith?.(TEMP_ID_PREFIX)) {
      const previous = cacheCoordinator.get(id) as { '@type'?: string } | null;
      if (previous?.['@type'] === 'PatchNode') {
        refs.fail(
          at('nodeType'),
          nodeType,
          `would turn PatchNode ${id} into a ${nodeType}, which would run the update it only derives. ` +
            `Send it back as a PatchNode, or delete the node and add a new one`,
        );
        continue;
      }
    }

    if (nodeType === 'RuleSetNode') {
      // `ruleSetVersionId` is the deprecated wire spelling. Report whichever the
      // client actually sent, so the failure names a field it can find in its
      // own payload.
      const field = n.ruleSetVersion !== undefined ? 'ruleSetVersion' : 'ruleSetVersionId';
      const raw = n.ruleSetVersion ?? n.ruleSetVersionId;
      if (!raw) {
        refs.fail(at(field), String(raw ?? ''), 'is required for a RuleSetNode');
        continue;
      }
      const ruleSetVersion = await refs.resolve(at(field), raw, rules.ruleSetVersion);
      if (ruleSetVersion) composed.push({ field: at(field), reference: ruleSetVersion });
      stage('RuleSetNode', toLdkit({
        $id: id,
        ruleSetVersion,
        inputs: await refs.resolveAll(at('inputs'), n.inputs, IO_REF),
        outputs: await refs.resolveAll(at('outputs'), n.outputs, IO_REF),
        '@type': 'RuleSetNode',
        nodeType,
      }) as AnyRecord & { $id: string });
      nodeIds.push(id);
      continue;
    }

    // A DynamicQueryNode gets its query at execution time through a
    // QueryIdInput, so an absent queryId is correct rather than missing. A
    // supplied one still has to resolve.
    let queryVersion: LdkitQueryVersion | undefined;
    if (n.queryId) {
      const resolvedQueryId = await refs.resolve(
        at('queryId'),
        n.queryId,
        rules.queryId ?? { category: 'external', allowedTypes: ['QueryVersion'] },
      );
      if (resolvedQueryId) {
        composed.push({ field: at('queryId'), reference: resolvedQueryId });
        queryVersion = cacheCoordinator.get(resolvedQueryId) as LdkitQueryVersion | undefined;
      }
    } else if (!optional.includes('queryId') && rules.queryId) {
      refs.fail(at('queryId'), '', 'is required for this node type');
    }

    /*
     * Exactly one of a resolvable `backendId` or an ephemeral `backendConfig`
     * (issue #297). The rule lives here rather than in either field's
     * cardinality because it is a relationship between the two: a node with an
     * ephemeral store never reads `backendId` — `ExecutorFactory` branches on
     * the config first — so requiring one made every all-ephemeral group name
     * an irrelevant backend, which then read as a coupling on the canvas and
     * broke the group if that backend was deleted.
     */
    const backendConfig = n.backendConfig as EphemeralBackendConfig | undefined | null;
    const hasEphemeralConfig = backendConfig?.type === 'ephemeral-oxigraph';

    /*
     * A client that has never heard of `backendConfig` sends a node without
     * one, and the new version silently loses the ephemeral store the old one
     * had: the group ran before the save and not after it, with nothing in the
     * user's diff to explain why (issue #301). The web editor is fixed, but
     * "the client remembered to send it back" is not a property the server
     * should be relying on for a field whose absence is destructive.
     *
     * Only a node carried over by IRI can be checked — a node the payload is
     * minting has no previous state to lose. `undefined` is the lossy case;
     * an explicit `null` is a client deliberately clearing the store, which is
     * a legitimate edit and passes.
     */
    if (n.backendConfig === undefined && !n.id?.startsWith?.(TEMP_ID_PREFIX)) {
      const previous = cacheCoordinator.get(id) as { backendConfig?: EphemeralBackendConfig } | null;
      if (previous?.backendConfig?.type === 'ephemeral-oxigraph') {
        refs.fail(
          at('backendConfig'),
          '',
          `is absent, but node ${id} currently runs against ephemeral store ` +
            `${previous.backendConfig.storeId}; omitting it would silently drop that store. ` +
            `Send the config back, or null to clear it deliberately`,
        );
      }
    }

    let backendId: string | undefined;
    if (hasEphemeralConfig) {
      // Deliberately not defaulted. Falling back to the library backend here is
      // what put a placeholder on every ephemeral node in the first place, and
      // a resolvable-looking backend on a node that never queries it is exactly
      // the lie the UI then displayed.
      if (n.backendId) {
        refs.fail(
          at('backendId'),
          String(n.backendId),
          'cannot be combined with an ephemeral backendConfig; the node reads one or the other',
        );
      }
    } else if (n.backendId) {
      backendId = await refs.resolve(at('backendId'), n.backendId, rules.backendId);
    } else {
      // Fall back to the parent Query's default backend, then the library's.
      const parentQuery = queryVersion?.isPartOf
        ? cacheCoordinator.get(queryVersion.isPartOf)
        : null;
      backendId =
        (parentQuery as { defaultBackend?: string } | null)?.defaultBackend ??
        libraryDefaultBackend;
      if (!backendId) {
        refs.fail(at('backendId'), '', 'could not be resolved, and no default applies');
      }
    }

    const entityType: EntityType =
      nodeType === 'DynamicQueryNode' ? 'DynamicQueryNode'
      : nodeType === 'PatchNode' ? 'PatchNode'
      : 'QueryNode';

    const inputs = mergeUnique(
      (queryVersion?.inferredInputs || []).map((x: string) => iriMap[x] || x),
      await refs.resolveAll(at('inputs'), n.inputs, IO_REF),
    );
    const outputs = mergeUnique(
      (queryVersion?.inferredOutputs || []).map((x: string) => iriMap[x] || x),
      await refs.resolveAll(at('outputs'), n.outputs, IO_REF),
    );

    if (entityType !== 'PatchNode') {
      stage(entityType, toLdkit({
        $id: id,
        queryId: n.queryId,
        backendId,
        backendConfig: n.backendConfig,
        inputs,
        outputs,
        '@type': entityType,
        nodeType,
      }) as AnyRecord & { $id: string });
      nodeIds.push(id);
      continue;
    }

    /*
     * A PatchNode's two ports carry opposite signs, so which is which is part
     * of the node rather than of the array it sits in. Both are required, they
     * must differ, and each must be one of the node's own outputs — otherwise
     * the node declares a port no edge can legally leave from, and the failure
     * surfaces at execution rather than at save.
     */
    const deletionsOutput = await refs.resolve(
      at('deletionsOutput'), n.deletionsOutput, IO_REF);
    const additionsOutput = await refs.resolve(
      at('additionsOutput'), n.additionsOutput, IO_REF);

    for (const [field, value] of [
      ['deletionsOutput', deletionsOutput],
      ['additionsOutput', additionsOutput],
    ] as const) {
      if (!value) {
        if (n[field] === undefined || n[field] === null) {
          refs.fail(at(field), '', 'is required for a PatchNode');
        }
        continue;
      }
      if (!outputs.includes(value)) {
        refs.fail(at(field), value, 'is not one of the node\'s outputs');
      }
    }
    if (deletionsOutput && deletionsOutput === additionsOutput) {
      refs.fail(at('additionsOutput'), additionsOutput,
        'is the same port as deletionsOutput; the two halves of a patch need separate ports');
    }

    stage('PatchNode', toLdkit({
      $id: id,
      queryId: n.queryId,
      backendId,
      backendConfig: n.backendConfig,
      inputs,
      outputs,
      deletionsOutput,
      additionsOutput,
      '@type': 'PatchNode',
      nodeType,
    }) as AnyRecord & { $id: string });
    nodeIds.push(id);
  }

  const edgeIds: string[] = [];
  const endNodeInputIds = new Set<string>();

  for (const [i, e] of ((body.edges as AnyRecord[] | undefined) || []).entries()) {
    const at = (field: string) => `edges[${i}].${field}`;
    const id = ownId(e.id);
    const sourceNodeId = await refs.resolve(at('sourceNodeId'), e.sourceNodeId, NODE_REF);
    const targetNodeId = await refs.resolve(at('targetNodeId'), e.targetNodeId, NODE_REF);
    const sourceOutputId = await refs.resolve(at('sourceOutputId'), e.sourceOutputId, IO_REF);
    const targetInputId = await refs.resolve(at('targetInputId'), e.targetInputId, IO_REF);

    if (e.whenEmpty != null && !WHEN_EMPTY_MODES.includes(e.whenEmpty as WhenEmptyMode)) {
      refs.fail(
        at('whenEmpty'),
        String(e.whenEmpty),
        `is not one of ${WHEN_EMPTY_MODES.join(', ')}`,
      );
    }

    stage('QueryEdge', toLdkit({
      $id: id,
      sourceNodeId,
      targetNodeId,
      dataFlowType: e.dataFlowType,
      sourceOutputId,
      targetInputId,
      variableMappings: e.variableMappings,
      whenEmpty: e.whenEmpty,
      '@type': 'QueryEdge',
    }) as AnyRecord & { $id: string });
    edgeIds.push(id);

    if (targetNodeId === endNodeId && targetInputId) {
      endNodeInputIds.add(targetInputId);
    }
  }

  stage('EndNode', toLdkit({
    $id: endNodeId,
    inputs: Array.from(endNodeInputIds),
    mediaType: body.endNode?.mediaType ?? null,
    '@type': 'EndNode',
  }) as AnyRecord & { $id: string });

  // Nothing has been written yet, so this is a clean rejection.
  refs.throwIfFailed();

  /*
   * The second entities this body names, and what the caller is doing with
   * them: *running* them.
   *
   * The route guard checks the group being written. A node's `queryId` and a
   * RuleSetNode's `ruleSetVersion` are stored entities that need not live in
   * the group's library, and nothing looked at them — so Write on a library you
   * hold bought the execution of any other library's saved query or rule set,
   * through `POST /execute`, which requires Execute on the *group's* library
   * and says nothing about the legs.
   *
   * This is the pair `POST /tuple-sets/:id/versions/from-etl` and
   * `POST /data-graphs/:id/versions/from-query` already carry, and the pins
   * `ArgumentSetService.createVersion` checks, arriving through a fourth door
   * — the widest of them, since one group version composes arbitrarily many.
   *
   * `execute`, not `read`, and for the reason `from-query` gives: this is not
   * copying stored data into a payload, it is committing that the query will be
   * run. Checked at composition rather than at execution because that is where
   * the other three check, and because binding the *author* is what lets a
   * library keep curating what its members may run — the same shape as
   * `allowedBackends` (design §4.3 route 2). A caller who may execute the group
   * later still runs these legs; what it may not do is put them there.
   *
   * After `throwIfFailed`, so a reference that resolves to nothing is still the
   * 422 it was and this speaks only about references that exist. The residual
   * signal — 403 rather than 422 says "this IRI is a version somewhere" — is
   * the one `from-query` carries, and is why the resolver's collapsing of
   * "missing" and "wrong type" into one reason matters.
   *
   * A node's `backendId` is deliberately *not* checked here: a backend is not
   * library-scoped, and `assertBackendAccess` checks it per leg at execution
   * with the group's library as `viaLibrary`, which is where curated access is
   * decided. Composing a group naming a backend the author cannot reach fails
   * when it runs, which is the existing answer and not this sweep's to change.
   */
  if (authScope) {
    for (const { field, reference } of composed) {
      const entity = cacheCoordinator.get(reference);
      try {
        requireLibraryMode(authScope.request, resolveOwningLibrary(entity), 'execute');
      } catch (error) {
        // Named, because a version may compose twenty legs in one request and
        // "execute is required" about an unnamed one of them is not actionable.
        // The field is the caller's own payload path, so it discloses nothing
        // the 403 does not already.
        if (error instanceof AuthorizationError) {
          throw new AuthorizationError(`${field} (${reference}): ${error.message}`, error.statusCode);
        }
        throw error;
      }
    }
  }

  // ---------------------------------------------------------------- flush --

  for (const { type, payload } of staged) {
    await cacheCoordinator.create(type, payload as never);
  }

  // Computed here rather than at the top so the window between reading the
  // highest version and writing the new one is as small as it can be without a
  // store-side primitive. It does not close the race — see the plan's
  // out-of-scope notes.
  const existing = (cacheCoordinator.list('QueryGroupVersion') as LdkitQueryGroupVersion[])
    .filter(v => v.isPartOf === groupId);
  const nextVersion = existing.length > 0
    ? Math.max(...existing.map(v => Number(v.version))) + 1
    : 1;

  const versionId = mintId('groupVersion');
  const created = await cacheCoordinator.create('QueryGroupVersion', toLdkit({
    $id: versionId,
    '@type': 'QueryGroupVersion',
    isPartOf: groupId,
    version: nextVersion,
    // Frozen on create (issue #192). A version is a snapshot: what it holds is
    // what the reference to it means, so it is never created in a state where
    // it could still change. `immutable` on the request body is ignored rather
    // than honoured — there is no such thing as a mutable version.
    immutable: true,
    canvasData: body.canvasData,
    startNode: startNodeId,
    endNode: endNodeId,
    executionNodes: nodeIds,
    edges: edgeIds,
  }) as Partial<LdkitQueryGroupVersion> & { $id: string });

  await cacheCoordinator.update('QueryGroup', groupId, { currentVersion: versionId });

  return { created: (created ?? { $id: versionId }) as LdkitQueryGroupVersion, iriMap };
}
