/**
 * Edge Flow Type Defaults and Validation
 *
 * Provides intelligent defaults and validation for edge flow types based on
 * source and target node characteristics (node kind, query type, I/O ports).
 */

import flowTypeRulesConfig from '../config/edge-flow-type-defaults.json' with { type: 'json' };
import type { GraphNodeState } from './useQueryGroupGraph.js';

export type DataFlowType = 'CONTROL_FLOW' | 'VARIABLE_BINDINGS' | 'RDF_GRAPH' | 'BOOLEAN' | 'QUERY_ID';
export type Confidence = 'high' | 'medium' | 'low';

export interface EdgeFlowTypeRecommendation {
  defaultFlowType: DataFlowType;
  confidence: Confidence;
  explanation: string;
  warnings?: string[];
}

export interface FlowTypeValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * What each flow type is called on the canvas.
 *
 * The enum names are what the API persists and what dev-facing surfaces show;
 * an author drawing an edge between two queries should not have to know that
 * "the rows come out of A and go into B" is spelled VARIABLE_BINDINGS.
 */
export const FLOW_TYPE_LABELS: Record<DataFlowType, string> = {
  CONTROL_FLOW: 'runs after',
  VARIABLE_BINDINGS: 'result rows',
  RDF_GRAPH: 'RDF graph',
  BOOLEAN: 'true / false',
  QUERY_ID: 'query selector',
};

export const flowTypeLabel = (flowType: DataFlowType | null | undefined): string =>
  (flowType && FLOW_TYPE_LABELS[flowType]) || FLOW_TYPE_LABELS.CONTROL_FLOW;

interface FlowTypeRule {
  sourceKind?: string;
  targetKind?: string;
  sourceQueryType?: string;
  targetQueryType?: string;
  targetHasQueryIdInput?: boolean;
  defaultFlowType: DataFlowType;
  confidence: Confidence;
  explanation: string;
  warnings?: string[];
}

/**
 * Recommends a default flow type for an edge based on source and target node characteristics.
 */
export function recommendFlowType(
  sourceNode: GraphNodeState,
  targetNode: GraphNodeState
): EdgeFlowTypeRecommendation {
  const rules = flowTypeRulesConfig.rules as FlowTypeRule[];

  if (sourceNode.kind === 'ruleset' || targetNode.kind === 'ruleset') {
    return {
      defaultFlowType: 'RDF_GRAPH',
      confidence: 'high',
      explanation: 'Ruleset nodes consume and produce RDF graphs by default',
    };
  }

  /*
   * Short-circuited in code, beside the ruleset rule and for the same reason:
   * the table keys its recommendation on the source's *query type*, and a patch
   * node's query is an update — which the table reads as "produces no output
   * data" and answers with a control flow edge. What the node emits is not its
   * query's result but the derived patch, so the query type is the wrong
   * question to ask about it.
   */
  if (sourceNode.kind === 'patch') {
    return {
      defaultFlowType: 'RDF_GRAPH',
      confidence: 'high',
      explanation: 'A patch node emits the two halves of a patch as RDF graphs',
      warnings: ['Choose whether this edge carries the deletions or the additions'],
    };
  }

  // Check for dynamic node with QueryIdInput
  const targetHasQueryIdInput = targetNode.kind === 'dynamic' &&
    targetNode.inputs.some((i) => i.entityType === 'QueryIdInput');

  // Find matching rule
  for (const rule of rules) {
    if (matchesRule(rule, sourceNode, targetNode, targetHasQueryIdInput)) {
      return {
        defaultFlowType: rule.defaultFlowType,
        confidence: rule.confidence,
        explanation: rule.explanation,
        warnings: rule.warnings
      };
    }
  }

  // Fallback
  const fallback = flowTypeRulesConfig.fallbackRule;
  return {
    defaultFlowType: fallback.defaultFlowType as DataFlowType,
    confidence: fallback.confidence as Confidence,
    explanation: fallback.explanation,
    warnings: fallback.warnings
  };
}

/**
 * Validates whether a selected flow type is compatible with the source and target nodes.
 */
export function validateFlowTypeCompatibility(
  sourceNode: GraphNodeState,
  targetNode: GraphNodeState,
  flowType: DataFlowType
): FlowTypeValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  // EndNode as source is invalid
  if (sourceNode.kind === 'end') {
    errors.push('End nodes cannot have outgoing edges');
  }

  // StartNode as target is unusual
  if (targetNode.kind === 'start') {
    warnings.push('Creating edge to start node is unusual');
  }

  // CONTROL_FLOW is always valid structurally
  if (flowType === 'CONTROL_FLOW') {
    return { valid: errors.length === 0, errors, warnings };
  }

  if ((sourceNode.kind === 'ruleset' || targetNode.kind === 'ruleset') && flowType !== 'RDF_GRAPH') {
    errors.push('Ruleset nodes require RDF_GRAPH edges for data transfer');
  }

  /*
   * Answered here rather than by the table below, and returned rather than
   * merged into it. The rules key on the source's query type, and a patch
   * node's query is an update: RDF_GRAPH's `allowedSourceQueryTypes` would
   * reject the one flow type a patch node actually emits, with a message about
   * CONSTRUCT and DESCRIBE that is about a different node than the one the
   * author drew.
   */
  if (sourceNode.kind === 'patch') {
    if (flowType !== 'RDF_GRAPH') {
      errors.push('A patch node emits RDF graphs; only RDF_GRAPH and CONTROL_FLOW edges leave one');
    }
    return { valid: errors.length === 0, errors, warnings };
  }

  // Validate based on validation rules
  const validationRules = flowTypeRulesConfig.validationRules as Record<string, any>;
  const rule = validationRules[flowType];

  if (!rule) {
    errors.push(`Unknown flow type: ${flowType}`);
    return { valid: false, errors, warnings };
  }

  // Check source query type restrictions
  if (rule.allowedSourceQueryTypes) {
    if (sourceNode.queryType && !rule.allowedSourceQueryTypes.includes(sourceNode.queryType)) {
      const errorMsg = rule.errorMessages?.default ||
        `${flowType} incompatible with source query type ${getQueryTypeLabel(sourceNode.queryType)}`;
      errors.push(errorMsg);
    }
  }

  // Check disallowed source query types
  if (rule.disallowedSourceQueryTypes && sourceNode.queryType) {
    if (rule.disallowedSourceQueryTypes.includes(sourceNode.queryType)) {
      const queryTypeKey = getQueryTypeKey(sourceNode.queryType);
      const errorMsg = rule.errorMessages?.[queryTypeKey] || rule.errorMessages?.default ||
        `${flowType} incompatible with source query type ${getQueryTypeLabel(sourceNode.queryType)}`;
      errors.push(errorMsg);
    }
  }

  // Check allowed source kinds
  if (rule.allowedSourceKinds && sourceNode.kind) {
    if (!rule.allowedSourceKinds.includes(sourceNode.kind)) {
      errors.push(`${flowType} cannot originate from ${sourceNode.kind} nodes`);
    }
  }

  // Check allowed target kinds
  if (rule.allowedTargetKinds && targetNode.kind) {
    if (!rule.allowedTargetKinds.includes(targetNode.kind)) {
      const errorMsg = rule.errorMessages?.targetKind ||
        `${flowType} cannot target ${targetNode.kind} nodes`;
      errors.push(errorMsg);
    }
  }

  // Add any rule-specific warnings
  if (rule.warnings) {
    warnings.push(...rule.warnings);
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Gets a human-readable label for a flow type.
 */
export function formatFlowTypeLabel(flowType: DataFlowType): string {
  const labels: Record<DataFlowType, string> = {
    'CONTROL_FLOW': 'Control Flow (execution order)',
    'VARIABLE_BINDINGS': 'Variable Bindings (tuple data)',
    'RDF_GRAPH': 'RDF Graph (triples/quads)',
    'BOOLEAN': 'Boolean (true/false)',
    'QUERY_ID': 'Query ID (dynamic selection)'
  };
  return labels[flowType] || flowType;
}

/**
 * Gets the confidence badge CSS class.
 */
export function getConfidenceBadgeClass(confidence: Confidence): string {
  return `confidence-${confidence}`;
}

// Helper functions

function matchesRule(
  rule: FlowTypeRule,
  sourceNode: GraphNodeState,
  targetNode: GraphNodeState,
  targetHasQueryIdInput: boolean
): boolean {
  // Check source kind
  if (rule.sourceKind && sourceNode.kind !== rule.sourceKind) {
    return false;
  }

  // Check target kind
  if (rule.targetKind && targetNode.kind !== rule.targetKind) {
    return false;
  }

  // Check source query type
  if (rule.sourceQueryType && sourceNode.queryType !== rule.sourceQueryType) {
    return false;
  }

  // Check target query type
  if (rule.targetQueryType && targetNode.queryType !== rule.targetQueryType) {
    return false;
  }

  // Check targetHasQueryIdInput constraint
  if (rule.targetHasQueryIdInput !== undefined &&
      targetHasQueryIdInput !== rule.targetHasQueryIdInput) {
    return false;
  }

  return true;
}

function getQueryTypeLabel(queryTypeIri: string): string {
  const typeMap: Record<string, string> = {
    'https://sparql-query-lib/query-type/select': 'SELECT',
    'https://sparql-query-lib/query-type/construct': 'CONSTRUCT',
    'https://sparql-query-lib/query-type/describe': 'DESCRIBE',
    'https://sparql-query-lib/query-type/ask': 'ASK',
    'https://sparql-query-lib/query-type/update': 'UPDATE',
  };
  return typeMap[queryTypeIri] || queryTypeIri;
}

function getQueryTypeKey(queryTypeIri: string): string {
  const keyMap: Record<string, string> = {
    'https://sparql-query-lib/query-type/select': 'select',
    'https://sparql-query-lib/query-type/construct': 'construct',
    'https://sparql-query-lib/query-type/describe': 'describe',
    'https://sparql-query-lib/query-type/ask': 'ask',
    'https://sparql-query-lib/query-type/update': 'update',
  };
  return keyMap[queryTypeIri] || 'default';
}
