/**
 * Type guards for LDKit entities to replace unsafe `any` casting
 */

import type { QueryNodeEntity } from '../persistence/schemas/QueryNodeSchema.js';
import type { StartNodeEntity } from '../persistence/schemas/StartNodeSchema.js';
import type { EndNodeEntity } from '../persistence/schemas/EndNodeSchema.js';
import type { DynamicQueryNodeEntity } from '../persistence/schemas/DynamicQueryNodeSchema.js';
import type { RuleSetNodeEntity } from '../persistence/schemas/RuleSetNodeSchema.js';
import type { PatchNodeEntity } from '../persistence/schemas/PatchNodeSchema.js';
import type { DuckDbEtlNodeEntity } from '../persistence/schemas/DuckDbEtlNodeSchema.js';
import type { QueryEdgeEntity } from '../persistence/schemas/QueryEdgeSchema.js';
import type { QueryGroupEntity } from '../persistence/schemas/QueryGroupSchema.js';
import type { QueryGroupVersionEntity } from '../persistence/schemas/QueryGroupVersionSchema.js';
import type { QueryVersionEntity } from '../persistence/schemas/QueryVersionSchema.js';
import type { QueryIdInputEntity } from '../persistence/schemas/QueryIdInputSchema.js';
import type { QueryInputTupleEntity } from '../persistence/schemas/QueryInputTupleSchema.js';
import type { QueryOutputTupleEntity } from '../persistence/schemas/QueryOutputTupleSchema.js';
import type { TriplesQuadsIOEntity } from '../persistence/schemas/TriplesQuadsIOSchema.js';
import type { BooleanIOEntity } from '../persistence/schemas/BooleanIOSchema.js';

/**
 * Base entity type guard - checks for basic LDKit entity structure
 */
function isTypedEntity(obj: unknown): obj is { $id: string; '@type': string } {
  const rec = obj as { $id?: unknown; '@type'?: unknown };
  return typeof obj === 'object' &&
         obj !== null &&
         typeof rec.$id === 'string' &&
         typeof rec['@type'] === 'string';
}

/**
 * Type guards for specific node types
 */
export function isQueryNode(obj: unknown): obj is QueryNodeEntity {
  return isTypedEntity(obj) && obj['@type'] === 'QueryNode';
}

export function isStartNode(obj: unknown): obj is StartNodeEntity {
  return isTypedEntity(obj) && obj['@type'] === 'StartNode';
}

export function isEndNode(obj: unknown): obj is EndNodeEntity {
  return isTypedEntity(obj) && obj['@type'] === 'EndNode';
}

export function isDynamicQueryNode(obj: unknown): obj is DynamicQueryNodeEntity {
  return isTypedEntity(obj) && obj['@type'] === 'DynamicQueryNode';
}

export function isRuleSetNode(obj: unknown): obj is RuleSetNodeEntity {
  return isTypedEntity(obj) && obj['@type'] === 'RuleSetNode';
}

export function isPatchNode(obj: unknown): obj is PatchNodeEntity {
  return isTypedEntity(obj) && obj['@type'] === 'PatchNode';
}

export function isDuckDbEtlNode(obj: unknown): obj is DuckDbEtlNodeEntity {
  return isTypedEntity(obj) && obj['@type'] === 'DuckDbEtlNode';
}

export function isQueryEdge(obj: unknown): obj is QueryEdgeEntity {
  return isTypedEntity(obj) && obj['@type'] === 'QueryEdge';
}

export function isQueryGroup(obj: unknown): obj is QueryGroupEntity {
  return isTypedEntity(obj) && obj['@type'] === 'QueryGroup';
}

export function isQueryGroupVersion(obj: unknown): obj is QueryGroupVersionEntity {
  return isTypedEntity(obj) && obj['@type'] === 'QueryGroupVersion';
}

export function isQueryVersion(obj: unknown): obj is QueryVersionEntity {
  return isTypedEntity(obj) && obj['@type'] === 'QueryVersion';
}

export function isQueryIdInput(obj: unknown): obj is QueryIdInputEntity {
  return isTypedEntity(obj) && obj['@type'] === 'QueryIdInput';
}

export function isQueryInputTuple(obj: unknown): obj is QueryInputTupleEntity {
  return isTypedEntity(obj) && obj['@type'] === 'QueryInputTuple';
}

export function isQueryOutputTuple(obj: unknown): obj is QueryOutputTupleEntity {
  return isTypedEntity(obj) && obj['@type'] === 'QueryOutputTuple';
}

export function isTriplesQuadsIO(obj: unknown): obj is TriplesQuadsIOEntity {
  return isTypedEntity(obj) && obj['@type'] === 'TriplesQuadsIO';
}

export function isBooleanIO(obj: unknown): obj is BooleanIOEntity {
  return isTypedEntity(obj) && obj['@type'] === 'BooleanIO';
}

/**
 * Union type for all node types (LDKit entities)
 */
export type AnyNodeType = QueryNodeEntity | StartNodeEntity | EndNodeEntity | DynamicQueryNodeEntity | RuleSetNodeEntity | PatchNodeEntity | DuckDbEtlNodeEntity;

/**
 * Union type for all REST API node types - avoiding circular imports
 */
export type AnyRestNodeType = any; // Simplified for now - can be improved later

/**
 * Type guard for any node type
 */
export function isAnyNode(obj: unknown): obj is AnyNodeType {
  return isQueryNode(obj) || isStartNode(obj) || isEndNode(obj) || isDynamicQueryNode(obj) || isRuleSetNode(obj) || isPatchNode(obj) || isDuckDbEtlNode(obj);
}

/**
 * Helper to get the node type from a node entity
 */
export function getNodeType(node: AnyNodeType): 'QueryNode' | 'StartNode' | 'EndNode' | 'DynamicQueryNode' | 'RuleSetNode' | 'PatchNode' | 'DuckDbEtlNode' {
  if (isQueryNode(node)) return 'QueryNode';
  if (isStartNode(node)) return 'StartNode';
  if (isEndNode(node)) return 'EndNode';
  if (isDynamicQueryNode(node)) return 'DynamicQueryNode';
  if (isRuleSetNode(node)) return 'RuleSetNode';
  if (isPatchNode(node)) return 'PatchNode';
  if (isDuckDbEtlNode(node)) return 'DuckDbEtlNode';
  throw new Error('Invalid node type');
}

/**
 * Property access helpers with proper typing
 */
export function hasQueryId(node: AnyNodeType): node is QueryNodeEntity | DynamicQueryNodeEntity | PatchNodeEntity {
  return isQueryNode(node) || isDynamicQueryNode(node) || isPatchNode(node);
}

export function hasBackendId(node: AnyNodeType): node is QueryNodeEntity | DynamicQueryNodeEntity | PatchNodeEntity {
  return isQueryNode(node) || isDynamicQueryNode(node) || isPatchNode(node);
}

export function getNodeQueryId(node: AnyNodeType): string | undefined {
  if (hasQueryId(node)) {
    return node.queryId as string | undefined;
  }
  return undefined;
}

export function getNodeBackendId(node: AnyNodeType): string | undefined {
  if (hasBackendId(node)) {
    return node.backendId as string | undefined;
  }
  return undefined;
}

/**
 * The node's ephemeral store config, or `undefined`.
 *
 * The discriminator is checked here rather than by each caller: a config whose
 * `type` is anything else is not an ephemeral backend, and treating "present"
 * as "ephemeral" is what would make a future second config kind silently
 * satisfy the "this node has a backend" test.
 *
 * Takes `unknown` rather than `AnyNodeType` because it reads one property
 * structurally and validates what it finds. The graph builder holds its nodes
 * as a wider union than `AnyNodeType`, and narrowing at each call site would
 * be a cast asserting exactly what this function is here to check.
 */
export function getNodeEphemeralBackendConfig(
  node: unknown,
): { type: 'ephemeral-oxigraph'; storeId: string } | undefined {
  const config = (node as { backendConfig?: { type?: string; storeId?: string } } | null)
    ?.backendConfig;
  if (config?.type !== 'ephemeral-oxigraph' || typeof config.storeId !== 'string') {
    return undefined;
  }
  return { type: 'ephemeral-oxigraph', storeId: config.storeId };
}

export function getNodeInputTuples(node: AnyNodeType): string[] {
  return ((node as { inputs?: string[] }).inputs || []) as string[];
}

export function getNodeOutputTuples(node: AnyNodeType): string[] {
  return ((node as { outputs?: string[] }).outputs || []) as string[];
}

export function getEtlJobVersionId(node: AnyNodeType): string | undefined {
  if (isDuckDbEtlNode(node)) {
    return node.etlJobVersionId as string | undefined;
  }
  return undefined;
}
