/**
 * Validation while the group is being built, from what the canvas already knows.
 *
 * `/validate` answers about the *saved* version, so it can only ever describe
 * the graph as it was at the last save - useful as the pre-flight a run makes,
 * useless as feedback on the edit you are making right now. Everything it
 * checks about the graph's *shape*, though, is decidable from the canvas state:
 * the I/O model names every port, tuple, member and variable, and
 * `queryGroupCompatibility` already holds the rules the commands enforce. So
 * the shape half runs here, live, and the server keeps the half that needs the
 * store: whether a referenced query version, backend or rule-set version still
 * exists and is of the right type.
 *
 * This is deliberately *not* `checkInvariants`. Those describe states a command
 * should never produce - a violation there is a bug in the editor, not a
 * problem with the group - and a graph that is merely half-built satisfies all
 * of them. What an author needs told is the opposite: the ordinary, expected
 * incompleteness of a group under construction.
 *
 * Which is why a missing reference is a warning here and an error at
 * `/validate`. A node you dropped a second ago has no query yet; that is the
 * next thing you were going to do, not a fault. The run pre-flight still
 * refuses to execute it, so nothing gets looser - the same fact is just told
 * earlier and more quietly.
 */

import { ref, watch, onScopeDispose, type Ref } from 'vue';
import { useDebounceFn } from '@vueuse/core';
import { QueryTypeIri, toQueryTypeIri } from '@sparql-query-lib/types';
import { ioModelOf, type GraphNodeState, type QueryGroupGraphState } from './useQueryGroupGraph';
import { hasCycle, validateEdge, type Diagnostic } from './queryGroupCompatibility';
import { canvasNodeLabel } from './queryGroupNodeLabel';
import type { ValidationIssue } from './queryGroupTypes';

/** `/validate`'s own codes, so an issue reads the same whichever half found it. */
const CODES = {
  queryMissing: 'NODE_QUERY_ID_UNRESOLVABLE',
  queryVersionError: 'NODE_QUERY_VERSION_UNREADABLE',
  ruleSetMissing: 'NODE_RULESET_VERSION_UNRESOLVABLE',
  backendMissing: 'NODE_BACKEND_UNRESOLVABLE',
  backendConflict: 'NODE_BACKEND_CONFLICT',
  patchPortsMissing: 'NODE_PATCH_OUTPUT_PORTS_MISSING',
  patchQueryNotUpdate: 'NODE_PATCH_QUERY_NOT_UPDATE',
  cycle: 'GRAPH_CYCLE',
} as const;

const issue = (
  level: ValidationIssue['level'],
  message: string,
  entityType: string,
  entityId: string | null,
  code: string,
): ValidationIssue => ({ level, message, entityType, entityId, code });

/**
 * Arity is described, not judged.
 *
 * `arityDiagnostics` says what a differing or unknown arity will *do* at run
 * time - a legal, common and often intended arrangement. The inspector already
 * drops these from an edge's diagnostics because it states arity on its own
 * line; a badge would be worse still, marking a working group permanently
 * warned about something that is not wrong with it.
 */
const DESCRIPTIVE_CODES = new Set(['mapping-arity-differs', 'mapping-arity-unknown']);

/** An edge diagnostic, in the shape the canvas decorator reads. */
const fromDiagnostic = (diagnostic: Diagnostic, edgeId: string): ValidationIssue | null => {
  // `info` has no canvas treatment; it would render as a warning and overstate itself.
  if (diagnostic.level === 'info') return null;
  if (DESCRIPTIVE_CODES.has(diagnostic.code)) return null;
  return issue(diagnostic.level, diagnostic.message, 'edge', edgeId, diagnostic.code);
};

/*
 * What to call a node in a message. `label` holds the name an author typed and
 * is empty for almost every node, so reading it raw put a URN in front of a
 * person wherever nobody had renamed anything.
 */
const nodeName = (node: GraphNodeState) => canvasNodeLabel(node);

/**
 * What this node still needs before it could run.
 *
 * The boundary nodes are skipped for the same reason `/validate` walks only
 * `executionNodes`: Start and End reference nothing, so there is nothing to
 * report about them.
 */
function nodeIssues(node: GraphNodeState): ValidationIssue[] {
  if (node.kind === 'start' || node.kind === 'end') return [];
  const issues: ValidationIssue[] = [];
  const name = nodeName(node);

  if (node.kind === 'ruleset') {
    if (!node.ruleSetVersionId && !node.ruleSetId) {
      issues.push(issue('warning', `${name} has no rule set.`, 'node', node.id, CODES.ruleSetMissing));
    }
    // A rule-set node runs its rules over what it is handed; it names no backend.
    return issues;
  }

  if (node.kind === 'patch') {
    /*
     * Two things a patch node needs beyond a query and a store, and both are
     * refusals at the API rather than warnings: it derives the effect of an
     * *update*, and the halves it emits have to leave by their own named ports.
     * Reported as errors here for that reason — unlike a missing reference,
     * neither is the ordinary incompleteness of a group under construction: the
     * canvas mints both ports with the node and only ever assigns it an update.
     */
    const halves = [node.deletionsOutputId, node.additionsOutputId].filter(
      (id): id is string => typeof id === 'string' && id.length > 0,
    );
    if (halves.length < 2 || halves[0] === halves[1]) {
      issues.push(
        issue(
          'error',
          `${name} must name one output for the deletions and another for the additions.`,
          'node',
          node.id,
          CODES.patchPortsMissing,
        ),
      );
    } else {
      const declared = new Set(node.outputs.map(port => port.id));
      for (const half of halves) {
        if (!declared.has(half)) {
          issues.push(
            issue(
              'error',
              `${name} names port ${half} as one of its patch halves but does not declare it as an output.`,
              'node',
              node.id,
              CODES.patchPortsMissing,
            ),
          );
        }
      }
    }

    const queryType = toQueryTypeIri(node.queryType);
    if (queryType && queryType !== QueryTypeIri.update) {
      issues.push(
        issue(
          'error',
          `${name} derives the effect of an update, so it cannot run this query.`,
          'node',
          node.id,
          CODES.patchQueryNotUpdate,
        ),
      );
    }
    // Falls through: a patch node still needs a query and a backend, and both
    // are the same warnings a query node gets.
  }

  // A dynamic node is handed its query at execution time through a QueryIdInput,
  // so having none here is correct rather than missing.
  if ((node.kind === 'query' || node.kind === 'patch') && !node.queryVersionId && !node.queryId) {
    issues.push(issue('warning', `${name} has no query.`, 'node', node.id, CODES.queryMissing));
  }

  if (node.queryVersionResolution?.status === 'error') {
    issues.push(
      issue(
        'error',
        `${name} could not load its query: ${node.queryVersionResolution.message}`,
        'node',
        node.id,
        CODES.queryVersionError,
      ),
    );
  }

  // A node reads one backend or the other: a named backend, or the ephemeral
  // store its config describes. Carrying both is a contradiction the author has
  // to resolve; carrying neither is just the next thing to fill in.
  if (node.backendConfig) {
    if (node.backendId) {
      issues.push(
        issue(
          'error',
          `${name} names a backend alongside an ephemeral store; the node reads one or the other.`,
          'node',
          node.id,
          CODES.backendConflict,
        ),
      );
    }
  } else if (!node.backendId) {
    issues.push(issue('warning', `${name} has no backend.`, 'node', node.id, CODES.backendMissing));
  }

  return issues;
}

/**
 * Everything the canvas can decide about this graph on its own.
 *
 * Pure, so it can be tested against a state rather than a mounted component,
 * and cheap enough to run on every command.
 */
export function liveValidationIssues(state: QueryGroupGraphState | null): ValidationIssue[] {
  if (!state) return [];
  const issues: ValidationIssue[] = [];
  const model = ioModelOf(state);
  const nodesById = new Map(state.nodes.map(node => [node.id, node]));

  for (const node of state.nodes) issues.push(...nodeIssues(node));

  for (const edge of state.edges) {
    const source = nodesById.get(edge.source);
    const target = nodesById.get(edge.target);
    for (const diagnostic of validateEdge(edge, source, target, model)) {
      const entry = fromDiagnostic(diagnostic, edge.id);
      if (entry) issues.push(entry);
    }
  }

  // The same order the executor needs and `connectNodes` refuses to break. A
  // cycle should be unreachable from the canvas, but a version saved before that
  // check existed - or by another client - can still carry one.
  if (hasCycle(state.nodes.map(node => node.id), state.edges)) {
    issues.push(
      issue('error', 'The graph contains a cycle, so its nodes cannot be ordered for execution.', 'graph', null, CODES.cycle),
    );
  }

  return issues;
}

type Options = {
  graphState: Ref<QueryGroupGraphState | null>;
  /**
   * Long enough to coalesce a command that lands in several steps, short enough
   * that the badge follows the edit rather than trailing it.
   */
  delayMs?: number;
};

export function useQueryGroupLiveValidation({ graphState, delayMs = 200 }: Options) {
  const liveIssues = ref<ValidationIssue[]>(liveValidationIssues(graphState.value));

  const recompute = () => {
    liveIssues.value = liveValidationIssues(graphState.value);
  };
  const debouncedRecompute = useDebounceFn(recompute, delayMs);

  // The state object is replaced wholesale by every command, so a shallow watch
  // sees each edit. Node positions live on the VueFlow arrays instead, which is
  // what keeps dragging from re-validating anything.
  const stop = watch(graphState, () => void debouncedRecompute());
  onScopeDispose(stop);

  return { liveIssues, recompute };
}
