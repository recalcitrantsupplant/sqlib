/**
 * The shapes a new query group can start from.
 *
 * The guided empty state asks for "2-3 one-click templates (linear chain,
 * fan-in merge, construct-then-query)". This is that catalogue: pure data, so
 * the command that applies one and the buttons that offer them read the same
 * list.
 *
 * Two things about the catalogue are decisions rather than transcription.
 *
 * **A template declares its own flow types.** `addStep` asks `recommendFlowType`
 * because it has nothing better: a step with no query yet has no query type, and
 * the table keys on exactly that, so the honest answer there is the low
 * confidence fallback. A template is the opposite situation - the shape *is*
 * what the author just chose. Left to the recommender every edge between two
 * blank query nodes would come out `CONTROL_FLOW`, and "fan-in merge" would
 * arrive as a fan-in of nothing: the one thing the button promised, absent.
 *
 * **The third template is construct-then-*rules*, not construct-then-query.**
 * That name describes an edge v1 refuses:
 * `EDGE_RDF_GRAPH_TARGET_CANNOT_CONSUME` (phase 2's matrix, and
 * `checkNodeKinds` here) - a SPARQL node can only see upstream RDF through a
 * shared ephemeral store, which the flat API cannot express, so RDF may go to a
 * rule set node or the End node and nowhere else. Shipping that wording
 * would have put a template on the empty state that refuses itself on click.
 */

import type { GraphNodeKind } from './useQueryGroupGraph';
import type { EdgeFlowType } from './queryGroupCompatibility';

export type CanvasTemplateId = 'linear-chain' | 'fan-in-merge' | 'construct-then-rules';

/** The two endpoints every template wires to, addressed by name rather than id. */
export const TEMPLATE_ANCHORS = ['start', 'end'] as const;
export type TemplateAnchor = (typeof TEMPLATE_ANCHORS)[number];

export type CanvasTemplateStep = {
  /** How this step is named by the template's own edges. Never an anchor name. */
  key: string;
  kind: Extract<GraphNodeKind, 'query' | 'ruleset'>;
  /**
   * The node's name, as the inspector's Editor tab shows it, a save stores it,
   * and — since #482 — the canvas card is titled.
   *
   * Descriptive rather than the toolbar's generic "Query Node", so a step says
   * what it is for before it has a query.
   *
   * This used to add that it was *not* what the card showed, because
   * `QueryGroupCanvasNode` titled a node by its attached query's name falling
   * back to the kind, so an unassigned node read "Query Node" however it was
   * named. That is no longer true and the templates are the better for it: a
   * fresh "Construct, then rules" now reads "Construct graph" and "Apply rules"
   * on the canvas rather than two cards saying what kind of box they are.
   * `data-node-kind` is where the kind went.
   */
  label: string;
  /** Where it lands, in columns right of the Start node and rows below the first. */
  column: number;
  row: number;
};

export type CanvasTemplateEdge = {
  /** A step key, or `'start'`. */
  from: string;
  /** A step key, or `'end'`. */
  to: string;
  flowType: EdgeFlowType;
};

export type CanvasTemplate = {
  id: CanvasTemplateId;
  /** The button's text in the empty state. */
  label: string;
  /** One sentence, used as the button's title and in the note the toast carries. */
  description: string;
  steps: readonly CanvasTemplateStep[];
  edges: readonly CanvasTemplateEdge[];
};

/**
 * Every template starts at the Start node and ends at the End node, because
 * that is what makes the result a group rather than a few loose nodes: the
 * author's next act is choosing a query for each step, not working out what
 * the group's boundary is wired to.
 */
export const CANVAS_TEMPLATES: readonly CanvasTemplate[] = [
  {
    id: 'linear-chain',
    label: 'Linear chain',
    description: 'Two queries, the first feeding its result rows into the second.',
    steps: [
      { key: 'first', kind: 'query', label: 'First query', column: 0, row: 0 },
      { key: 'second', kind: 'query', label: 'Second query', column: 1, row: 0 },
    ],
    edges: [
      { from: 'start', to: 'first', flowType: 'VARIABLE_BINDINGS' },
      { from: 'first', to: 'second', flowType: 'VARIABLE_BINDINGS' },
      { from: 'second', to: 'end', flowType: 'VARIABLE_BINDINGS' },
    ],
  },
  {
    id: 'fan-in-merge',
    label: 'Fan-in merge',
    /*
     * Both sources hang off Start rather than one of them: a fan-in whose two
     * arms begin in different places is a different shape, and the arm that
     * began nowhere would be the one the author had to notice and fix.
     */
    description: 'Two queries whose result rows are merged into a third.',
    steps: [
      { key: 'left', kind: 'query', label: 'First source', column: 0, row: 0 },
      { key: 'right', kind: 'query', label: 'Second source', column: 0, row: 1 },
      { key: 'merge', kind: 'query', label: 'Merge', column: 1, row: 0 },
    ],
    edges: [
      { from: 'start', to: 'left', flowType: 'VARIABLE_BINDINGS' },
      { from: 'start', to: 'right', flowType: 'VARIABLE_BINDINGS' },
      { from: 'left', to: 'merge', flowType: 'VARIABLE_BINDINGS' },
      { from: 'right', to: 'merge', flowType: 'VARIABLE_BINDINGS' },
      { from: 'merge', to: 'end', flowType: 'VARIABLE_BINDINGS' },
    ],
  },
  {
    id: 'construct-then-rules',
    label: 'Construct, then rules',
    description: 'A CONSTRUCT query building a graph, with a rule set drawing conclusions from it.',
    steps: [
      { key: 'construct', kind: 'query', label: 'Construct graph', column: 0, row: 0 },
      { key: 'rules', kind: 'ruleset', label: 'Apply rules', column: 1, row: 0 },
    ],
    edges: [
      { from: 'start', to: 'construct', flowType: 'VARIABLE_BINDINGS' },
      { from: 'construct', to: 'rules', flowType: 'RDF_GRAPH' },
      { from: 'rules', to: 'end', flowType: 'RDF_GRAPH' },
    ],
  },
];

export const templateById = (id: CanvasTemplateId): CanvasTemplate | undefined =>
  CANVAS_TEMPLATES.find(template => template.id === id);

/** True for the two reserved names a template edge may name instead of a step. */
export const isTemplateAnchor = (key: string): key is TemplateAnchor =>
  (TEMPLATE_ANCHORS as readonly string[]).includes(key);
