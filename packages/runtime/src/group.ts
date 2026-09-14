/**
 * Walking an exported query group: the same splice, one node at a time.
 *
 * A group is a DAG of queries where an upstream SELECT's rows become a
 * downstream query's `VALUES` block. That is the substitution this package
 * already does — the only thing a group adds is *where the rows come from*: an
 * argument set the caller supplied, or the result of a node that ran a moment
 * ago. So the walker is a topological order, a per-node argument assembly, and
 * the executor the queries were already going to use.
 *
 * What is deliberately absent is everything the server's `ExecutionEngine` does
 * that needs a store: RDF chaining (CONSTRUCT/DESCRIBE into another node),
 * boolean inputs, rule set and ETL nodes, dynamic query selection. Those need a
 * local store to materialise into, which is `@sparql-query-lib/runtime-oxigraph`
 * territory, and the export refuses to carry a group that uses them rather than
 * letting one run differently here than it does on the server
 * (see docs/guides/static-export.md).
 *
 * Two behaviours worth stating, because they are choices rather than
 * consequences:
 *
 * - **Every node runs**, in topological order, not only the ancestors of the
 *   result node. That is what the server does, and a group whose branch feeds
 *   nothing is a question for the author rather than something to silently
 *   optimise away.
 * - **External arguments are matched by the variables they bind**, against the
 *   slots no edge fills — the same rule the server applies to a group run's
 *   payload. A group's start node ports are therefore not modelled here: the
 *   caller names the *slot's* variables, which is what a bundle can check.
 */

import type { WireArgumentSet } from './arguments.js';
import type { ExportedGroup, ExportedGroupEdge, ExportedQuery } from './bundle.js';
import { QueryCallError } from './errors.js';
import type { ExecutionResult, SparqlSelectResults } from './executor.js';
import { toExecutionParameters, type ExecutionParameter } from './limit-offset.js';
import type { EmptyArgumentMode } from './query-template.js';
import type { TermValue } from './sparql-terms.js';
import type { ParameterInput, QueryHandle } from './library.js';

/**
 * A group call.
 *
 * Argument sets are the full wire form — `head.vars` included — because a group
 * has more than one slot to fill and the variables are how a set finds its slot.
 * `limits` and `offsets` are offered to every node and taken by the ones that
 * declare the name, exactly as a group run through the API does it.
 */
export interface GroupCallPayload {
  arguments?: readonly WireArgumentSet[];
  limits?: ParameterInput;
  offsets?: ParameterInput;
  signal?: AbortSignal;
}

/** What a walk produced, node by node. */
export interface GroupRunResult {
  /** The result node's result: the group's answer. */
  result: ExecutionResult;
  /** Every node's result, keyed by node. */
  nodes: Record<string, ExecutionResult>;
  /**
   * The query each node actually ran, keyed by node.
   *
   * This is the seam the contract tests use: it is exactly what the server
   * would have dispatched for the same payload, so the two paths can be
   * compared without an endpoint.
   */
  texts: Record<string, string>;
}

/** One slot of one node that no edge fills: the caller has to supply it. */
export interface GroupExternalInput {
  node: string;
  /** The slot's variables, in the order an argument set must declare them. */
  vars: string[];
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((name, index) => name === b[index]);
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((name, index) => name === right[index]);
}

/**
 * A canonical key for a row, so two edges feeding one slot can be unioned.
 *
 * Sorted by variable and spelled out term by term, because rows are assembled
 * in each edge's own mapping order: an order-sensitive key would leave
 * duplicates in, which is what the server's `unionBindings` guards against.
 */
function rowKey(row: Record<string, TermValue | undefined>): string {
  return JSON.stringify(
    Object.keys(row)
      .sort()
      .map((name) => {
        const term = row[name];
        return [name, term?.type, term?.value, term?.datatype ?? null, term?.['xml:lang'] ?? null];
      }),
  );
}

function asSelectResults(result: ExecutionResult, from: string, to: string): SparqlSelectResults {
  const candidate = result as SparqlSelectResults;
  if (!candidate || !candidate.results || !Array.isArray(candidate.results.bindings)) {
    throw new QueryCallError(
      `Node '${from}' produced no rows to chain into '${to}': a chaining edge needs SELECT results.`,
    );
  }
  return candidate;
}

/** An exported group, bound to the bundle's queries and their executor. */
export class GroupHandle {
  private readonly order: string[];

  constructor(
    readonly name: string,
    private readonly group: ExportedGroup,
    private readonly queries: (key: string) => QueryHandle,
  ) {
    this.order = topologicalOrder(group);
  }

  /** The node whose result the group returns. */
  get resultNode(): string {
    return this.group.resultNode;
  }

  /** Node keys, in the order a run executes them. */
  nodes(): string[] {
    return [...this.order];
  }

  /** The query a node runs, as its key in the bundle. */
  queryOf(node: string): string {
    const entry = this.group.nodes[node];
    if (!entry) {
      throw new QueryCallError(
        `Group '${this.name}' has no node named '${node}'. Nodes: ${this.order.join(', ')}.`,
      );
    }
    return entry.query;
  }

  /**
   * The group's call signature: the slots a caller has to fill, and the page
   * parameters any of its nodes will accept.
   *
   * A slot appears here when no edge fills it. Two nodes declaring the same
   * variables produce two entries and one argument set fills both — the server
   * hands a group run's payload to every node, and this says the same thing.
   */
  signature(): {
    inputs: GroupExternalInput[];
    limitParameters: string[];
    offsetParameters: string[];
  } {
    const inputs: GroupExternalInput[] = [];
    const limitParameters = new Set<string>();
    const offsetParameters = new Set<string>();

    for (const node of this.order) {
      const query = this.queryFor(node);
      for (const name of query.limitParameters) limitParameters.add(name);
      for (const name of query.offsetParameters) offsetParameters.add(name);
      for (const slot of this.unfilledSlots(node, query)) {
        inputs.push({ node, vars: [...slot] });
      }
    }

    return {
      inputs,
      limitParameters: [...limitParameters],
      offsetParameters: [...offsetParameters],
    };
  }

  /** Walk the group, returning the result node's result. */
  async run(payload: GroupCallPayload = {}): Promise<ExecutionResult> {
    return (await this.runDetailed(payload)).result;
  }

  /** Walk the group, keeping every node's result and the query it ran. */
  async runDetailed(payload: GroupCallPayload = {}): Promise<GroupRunResult> {
    // Left in the wire shape: `QueryHandle.text` normalises the nulls a grid
    // round-trip leaves behind, and doing it here as well would only mean two
    // passes over the same rows.
    const external = payload.arguments ?? [];
    external.forEach((set, index) => {
      if (!set?.head || !Array.isArray(set.head.vars)) {
        throw new QueryCallError(
          `Argument set ${index} for group '${this.name}' declares no head.vars. A group has more than one slot to fill, so its arguments say which variables they bind.`,
        );
      }
    });

    const limits = toExecutionParameters(payload.limits);
    const offsets = toExecutionParameters(payload.offsets);

    const results: Record<string, ExecutionResult> = {};
    const texts: Record<string, string> = {};

    for (const node of this.order) {
      const query = this.queryFor(node);
      const handle = this.queries(this.group.nodes[node].query);
      const call = {
        arguments: this.argumentsFor(node, query, results, external),
        limits: forQuery(limits, query.limitParameters),
        offsets: forQuery(offsets, query.offsetParameters),
        signal: payload.signal,
      };
      // Substituted once: the text is both what is kept and what is sent.
      const text = handle.text(call);
      texts[node] = text;
      results[node] = await handle.runText(text, payload.signal);
    }

    return { result: results[this.group.resultNode], nodes: results, texts };
  }

  private queryFor(node: string): ExportedQuery {
    return this.queries(this.group.nodes[node].query).exported;
  }

  /** Inbound chaining edges, in export order. */
  private inboundEdges(node: string): ExportedGroupEdge[] {
    return this.group.edges.filter((edge) => edge.to === node);
  }

  /**
   * The slots of a node that no edge fills, in slot order.
   *
   * A signature can be claimed only once: two slots binding the same variables
   * are interchangeable, so the first takes the edges that name it and the
   * second falls to the caller, which is the only reading that lets a group ask
   * for both.
   */
  private unfilledSlots(node: string, query: ExportedQuery): string[][] {
    const inbound = this.inboundEdges(node);
    const claimed = new Set<string>();
    const unfilled: string[][] = [];
    for (const slot of query.template.slots) {
      const key = slot.vars.join(' ');
      const fed = !claimed.has(key) && inbound.some((edge) => sameOrder(edge.targetVars, slot.vars));
      if (fed) claimed.add(key);
      else unfilled.push([...slot.vars]);
    }
    return unfilled;
  }

  /** Assemble one node's argument sets, slot by slot, in slot order. */
  private argumentsFor(
    node: string,
    query: ExportedQuery,
    results: Record<string, ExecutionResult>,
    external: readonly WireArgumentSet[],
  ): WireArgumentSet[] {
    const inbound = this.inboundEdges(node);
    const claimed = new Set<string>();

    return query.template.slots.map((slot) => {
      const key = slot.vars.join(' ');
      const edges = claimed.has(key)
        ? []
        : inbound.filter((edge) => sameOrder(edge.targetVars, slot.vars));
      if (edges.length > 0) {
        claimed.add(key);
        return this.chainedArgumentSet(node, slot.vars, edges, results);
      }
      return externalArgumentSet(node, slot.vars, external);
    });
  }

  /** One slot's rows, mapped and unioned across every edge that fills it. */
  private chainedArgumentSet(
    node: string,
    vars: readonly string[],
    edges: readonly ExportedGroupEdge[],
    results: Record<string, ExecutionResult>,
  ): WireArgumentSet {
    const seen = new Set<string>();
    const bindings: Array<Record<string, TermValue>> = [];

    for (const edge of edges) {
      const upstream = results[edge.from];
      if (upstream === undefined) {
        // The topological order guarantees this cannot happen; if it ever does,
        // splicing an empty block would quietly answer with the wrong rows.
        throw new QueryCallError(
          `Group '${this.name}' reached node '${node}' before '${edge.from}', which feeds it.`,
        );
      }
      for (const row of asSelectResults(upstream, edge.from, node).results.bindings) {
        const mapped: Record<string, TermValue> = {};
        for (const { source, target } of edge.mappings) {
          const term = row[source];
          // An unbound upstream cell leaves the target unbound: UNDEF, not an
          // error. A blank node cannot be written into a VALUES block at all.
          if (!term) continue;
          if (term.type !== 'uri' && term.type !== 'literal') {
            throw new QueryCallError(
              `Node '${edge.from}' bound ?${source} to a ${term.type}, which cannot be chained into '${node}'.`,
            );
          }
          mapped[target] = term;
        }
        const key = rowKey(mapped);
        if (seen.has(key)) continue;
        seen.add(key);
        bindings.push(mapped);
      }
    }

    // The first edge with a stated policy decides, matching the server's
    // "whichever inbound edge feeds this slot" rule. Unstated leaves the
    // default in place: an empty upstream propagates as an empty block.
    const whenEmpty = edges.find((edge) => edge.whenEmpty !== undefined)?.whenEmpty;

    return {
      head: { vars: [...vars] },
      arguments: { bindings },
      ...(whenEmpty !== undefined ? { whenEmpty } : {}),
    };
  }
}

/**
 * The caller's set for a slot no edge fills, or an unconstrained empty one.
 *
 * Matched on the variables in order, and a same-variables-different-order set is
 * an error rather than a near miss — both are what a group run through the API
 * does, and the whole point of the export is that the two agree.
 */
function externalArgumentSet(
  node: string,
  vars: readonly string[],
  external: readonly WireArgumentSet[],
): WireArgumentSet {
  const supplied = external.find((set) => sameOrder(set.head.vars, vars));
  if (supplied) return supplied;

  const misordered = external.find((set) => sameSet(set.head.vars, vars));
  if (misordered) {
    throw new QueryCallError(
      `Argument variable order mismatch for node '${node}': it declares [${vars.join(', ')}], the payload provides [${misordered.head.vars.join(', ')}].`,
    );
  }

  // Nothing arrived for this slot. An absent external parameter runs open, which
  // is the same default the API applies.
  return {
    head: { vars: [...vars] },
    arguments: { bindings: [] },
    whenEmpty: 'unconstrained' satisfies EmptyArgumentMode,
  };
}

/** Page parameters a given query declares — the rest are not its business. */
function forQuery(
  parameters: ExecutionParameter[],
  declared: readonly string[],
): ExecutionParameter[] {
  if (parameters.length === 0 || declared.length === 0) return [];
  const names = new Set(declared);
  return parameters.filter((parameter) => names.has(parameter.name));
}

/**
 * Nodes in execution order.
 *
 * Ties broken alphabetically so a group runs its nodes in the same order every
 * time, whatever order the export happened to write them in — a run that
 * reorders itself between calls is impossible to compare against another.
 */
function topologicalOrder(group: ExportedGroup): string[] {
  const keys = Object.keys(group.nodes).sort();
  const indegree = new Map<string, number>(keys.map((key) => [key, 0]));
  for (const edge of group.edges) indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);

  const ready = keys.filter((key) => indegree.get(key) === 0);
  const order: string[] = [];
  while (ready.length > 0) {
    ready.sort();
    const key = ready.shift()!;
    order.push(key);
    for (const edge of group.edges) {
      if (edge.from !== key) continue;
      const remaining = (indegree.get(edge.to) ?? 0) - 1;
      indegree.set(edge.to, remaining);
      if (remaining === 0) ready.push(edge.to);
    }
  }

  if (order.length !== keys.length) {
    // assertValidBundle rejects a cyclic group, so this is only reachable when a
    // bundle was loaded with validation off.
    throw new QueryCallError(`Group contains a cycle, so it cannot be walked.`);
  }
  return order;
}
