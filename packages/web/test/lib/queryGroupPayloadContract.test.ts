import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { queryGroupVersionForGroupCreateSchema } from '@sparql-query-lib/contracts';
import type { QueryGroupVersionExpandedWithIriMap } from '@sparql-query-lib/contracts';
import {
  createGraphStateFromExpanded,
  graphStateToFlatPayload,
} from '../../src/composables/useQueryGroupGraph';
import { useQueryGroupGraphState } from '../../src/composables/useQueryGroupGraphState';
import { useQueryGroupIO } from '../../src/composables/useQueryGroupIO';

/**
 * The payload the canvas sends must satisfy the contract the API enforces
 * (issue #47, item 2).
 *
 * `queryGroupVersionForGroupCreateSchema` is `.strict()`, so an extra key is a
 * 400 and a missing one is a rejected save. Nothing on this side was checking
 * that: `packages/web` has no type checking, and the payload has broken twice
 * already - once when a stale built contracts package silently dropped
 * `nodeDetail`, and once when `variableMappings` was added and a cross-package
 * expectation went stale. Both were found by something other than the frontend.
 *
 * Generated rather than hand-written because the interesting failures are in
 * combinations - a node with no ports, an edge with no flow type, a start node
 * with several output tuples - and a fixture only ever covers the shape someone
 * thought of.
 */

const iri = (kind: string, n: number) => `urn:sqlib:${kind}:${n}`;

/** The two ports a patch node emits, named per node so no two nodes share one. */
const patchHalfIris = (index: number) => ({
  deletionsOutput: iri(`patch-deletions`, index),
  additionsOutput: iri(`patch-additions`, index),
});

/** One execution node plus the ports it owns. */
const nodeArb = (index: number) =>
  fc.record({
    hasInput: fc.boolean(),
    hasOutput: fc.boolean(),
    hasRdf: fc.boolean(),
    /*
     * `PatchNode` is generated alongside the others rather than fixtured
     * separately, because what a builder that lists fields drops is exactly the
     * field one node type has and the rest do not — and the two that make a
     * patch node one are only on it.
     */
    nodeType: fc.constantFrom('QueryNode', 'DynamicQueryNode', 'PatchNode'),
    // A node's backend is either a registered one or an ephemeral store,
    // never both — the writer rejects a payload naming the two (#297).
    isEphemeral: fc.boolean(),
  }).map(spec => {
    const isPatch = spec.nodeType === 'PatchNode';
    const halves = patchHalfIris(index);
    const inputs = spec.hasInput ? [iri('input-tuple', index)] : [];
    const outputs = isPatch
      ? [halves.deletionsOutput, halves.additionsOutput]
      : [
          ...(spec.hasOutput ? [iri('output-tuple', index)] : []),
          ...(spec.hasRdf ? [iri('triples-quads-io', index)] : []),
        ];
    return {
      id: iri('node', index),
      inputs,
      outputs,
      queryId: iri('query-version', index),
      backendId: spec.isEphemeral ? null : iri('backend', 1),
      backendConfig: spec.isEphemeral
        ? { type: 'ephemeral-oxigraph' as const, storeId: iri('store', index) }
        : null,
      nodeType: spec.nodeType,
      ...(isPatch ? halves : {}),
      dateCreated: null,
      dateModified: null,
    };
  });

const FLOW_TYPES = ['CONTROL_FLOW', 'VARIABLE_BINDINGS', 'RDF_GRAPH', 'BOOLEAN', 'QUERY_ID'] as const;

const expandedArb: fc.Arbitrary<QueryGroupVersionExpandedWithIriMap> = fc
  .record({
    nodeCount: fc.integer({ min: 1, max: 4 }),
    seeds: fc.array(nodeArb(0), { minLength: 4, maxLength: 4 }),
    edgeFlow: fc.array(fc.constantFrom(...FLOW_TYPES), { minLength: 4, maxLength: 4 }),
    startTupleCount: fc.integer({ min: 0, max: 2 }),
    mediaType: fc.constantFrom(null, 'application/n-triples', 'application/sparql-results+json'),
    whenEmpty: fc.constantFrom(null, 'unconstrained', 'propagateEmpty', 'require'),
    // A mapping is stored as JSON naming variables on both sides, so an edge
    // either has one or has none — the malformed cases belong to the command
    // layer, which is where a mapping is written.
    variableMappings: fc.constantFrom(
      null,
      '[{"source":"city","target":"city"}]',
      '[{"source":"city","target":"place"},{"source":"country","target":"region"}]',
    ),
  })
  .map(spec => {
    // Re-key the pre-generated node shapes so ids line up with their index.
    const nodes = spec.seeds.slice(0, spec.nodeCount).map((seed, index) => {
      const halves = patchHalfIris(index);
      return {
        ...seed,
        id: iri('node', index),
        inputs: seed.inputs.map(() => iri('input-tuple', index)),
        // A patch node's two outputs are re-keyed by role rather than by kind:
        // both are TriplesQuadsIO, and collapsing them onto one id would give
        // the node a single port used twice, which the writer refuses.
        outputs: seed.nodeType === 'PatchNode'
          ? [halves.deletionsOutput, halves.additionsOutput]
          : seed.outputs.map(port =>
              port.includes('triples') ? iri('triples-quads-io', index) : iri('output-tuple', index)),
        queryId: iri('query-version', index),
        ...(seed.nodeType === 'PatchNode' ? halves : {}),
      };
    });

    const startOutputs = Array.from({ length: spec.startTupleCount }, (_, i) => iri('output-tuple-external', i));
    const edges = nodes.map((node, index) => ({
      id: iri('edge', index),
      sourceNodeId: index === 0 ? iri('startnode', 1) : iri('node', index - 1),
      targetNodeId: node.id,
      dataFlowType: spec.edgeFlow[index],
      sourceOutputId: null,
      targetInputId: null,
      whenEmpty: spec.whenEmpty,
      variableMappings: spec.variableMappings,
      dateCreated: null,
      dateModified: null,
    }));

    const inputTuples = nodes
      .filter(node => node.inputs.length)
      .map(node => ({ id: node.inputs[0], name: 'params', memberEntries: [], dateCreated: null, dateModified: null }));
    const outputTuples = [
      ...nodes.flatMap(node => node.outputs.filter(p => p.includes('output-tuple'))),
      ...startOutputs,
    ].map(id => ({ id, name: 'rows', memberEntries: [], dateCreated: null, dateModified: null }));

    return {
      queryGroupVersion: {
        id: iri('group-version', 1),
        version: 1,
        startNode: iri('startnode', 1),
        endNode: iri('endnode', 1),
        executionNodes: nodes.map(node => node.id),
        edges: edges.map(edge => edge.id),
        canvasData: null,
        comment: null,
        dateCreated: null,
        dateModified: null,
        isPartOf: iri('group', 1),
      },
      executionNodes: nodes,
      startNode: { id: iri('startnode', 1), outputs: startOutputs, dateCreated: null, dateModified: null },
      endNode: {
        id: iri('endnode', 1),
        inputs: nodes.at(-1)?.outputs ?? [],
        mediaType: spec.mediaType,
        dateCreated: null,
        dateModified: null,
      },
      edges,
      inputTuples,
      outputTuples,
      tupleMembers: [],
      inputs: [],
      outputs: [],
      rdfOutputs: nodes
        .flatMap(node => node.outputs.filter(p => p.includes('triples') || p.includes('patch-')))
        .map(id => ({ id, name: 'rdf', dateCreated: null, dateModified: null })),
      iriMap: {},
    } as unknown as QueryGroupVersionExpandedWithIriMap;
  });

const noopToast = { success: () => {}, error: () => {}, info: () => {}, warning: () => {} };
const quietLogger = { debug: () => {}, error: () => {} };

describe('query group create payload honours the API contract', () => {
  it('builds a payload the contracts schema accepts, for any loaded graph', () => {
    fc.assert(
      fc.property(expandedArb, expanded => {
        const graph = useQueryGroupGraphState({
          initialGraphState: createGraphStateFromExpanded(expanded),
        });
        const io = useQueryGroupIO({ graph, toast: noopToast, logger: quietLogger });

        const payload = io.buildVersionCreatePayload({ versionComment: null });
        const parsed = queryGroupVersionForGroupCreateSchema.safeParse(payload);

        expect(
          parsed.success ? null : JSON.stringify(parsed.error.issues.slice(0, 4)),
          'payload rejected by the contract the API enforces',
        ).toBeNull();
      }),
      { numRuns: 60, seed: 20260731 },
    );
  });

  /*
   * Issue #301. The editor had no model of `backendConfig` in either
   * direction, so a "Save v2" from the canvas sent nodes without it: the new
   * version persisted `undefined`, and the group that ran before the save
   * stopped running after it, with nothing in the user's own diff to explain
   * why. Loading and re-saving must be a no-op for this field.
   */
  it('carries every ephemeral backendConfig from the loaded graph into the payload', () => {
    /** The fields these assertions read, the same on the loaded and sent sides. */
    type NodeBackend = {
      id: string;
      backendId?: string | null;
      backendConfig?: { type: string; storeId: string } | null;
    };

    fc.assert(
      fc.property(expandedArb, expanded => {
        const graph = useQueryGroupGraphState({
          initialGraphState: createGraphStateFromExpanded(expanded),
        });
        const io = useQueryGroupIO({ graph, toast: noopToast, logger: quietLogger });
        const payload = io.buildVersionCreatePayload({ versionComment: null }) as {
          executionNodes?: NodeBackend[];
        };

        const sentById = new Map<string, NodeBackend>(
          (payload.executionNodes ?? []).map(node => [node.id, node]),
        );
        const loadedNodes = (expanded as unknown as { executionNodes?: NodeBackend[] })
          .executionNodes ?? [];

        for (const loaded of loadedNodes) {
          const sent = sentById.get(loaded.id);
          if (!sent) continue;
          expect(sent.backendConfig ?? null, `node ${loaded.id} lost its backendConfig`)
            .toEqual(loaded.backendConfig ?? null);
          // The two are exclusive: sending both is a 400 from the writer.
          if (sent.backendConfig) {
            expect(sent.backendId ?? null, `node ${loaded.id} sent a backend beside its store`)
              .toBeNull();
          }
        }
      }),
      { numRuns: 60, seed: 20260731 },
    );
  });

  /*
   * The third instance of the same shape, and the one that fails loudest. A
   * patch node's two halves are opposite facts distinguishable only by which
   * port they left through, so the writer requires both by name and refuses a
   * payload missing either. A builder that dropped them would not silently save
   * the wrong thing — it would make a patch node unsavable from the canvas,
   * which is the state the API half shipped in (#290).
   */
  it('carries both halves of every patch node from the loaded graph into the payload', () => {
    type PatchNode = {
      id: string;
      nodeType?: string;
      outputs?: string[];
      deletionsOutput?: string | null;
      additionsOutput?: string | null;
    };

    let sawAPatchNode = false;

    fc.assert(
      fc.property(expandedArb, expanded => {
        const graph = useQueryGroupGraphState({
          initialGraphState: createGraphStateFromExpanded(expanded),
        });
        const io = useQueryGroupIO({ graph, toast: noopToast, logger: quietLogger });
        const payload = io.buildVersionCreatePayload({ versionComment: null }) as {
          executionNodes?: PatchNode[];
        };

        const sentById = new Map<string, PatchNode>((payload.executionNodes ?? []).map(node => [node.id, node]));
        const loadedNodes = (expanded as unknown as { executionNodes?: PatchNode[] }).executionNodes ?? [];

        for (const loaded of loadedNodes) {
          if (loaded.nodeType !== 'PatchNode') continue;
          sawAPatchNode = true;
          const sent = sentById.get(loaded.id);
          expect(sent, `patch node ${loaded.id} was not sent at all`).toBeDefined();
          // Sent back as what it is. Carried over as a QueryNode the server
          // would refuse it, and a server that did not would run the update.
          expect(sent?.nodeType, `patch node ${loaded.id} changed type on the way out`).toBe('PatchNode');
          expect(sent?.deletionsOutput ?? null, `patch node ${loaded.id} lost its deletions half`)
            .toEqual(loaded.deletionsOutput ?? null);
          expect(sent?.additionsOutput ?? null, `patch node ${loaded.id} lost its additions half`)
            .toEqual(loaded.additionsOutput ?? null);
          // Each half has to be one of the node's own outputs, or the writer
          // refuses it as a port no edge could legally leave from.
          for (const half of [sent?.deletionsOutput, sent?.additionsOutput]) {
            expect(sent?.outputs ?? [], `patch node ${loaded.id} names a half it does not declare`)
              .toContain(half);
          }
          expect(sent?.deletionsOutput, `patch node ${loaded.id} used one port for both halves`)
            .not.toBe(sent?.additionsOutput);
        }
      }),
      { numRuns: 60, seed: 20260731 },
    );

    // A property that never met its subject passes vacuously.
    expect(sawAPatchNode, 'no generated graph contained a patch node').toBe(true);
  });

  /*
   * The same shape of loss as #301, on an edge rather than a node: the canvas
   * has a grid for choosing which of the source's variables feeds which of the
   * target's, `graphStateToFlatPayload` carries the result, the draft schema
   * accepts it and QueryEdgeSchema persists it — but the version payload was
   * built without it, so every mapping an author chose was dropped at the save,
   * and re-saving a group that already had one dropped that too.
   */
  it('carries every edge variable mapping from the loaded graph into the payload', () => {
    type EdgeMapping = { id: string; variableMappings?: string | null };

    fc.assert(
      fc.property(expandedArb, expanded => {
        const graph = useQueryGroupGraphState({
          initialGraphState: createGraphStateFromExpanded(expanded),
        });
        const io = useQueryGroupIO({ graph, toast: noopToast, logger: quietLogger });
        const payload = io.buildVersionCreatePayload({ versionComment: null }) as {
          edges?: EdgeMapping[];
        };

        const sentById = new Map<string, EdgeMapping>((payload.edges ?? []).map(edge => [edge.id, edge]));
        for (const loaded of (expanded as unknown as { edges?: EdgeMapping[] }).edges ?? []) {
          const sent = sentById.get(loaded.id);
          if (!sent) continue;
          expect(sent.variableMappings ?? null, `edge ${loaded.id} lost its variable mapping`)
            .toEqual(loaded.variableMappings ?? null);
        }
      }),
      { numRuns: 60, seed: 20260731 },
    );
  });

  it('never emits a temporary id the writer cannot resolve', () => {
    // The writer mints permanent IRIs for `urn:ui-temp:` ids and leaves anything
    // else alone, so a bare local id would be persisted verbatim and dangle.
    fc.assert(
      fc.property(expandedArb, expanded => {
        const graph = useQueryGroupGraphState({
          initialGraphState: createGraphStateFromExpanded(expanded),
        });
        const io = useQueryGroupIO({ graph, toast: noopToast, logger: quietLogger });
        const payload = io.buildVersionCreatePayload({ versionComment: null }) as Record<string, any>;

        const ids: string[] = [];
        for (const key of ['executionNodes', 'edges', 'inputTuples', 'outputTuples', 'tupleMembers', 'inputs', 'outputs']) {
          for (const entity of payload[key] ?? []) if (entity?.id) ids.push(entity.id);
        }
        for (const id of ids) {
          expect(id.startsWith('urn:'), `id "${id}" is not a URN`).toBe(true);
        }
      }),
      { numRuns: 40, seed: 20260731 },
    );
  });

  it('accepts every whenEmpty policy on an edge', () => {
    // Regression. `whenEmpty` landed on QueryEdge in a23dc78 and the canvas grew
    // a control for it in 8a37b97, but it was never added to the contracts edge
    // draft schema — which is `.strict()`, and which the client validates
    // against *before* sending. Setting any policy therefore failed the whole
    // save with "Unrecognized key: whenEmpty" rather than dropping the field.
    for (const whenEmpty of ['unconstrained', 'propagateEmpty', 'require', null] as const) {
      const payload = {
        queryGroupVersion: {},
        edges: [{
          id: 'urn:ui-temp:edge-1',
          sourceNodeId: 'urn:__START__',
          targetNodeId: 'urn:ui-temp:node-1',
          dataFlowType: 'VARIABLE_BINDINGS',
          whenEmpty,
        }],
      };
      const parsed = queryGroupVersionForGroupCreateSchema.safeParse(payload);
      expect(
        parsed.success ? null : JSON.stringify(parsed.error.issues),
        `whenEmpty=${whenEmpty} rejected`,
      ).toBeNull();
    }
  });

  it('still rejects a whenEmpty value the engine does not implement', () => {
    // The point of the enum is that a typo fails here rather than being written
    // to the store and silently ignored at execution time.
    const parsed = queryGroupVersionForGroupCreateSchema.safeParse({
      queryGroupVersion: {},
      edges: [{ id: 'urn:ui-temp:e', dataFlowType: 'VARIABLE_BINDINGS', whenEmpty: 'sometimes' }],
    });
    expect(parsed.success).toBe(false);
  });

  it('round-trips an expanded version through graph state without losing edges or nodes', () => {
    fc.assert(
      fc.property(expandedArb, expanded => {
        const state = createGraphStateFromExpanded(expanded);
        const flat = graphStateToFlatPayload(state);

        // Every execution node survives; start and end are boundary nodes and
        // are carried separately rather than in executionNodes.
        expect(flat.executionNodes).toHaveLength(expanded.executionNodes!.length);
        expect(flat.edges).toHaveLength(expanded.edges!.length);

        // Flow type is what decides how the engine treats an edge, so it must
        // survive the trip verbatim rather than being defaulted.
        const flowByEdgeId = new Map(flat.edges.map((edge: any) => [edge.id, edge.dataFlowType]));
        for (const edge of expanded.edges as any[]) {
          expect(flowByEdgeId.get(edge.id)).toBe(edge.dataFlowType);
        }
      }),
      { numRuns: 60, seed: 20260731 },
    );
  });
});
