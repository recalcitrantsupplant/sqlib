import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  GroupHarness, START, END,
  type DeclaredPort, type EdgeSpec, type FlowType, type GraphSpec, type NodeSpec, type PortRef,
} from './harness/group-harness.js';
import { getTemplate, queryIdSelect } from './harness/query-templates.js';

/**
 * Phase 2 Layer A: the legality matrix (docs §2.2).
 *
 * Enumerates every (source node type / query type) x (edge flow type) x (target
 * node type) combination and asserts that the three things that are supposed to
 * agree actually do:
 *
 *   1. `GraphBuilder.validateGraph` accepts or rejects it,
 *   2. `GET .../validate` reports the same verdict with a typed `code` and the
 *      IRI of the entity actually at fault,
 *   3. `POST /execute` succeeds, or refuses with a 4xx rather than a 500.
 *
 * The wiring rule is deliberate and worth stating, because it is what makes the
 * cells meaningful rather than arbitrary: **the source contributes its natural
 * port, the target contributes the port the flow type requires.** So the cell
 * "CONSTRUCT x VARIABLE_BINDINGS x QueryNode" asks the real question - can a
 * node that produces RDF feed a bindings edge? - instead of quietly attaching a
 * QueryOutputTuple to a CONSTRUCT node and testing nothing.
 *
 * The edge under test is always first in the payload, because `validateGraph`
 * throws on the first failure and edges are checked in declaration order.
 */

import {
  SOURCE_KINDS, TARGET_KINDS, SOURCE_PORT_TYPE, FLOW_TARGET_PORT_TYPE, expectationFor,
  type SourceKind, type TargetKind,
} from './harness/legality-expectations.js';

const FLOW_TYPES: FlowType[] = ['CONTROL_FLOW', 'VARIABLE_BINDINGS', 'RDF_GRAPH', 'BOOLEAN', 'QUERY_ID'];

const SOURCE_QUERY: Record<Exclude<SourceKind, 'ruleset' | 'start'>, string> = {
  select: 'things',
  construct: 'constructThings',
  describe: 'describeThings',
  ask: 'askThings',
  update: 'updateScratch',
  dynamic: 'things',
};

type PortType = (typeof SOURCE_PORT_TYPE)[SourceKind];

describe('Phase 2 legality matrix', () => {
  let harness: GroupHarness;
  let dynamicTargetVersionId: string;

  beforeAll(async () => {
    harness = await GroupHarness.create('phase2-matrix');
    for (const key of ['things', 'constructThings', 'describeThings', 'askThings', 'updateScratch', 'thingByThing', 'echoThing']) {
      await harness.defineQuery(key, getTemplate(key).sparql);
    }
    // A QUERY_ID edge demands a single row carrying a QueryVersion IRI, so the
    // generic `things` source cannot stand in for it: with four rows the cell
    // would only ever prove that the arity check fires.
    dynamicTargetVersionId = harness.queryHandle('things').versionId;
    await harness.defineQuery('queryIdPointer', queryIdSelect(dynamicTargetVersionId));
    // Identity ruleset: enough for a RuleSetNode to be a real node with a real
    // RuleSetVersion behind it. Inference itself is exercised separately.
    await harness.defineRuleSet('identity', []);
  }, 120000);

  afterAll(async () => {
    await harness.destroy();
  });

  /** Assemble the graph for one cell. */
  const buildSpec = (source: SourceKind, flow: FlowType, target: TargetKind): GraphSpec => {
    const nodes: NodeSpec[] = [];
    const declaredPorts: DeclaredPort[] = [];
    const edges: EdgeSpec[] = [];

    const sourceKey = source === 'start' ? START : 'src';
    const targetKey = target === 'end' ? END : 'tgt';

    // --- source node and its natural port ---
    let sourcePort: PortRef | undefined;
    if (source === 'start') {
      declaredPorts.push({ key: 'startOut', type: 'QueryOutputTuple', vars: ['thing'], attachTo: START, attachAs: 'outputs' });
      sourcePort = { declared: 'startOut' };
    } else if (source === 'ruleset') {
      nodes.push({ key: 'src', kind: 'RuleSetNode', ruleSet: 'identity' });
      declaredPorts.push({ key: 'srcRdf', type: 'TriplesQuadsIO', attachTo: 'src', attachAs: 'outputs' });
      sourcePort = { declared: 'srcRdf' };
    } else {
      const usesQueryIdPointer = flow === 'QUERY_ID' && SOURCE_PORT_TYPE[source] === 'QueryOutputTuple';
      nodes.push({
        key: 'src',
        query: usesQueryIdPointer ? 'queryIdPointer' : SOURCE_QUERY[source],
        kind: source === 'dynamic' ? 'DynamicQueryNode' : 'QueryNode',
      });
      const portType = SOURCE_PORT_TYPE[source];
      if (portType === 'QueryOutputTuple') sourcePort = { node: 'src', port: 'outputTuple' };
      else if (portType === 'TriplesQuadsIO') sourcePort = { node: 'src', port: 'rdf' };
      else if (portType === 'BooleanIO') sourcePort = { node: 'src', port: 'boolean' };
    }

    // --- target node and the port the flow demands of it ---
    let targetPort: PortRef | undefined;
    if (target === 'end') {
      // Pass-through: the EndNode reuses the source's port id.
      targetPort = sourcePort;
    } else {
      if (target === 'ruleset') {
        nodes.push({ key: 'tgt', kind: 'RuleSetNode', ruleSet: 'identity' });
        declaredPorts.push({ key: 'tgtRdfOut', type: 'TriplesQuadsIO', attachTo: 'tgt', attachAs: 'outputs' });
      } else {
        // `echoThing` projects its parameter straight back out, so whatever the
        // upstream supplies is observable in the final result.
        nodes.push({ key: 'tgt', query: 'echoThing', kind: target === 'dynamic' ? 'DynamicQueryNode' : 'QueryNode' });
      }

      if (flow !== 'CONTROL_FLOW') {
        const required = FLOW_TARGET_PORT_TYPE[flow];
        if (required === 'QueryInputTuple' && target !== 'ruleset') {
          targetPort = { node: 'tgt', input: 0 };
        } else {
          declaredPorts.push({ key: 'tgtIn', type: required as DeclaredPort['type'], vars: ['thing'], attachTo: 'tgt', attachAs: 'inputs' });
          targetPort = { declared: 'tgtIn' };
        }
      }
    }

    // The edge under test goes first: validateGraph throws on the first failure.
    edges.push({
      from: sourceKey,
      to: targetKey,
      flow,
      id: 'urn:ui-temp:edge-under-test',
      ...(flow === 'CONTROL_FLOW' ? {} : { source: sourcePort, target: targetPort }),
    });

    // Entry edge, so the source is reachable.
    if (source !== 'start') {
      edges.push({ from: START, to: 'src', flow: 'CONTROL_FLOW', id: 'urn:ui-temp:edge-entry' });
    }

    // Exit edge, so the graph terminates in something the EndNode can return.
    if (target !== 'end') {
      if (target === 'ruleset') {
        edges.push({
          from: 'tgt', to: END, flow: 'RDF_GRAPH', id: 'urn:ui-temp:edge-exit',
          source: { declared: 'tgtRdfOut' }, target: { declared: 'tgtRdfOut' },
        });
      } else {
        edges.push({
          from: 'tgt', to: END, flow: 'VARIABLE_BINDINGS', id: 'urn:ui-temp:edge-exit',
          source: { node: 'tgt', port: 'outputTuple' }, target: { node: 'tgt', port: 'outputTuple' },
        });
      }
    }

    return {
      nodes,
      edges,
      declaredPorts,
      endNodeMediaType: target === 'ruleset' || (target === 'end' && SOURCE_PORT_TYPE[source] === 'TriplesQuadsIO')
        ? 'application/n-triples'
        : 'application/sparql-results+json',
    };
  };

  const cells = SOURCE_KINDS.flatMap(source =>
    FLOW_TYPES.flatMap(flow =>
      TARGET_KINDS.map(target => ({ source, flow, target, expected: expectationFor(source, flow, target) })),
    ),
  );

  for (const cell of cells) {
    const name = `${cell.source} --${cell.flow}--> ${cell.target}`;
    const verdict = cell.expected.code === null ? 'is legal' : `is rejected with ${cell.expected.code}`;

    it(`${name} ${verdict}`, async () => {
      const spec = buildSpec(cell.source, cell.flow, cell.target);
      const { built, response } = await harness.tryBuild(spec, `matrix ${name}`);

      // Nothing in the matrix should be refused by the route schema or the
      // writer: these are structural graph questions, and the graph validator is
      // where they belong.
      expect(built, `create rejected: ${response.statusCode} ${response.payload}`).not.toBeNull();

      const validation = await harness.validate(built!);
      // A QUERY_ID edge out of the StartNode means "the caller picks the query",
      // so the caller has to actually pick one for the run to be meaningful.
      const externalQueryId = cell.source === 'start' && cell.flow === 'QUERY_ID'
        ? [{ head: { vars: ['thing'] }, arguments: { bindings: [{ thing: { type: 'uri', value: dynamicTargetVersionId } }] } }]
        : undefined;
      const execution = await harness.execute(built!, { arguments: externalQueryId });

      if (cell.expected.code === null) {
        expect(validation.errors, `${name} should validate`).toEqual([]);
        expect(validation.valid).toBe(true);
        expect(
          execution.statusCode,
          `${name} validated but execution said ${execution.statusCode}: ${execution.payload.slice(0, 400)}`,
        ).toBe(200);
        return;
      }

      expect(validation.valid, `${name} should be rejected`).toBe(false);
      const issue = validation.issues.find(i => i.code === cell.expected.code);
      expect(
        issue,
        `${name} expected code ${cell.expected.code}, got ${JSON.stringify(validation.issues.map(i => i.code))}`,
      ).toBeDefined();

      const expectedEntity = cell.expected.at === 'graph' ? null
        : cell.expected.at === 'edge' ? built!.edgeIris['urn:ui-temp:edge-under-test']
        : cell.expected.at === 'sourceNode' ? built!.nodeIris[cell.source === 'start' ? START : 'src']
        : built!.nodeIris[cell.target === 'end' ? END : 'tgt'];
      expect(issue!.entityId, `${name} pointed at the wrong entity`).toBe(expectedEntity);

      // Validator and executor must agree: a graph the validator refuses must
      // not reach the endpoint, and must fail as a client error rather than a
      // 500 that looks like the server broke.
      expect(execution.statusCode, `${name} should not execute`).toBeGreaterThanOrEqual(400);
      expect(execution.statusCode, `${name} failed as a server error`).toBeLessThan(500);
    }, 30000);
  }
});
