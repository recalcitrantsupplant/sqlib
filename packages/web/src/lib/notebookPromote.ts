/**
 * Promote a notebook to a query group: the one-way door the proposal names
 * (`docs/proposals/notebook-cells.md` §7).
 *
 * A notebook is a sequence a person walks; a group is a DAG the server runs in
 * one call. Promotion writes the second from the first when the first has the
 * shape of one: every run cell feeds the last one, every input is either typed
 * or a value bound above, and nothing is a cell kind a group has no node for.
 * A notebook that does not fit is refused with the cell that broke it, rather
 * than promoted into a group that means something else.
 *
 * This module is the planning half and touches no network: it is handed what
 * each cell's entity resolved to and returns the flat write
 * `POST /query-groups/:id/versions` takes. Resolving and writing live in
 * `composables/useNotebookPromotion.ts`.
 */
import type { QueryGroupVersionForGroupCreateInput } from '@sparql-query-lib/contracts';
import { mapColumns } from './notebookValues';
import {
  cellSlots,
  isRunCell,
  type MarkdownCell,
  type NotebookEmptyMode,
  type Notebook,
  type RunCell,
} from './notebookFormat';

/** What one run cell's entity resolved to, pinned to the version promotion uses. */
export interface PromotionTarget {
  kind: 'query' | 'group' | 'ruleset';
  /** The query version or rule set version IRI the node will run. */
  versionId: string;
  resultKind: 'BINDINGS' | 'BOOLEAN' | 'GRAPH' | 'UPDATE';
  /** One input tuple IRI per parameter slot, in slot order. Queries only. */
  inputTupleIds: string[];
  /** The variables each slot binds, in slot order. */
  slotVars: string[][];
  /** The query version's own output port: its result tuple, RDF port or boolean port. */
  outputPortId: string | null;
  /** SELECT columns in projection order. Empty for anything else. */
  outputVars: string[];
  /** The backend the node runs against. Null for a rule set. */
  backendId: string | null;
}

export type PromotionPlan =
  | {
      ok: true;
      payload: QueryGroupVersionForGroupCreateInput;
      /** The markdown cells, joined: the group's description. */
      description: string;
      /** What promotion changed on the way, said to the person before they confirm. */
      notes: string[];
    }
  | { ok: false; cellId: string | null; message: string };

const TEMP = 'urn:ui-temp:';
const START = 'urn:__START__';
const END = 'urn:__END__';

/*
 * A notebook's empty policy, as an edge's. Skipping a cell has no group
 * equivalent — a node always runs — and running it over the empty set is the
 * nearest meaning: it matches nothing, so nothing downstream of it does either.
 */
const WHEN_EMPTY: Record<NotebookEmptyMode, 'propagateEmpty' | 'require'> = {
  skip: 'propagateEmpty',
  empty: 'propagateEmpty',
  stop: 'require',
};

function refusal(cellId: string | null, message: string): PromotionPlan {
  return { ok: false, cellId, message };
}

/** A typed slot that still holds the single all-UNDEF row filters nothing. */
function isWildcard(bindings: Array<Record<string, unknown>>): boolean {
  return bindings.length === 1 && Object.keys(bindings[0] ?? {}).length === 0;
}

export function planPromotion(
  notebook: Notebook,
  targets: Map<string, PromotionTarget>,
): PromotionPlan {
  const cells = notebook.cells;
  const runCells = cells.filter(isRunCell);
  if (runCells.length === 0) return refusal(null, 'There are no run cells to promote.');

  const label = (cell: RunCell) => `Cell ${cells.indexOf(cell) + 1} (${cell.label ?? cell.out})`;
  const producer = new Map<string, RunCell>();
  const notes: string[] = [];

  /* ------------------------------------------------------------------ *
   * Shape: what each cell reads, and that it all ends in one place.
   * ------------------------------------------------------------------ */

  const inputsOf = new Map<string, RunCell[]>();
  for (const cell of runCells) {
    const target = targets.get(cell.id);
    if (!target) return refusal(cell.id, `${label(cell)} names something this library no longer holds.`);
    if (target.kind === 'group') {
      return refusal(cell.id, `${label(cell)} runs a query group, and a group cannot be a node of another group.`);
    }
    if (target.resultKind === 'UPDATE') {
      return refusal(cell.id, `${label(cell)} is an update; a promoted group only reads.`);
    }

    const upstream: RunCell[] = [];
    const refs: string[] = cellSlots(cell).flatMap((slot) => (slot.from === 'value' ? [slot.ref] : []));
    if (cell.kind === 'ruleset') {
      const input = cell.inputGraph;
      if (input && input.from !== 'value') {
        return refusal(cell.id, `${label(cell)} reads a saved data graph; a promoted group can only hand a rule set the graph a cell above produced.`);
      }
      if (input) refs.push(input.ref);
    }
    for (const ref of refs) {
      const source = producer.get(ref);
      if (!source) return refusal(cell.id, `${label(cell)} reads @${ref}, which no cell above it binds.`);
      upstream.push(source);
    }
    inputsOf.set(cell.id, upstream);
    producer.set(cell.out, cell);
  }

  // A group returns one result. A run cell that does not feed the last one is
  // a dead end the notebook may keep and a group cannot.
  const last = runCells[runCells.length - 1]!;
  const reaches = new Set<string>([last.id]);
  const walk = [last];
  while (walk.length) {
    for (const source of inputsOf.get(walk.pop()!.id) ?? []) {
      if (reaches.has(source.id)) continue;
      reaches.add(source.id);
      walk.push(source);
    }
  }
  const orphan = runCells.find((cell) => !reaches.has(cell.id));
  if (orphan) {
    return refusal(
      orphan.id,
      `${label(orphan)} does not feed the last cell, ${label(last)}. A group returns one result: remove the cell, or wire its value into a cell below.`,
    );
  }

  /* ------------------------------------------------------------------ *
   * The flat write.
   * ------------------------------------------------------------------ */

  const nodeId = (cell: RunCell) => `${TEMP}node-${cell.id}`;
  const executionNodes: Record<string, unknown>[] = [];
  const edges: Record<string, unknown>[] = [];
  const outputs: Record<string, unknown>[] = [];
  const tupleMembers: Record<string, unknown>[] = [];
  const outputTuples: Record<string, unknown>[] = [];
  const rdfOutputs: Record<string, unknown>[] = [];
  let edgeCount = 0;
  const edgeId = () => `${TEMP}edge-${(edgeCount += 1)}`;

  /** A rule set node's RDF ports, declared because it has no query version to infer them from. */
  const ruleSetPorts = (cell: RunCell) => ({ in: `${TEMP}rdf-in-${cell.id}`, out: `${TEMP}rdf-out-${cell.id}` });
  const graphPortOf = (cell: RunCell) =>
    cell.kind === 'ruleset' ? ruleSetPorts(cell).out : targets.get(cell.id)!.outputPortId;

  for (const cell of runCells) {
    const target = targets.get(cell.id)!;
    const node: Record<string, unknown> = { id: nodeId(cell) };
    let fed = false;

    if (cell.kind === 'ruleset') {
      const ports = ruleSetPorts(cell);
      node.nodeType = 'RuleSetNode';
      node.ruleSetVersion = target.versionId;
      node.outputs = [ports.out];
      rdfOutputs.push({ id: ports.out, name: `${cell.out} out`, ioType: 'output', outputType: 'RDFGraph', triplesOrQuads: 'triples' });

      const source = inputsOf.get(cell.id)?.[0];
      if (source) {
        const sourcePort = graphPortOf(source);
        if (!sourcePort || (source.kind !== 'ruleset' && targets.get(source.id)!.resultKind !== 'GRAPH')) {
          return refusal(cell.id, `${label(cell)} reads @${source.out}, which is not a graph.`);
        }
        node.inputs = [ports.in];
        rdfOutputs.push({ id: ports.in, name: `${cell.out} in`, ioType: 'output', outputType: 'RDFGraph', triplesOrQuads: 'triples' });
        edges.push({
          id: edgeId(), sourceNodeId: nodeId(source), targetNodeId: nodeId(cell),
          dataFlowType: 'RDF_GRAPH', sourceOutputId: sourcePort, targetInputId: ports.in,
        });
        fed = true;
      }
    } else {
      node.nodeType = 'QueryNode';
      node.queryId = target.versionId;
      if (!target.backendId) return refusal(cell.id, `${label(cell)} has no backend to run against.`);
      node.backendId = target.backendId;

      for (const [slotIndex, slot] of cellSlots(cell).entries()) {
        const vars = target.slotVars[slotIndex] ?? [];
        if (slot.from === 'typed') {
          if (!isWildcard(slot.bindings)) {
            notes.push(`${label(cell)}: the values typed for ${vars.map((v) => `?${v}`).join(' ')} are not kept. That slot becomes a parameter of the group, filled when it is run.`);
          }
          continue;
        }

        const source = producer.get(slot.ref)!;
        const sourceTarget = targets.get(source.id)!;
        if (source.kind === 'ruleset' || sourceTarget.resultKind !== 'BINDINGS') {
          return refusal(cell.id, `${label(cell)} fills a slot from @${slot.ref}, which is not rows.`);
        }

        // The notebook paired columns with mapColumns; the group must pair the
        // same ones. A tuple of exactly those columns, declared on the
        // upstream node, makes the arities equal — which an edge requires —
        // and the explicit mapping pins the pairing rather than trusting the
        // engine's own name-then-position rule to land on the same answer.
        const mappings = mapColumns(sourceTarget.outputVars, vars);
        if (mappings.length !== vars.length) {
          return refusal(cell.id, `${label(cell)}: @${slot.ref} has too few columns to fill ${vars.map((v) => `?${v}`).join(' ')}.`);
        }
        const tupleId = `${TEMP}tuple-${cell.id}-${slotIndex}`;
        const memberIds = mappings.map((_, index) => `${tupleId}-m${index}`);
        mappings.forEach(({ source: column }, index) => {
          const variableId = `${tupleId}-v${index}`;
          outputs.push({ id: variableId, variableName: column });
          tupleMembers.push({ id: memberIds[index], position: index, variable: variableId });
        });
        outputTuples.push({ id: tupleId, name: `${source.out} → ${cell.out}`, memberEntries: memberIds });
        const sourceNode = executionNodes.find((entry) => entry.id === nodeId(source))!;
        sourceNode.outputs = [...((sourceNode.outputs as string[] | undefined) ?? []), tupleId];

        edges.push({
          id: edgeId(), sourceNodeId: nodeId(source), targetNodeId: nodeId(cell),
          dataFlowType: 'VARIABLE_BINDINGS', sourceOutputId: tupleId,
          targetInputId: target.inputTupleIds[slotIndex],
          whenEmpty: WHEN_EMPTY[slot.whenEmpty ?? 'skip'],
          variableMappings: JSON.stringify(mappings),
        });
        if ((slot.whenEmpty ?? 'skip') === 'skip') {
          notes.push(`${label(cell)}: "skip if @${slot.ref} is empty" becomes "match nothing" — a group node always runs.`);
        }
        fed = true;
      }

      if (cell.kind === 'query' && (Object.keys(cell.limits ?? {}).length || Object.keys(cell.offsets ?? {}).length)) {
        notes.push(`${label(cell)}: its LIMIT / OFFSET values are not kept. Pass them when the group is run.`);
      }
    }

    if (!fed) {
      edges.push({ id: edgeId(), sourceNodeId: START, targetNodeId: nodeId(cell), dataFlowType: 'CONTROL_FLOW' });
    }
    executionNodes.push(node);
  }

  // The result: the last cell's own output, wired to the end node.
  const lastTarget = targets.get(last.id)!;
  let endMediaType = 'application/sparql-results+json';
  if (last.kind === 'ruleset' || lastTarget.resultKind === 'GRAPH') {
    const port = graphPortOf(last)!;
    edges.push({ id: edgeId(), sourceNodeId: nodeId(last), targetNodeId: END, dataFlowType: 'RDF_GRAPH', sourceOutputId: port, targetInputId: port });
    endMediaType = 'application/n-triples';
  } else {
    const port = lastTarget.outputPortId;
    if (!port) return refusal(last.id, `${label(last)} has no output to return.`);
    const flow = lastTarget.resultKind === 'BOOLEAN' ? 'BOOLEAN' : 'VARIABLE_BINDINGS';
    edges.push({ id: edgeId(), sourceNodeId: nodeId(last), targetNodeId: END, dataFlowType: flow, sourceOutputId: port, targetInputId: port });
  }

  const description = cells
    .filter((cell): cell is MarkdownCell => cell.kind === 'markdown')
    .map((cell) => cell.source.trim())
    .filter(Boolean)
    .join('\n\n');

  const payload: Record<string, unknown> = {
    queryGroupVersion: { comment: `Promoted from the notebook "${notebook.title}" (${runCells.length} run cells)` },
    endNode: { mediaType: endMediaType },
    executionNodes,
    edges,
  };
  if (outputs.length) payload.outputs = outputs;
  if (tupleMembers.length) payload.tupleMembers = tupleMembers;
  if (outputTuples.length) payload.outputTuples = outputTuples;
  if (rdfOutputs.length) payload.rdfOutputs = rdfOutputs;

  return { ok: true, payload: payload as QueryGroupVersionForGroupCreateInput, description, notes };
}
