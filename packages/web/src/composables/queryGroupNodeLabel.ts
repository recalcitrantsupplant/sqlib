/**
 * What a query group's node is called, decided once.
 *
 * Its own module because everything that shows a node to a person needs the
 * answer — the canvas card, the inspector's edge endpoints, a validation
 * message, a compatibility refusal — and `GraphNodeState.label` is not it:
 * that field holds the name an *author* typed, which is usually nothing at all.
 * Reading it raw is what left a diagnostic naming a URN and a card reading
 * "Query Node" next to the query it runs.
 *
 * It imports only the node's type, so the modules below it in the graph — the
 * compatibility rules among them — can ask without a cycle.
 */

import type { GraphNodeState } from './useQueryGroupGraph';

/**
 * The name a node carries on the canvas: what it is attached to, or what it is.
 *
 * A node's own label wins when it has one — an author who renamed a node meant
 * it. That reading only works because `label` is empty until somebody types
 * into the inspector's "Display label" field: when the loader and the toolbar
 * filled it with the kind's own name, every node looked renamed, so an author's
 * name and a placeholder were the same value and neither could win over the
 * other.
 *
 * Otherwise a query or patch node is named by the query version it references
 * and a ruleset node by its rule set version, once the `iriMap` can name them,
 * and every kind falls back to what that kind is called.
 */
export function canvasNodeLabel(
  graphNode: GraphNodeState,
  // Optional so a caller with no map to hand — a validation message, a
  // compatibility refusal — still gets what the node is called rather than its
  // URN. It costs the attachment's name, never the author's.
  iriMap: Record<string, string> = {},
): string {
  const authored = authoredNodeLabel(graphNode);
  if (authored) {
    return authored;
  }

  switch (graphNode.kind) {
    case 'start':
      return 'Start';
    case 'end':
      return 'End';
    case 'dynamic':
      /*
       * A dynamic node keeps its kind's name however its `queryVersionId` reads:
       * the query it runs is the one an edge hands it at run time, so naming it
       * after a version would name it after the wrong query.
       */
      return 'Dynamic Query Node';
    case 'ruleset': {
      // Named by the rule set version it runs, never by a query version it does
      // not have (#379).
      const ruleSetVersionId = graphNode.ruleSetVersionId;
      return (ruleSetVersionId && iriMap[ruleSetVersionId]) || 'Ruleset Node';
    }
    case 'patch': {
      // Named by the update it describes once one is assigned, and by what it
      // is until then — the same fallback a query node gets.
      const queryId = graphNode.queryVersionId ?? graphNode.queryId;
      return (queryId && iriMap[queryId]) || 'Patch Node';
    }
    default: {
      const queryId = graphNode.queryVersionId ?? graphNode.queryId;
      return (queryId && iriMap[queryId]) || 'Query Node';
    }
  }
}

/**
 * The name the author gave this node, or `null` if they have not named it.
 *
 * The one reading of `GraphNodeState.label`: it holds an author's name and
 * nothing else. Everything a node is *called* — including every fallback — is
 * `canvasNodeLabel`'s to decide.
 */
export function authoredNodeLabel(graphNode: Pick<GraphNodeState, 'label'>): string | null {
  if (typeof graphNode.label !== 'string') {
    return null;
  }
  const trimmed = graphNode.label.trim();
  return trimmed.length > 0 ? trimmed : null;
}
