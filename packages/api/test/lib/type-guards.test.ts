import { describe, it, expect } from 'vitest';
import { QueryTypeIri } from '../../src/constants/queryTypes.js';
import {
  isQueryNode,
  isStartNode,
  isEndNode,
  isDynamicQueryNode,
  isQueryEdge,
  isQueryGroup,
  isQueryGroupVersion,
  isQueryVersion,
  isQueryIdInput,
  isQueryInputTuple,
  isQueryOutputTuple,
  isTriplesQuadsIO,
  isBooleanIO,
  isAnyNode,
  getNodeType,
  hasQueryId,
  hasBackendId,
  getNodeQueryId,
  getNodeBackendId,
  getNodeInputTuples,
  getNodeOutputTuples,
} from '../../src/lib/type-guards.js';
import type { LdkitQueryNode } from '../../src/persistence/schemas/QueryNodeSchema.js';
import type { LdkitStartNode } from '../../src/persistence/schemas/StartNodeSchema.js';
import type { LdkitEndNode } from '../../src/persistence/schemas/EndNodeSchema.js';
import type { LdkitDynamicQueryNode } from '../../src/persistence/schemas/DynamicQueryNodeSchema.js';
import type { LdkitQueryEdge } from '../../src/persistence/schemas/QueryEdgeSchema.js';
import type { LdkitQueryGroup } from '../../src/persistence/schemas/QueryGroupSchema.js';
import type { LdkitQueryGroupVersion } from '../../src/persistence/schemas/QueryGroupVersionSchema.js';
import type { LdkitQueryVersion } from '../../src/persistence/schemas/QueryVersionSchema.js';
import type { LdkitQueryInputTuple } from '../../src/persistence/schemas/QueryInputTupleSchema.js';
import type { LdkitQueryOutputTuple } from '../../src/persistence/schemas/QueryOutputTupleSchema.js';
import type { LdkitTriplesQuadsIO } from '../../src/persistence/schemas/TriplesQuadsIOSchema.js';
import type { LdkitBooleanIO } from '../../src/persistence/schemas/BooleanIOSchema.js';

describe('Type Guards', () => {
  describe('isQueryNode', () => {
    it('should return true for valid QueryNode', () => {
      const queryNode: LdkitQueryNode = {
        '@type': 'QueryNode',
        $id: 'urn:test:node:1',
        queryId: 'urn:test:query:1',
        backendId: 'urn:test:backend:1',
        inputs: [],
        outputs: [],
      };

      expect(isQueryNode(queryNode)).toBe(true);
    });

    it('should return false for StartNode', () => {
      const startNode: LdkitStartNode = {
        '@type': 'StartNode',
        $id: 'urn:test:start:1',
        outputs: [],
      };

      expect(isQueryNode(startNode)).toBe(false);
    });

    it('should return false for null', () => {
      expect(isQueryNode(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isQueryNode(undefined)).toBe(false);
    });

    it('should return false for object without @type', () => {
      const obj = {
        $id: 'urn:test:node:1',
        queryId: 'urn:test:query:1',
      };

      expect(isQueryNode(obj)).toBe(false);
    });

    it('should return false for object without $id', () => {
      const obj = {
        '@type': 'QueryNode',
        queryId: 'urn:test:query:1',
      };

      expect(isQueryNode(obj)).toBe(false);
    });

    it('should return false for primitive values', () => {
      expect(isQueryNode('string')).toBe(false);
      expect(isQueryNode(123)).toBe(false);
      expect(isQueryNode(true)).toBe(false);
    });
  });

  describe('isStartNode', () => {
    it('should return true for valid StartNode', () => {
      const startNode: LdkitStartNode = {
        '@type': 'StartNode',
        $id: 'urn:test:start:1',
        outputs: [],
      };

      expect(isStartNode(startNode)).toBe(true);
    });

    it('should return false for QueryNode', () => {
      const queryNode: LdkitQueryNode = {
        '@type': 'QueryNode',
        $id: 'urn:test:node:1',
        queryId: 'urn:test:query:1',
        backendId: 'urn:test:backend:1',
        inputs: [],
        outputs: [],
      };

      expect(isStartNode(queryNode)).toBe(false);
    });

    it('should return false for malformed object', () => {
      const malformed = {
        '@type': 'StartNode',
        // missing $id
      };

      expect(isStartNode(malformed)).toBe(false);
    });
  });

  describe('isEndNode', () => {
    it('should return true for valid EndNode', () => {
      const endNode: LdkitEndNode = {
        '@type': 'EndNode',
        $id: 'urn:test:end:1',
      };

      expect(isEndNode(endNode)).toBe(true);
    });

    it('should return false for other node types', () => {
      const queryNode: LdkitQueryNode = {
        '@type': 'QueryNode',
        $id: 'urn:test:node:1',
        queryId: 'urn:test:query:1',
        backendId: 'urn:test:backend:1',
        inputs: [],
        outputs: [],
      };

      expect(isEndNode(queryNode)).toBe(false);
    });
  });

  describe('isDynamicQueryNode', () => {
    it('should return true for valid DynamicQueryNode', () => {
      const dynamicNode: LdkitDynamicQueryNode = {
        '@type': 'DynamicQueryNode',
        $id: 'urn:test:dynamic:1',
        queryId: 'urn:test:query:1',
        backendId: 'urn:test:backend:1',
        inputs: [],
        outputs: [],
      };

      expect(isDynamicQueryNode(dynamicNode)).toBe(true);
    });

    it('should return false for QueryNode', () => {
      const queryNode: LdkitQueryNode = {
        '@type': 'QueryNode',
        $id: 'urn:test:node:1',
        queryId: 'urn:test:query:1',
        backendId: 'urn:test:backend:1',
        inputs: [],
        outputs: [],
      };

      expect(isDynamicQueryNode(queryNode)).toBe(false);
    });
  });

  describe('isQueryEdge', () => {
    it('should return true for valid QueryEdge', () => {
      const edge: LdkitQueryEdge = {
        '@type': 'QueryEdge',
        $id: 'urn:test:edge:1',
        sourceNodeId: 'urn:test:node:1',
        targetNodeId: 'urn:test:node:2',
      };

      expect(isQueryEdge(edge)).toBe(true);
    });

    it('should return false for non-edge entity', () => {
      const node: LdkitQueryNode = {
        '@type': 'QueryNode',
        $id: 'urn:test:node:1',
        queryId: 'urn:test:query:1',
        backendId: 'urn:test:backend:1',
        inputs: [],
        outputs: [],
      };

      expect(isQueryEdge(node)).toBe(false);
    });
  });

  describe('isQueryGroup', () => {
    it('should return true for valid QueryGroup', () => {
      const group: LdkitQueryGroup = {
        '@type': 'QueryGroup',
        name: 'Test Group',
        isPartOf: 'urn:test:library:1',
        $id: 'urn:test:group:1',
      };

      expect(isQueryGroup(group)).toBe(true);
    });

    it('should return false for QueryGroupVersion', () => {
      const version: LdkitQueryGroupVersion = {
        '@type': 'QueryGroupVersion',
        version: 1,
        $id: 'urn:test:version:1',
        executionNodes: [],
        edges: [],
        isPartOf: 'urn:test:group:1',
      };

      expect(isQueryGroup(version)).toBe(false);
    });
  });

  describe('isQueryGroupVersion', () => {
    it('should return true for valid QueryGroupVersion', () => {
      const version: LdkitQueryGroupVersion = {
        '@type': 'QueryGroupVersion',
        version: 1,
        $id: 'urn:test:version:1',
        executionNodes: [],
        edges: [],
        isPartOf: 'urn:test:group:1',
      };

      expect(isQueryGroupVersion(version)).toBe(true);
    });

    it('should return false for QueryGroup', () => {
      const group: LdkitQueryGroup = {
        '@type': 'QueryGroup',
        name: 'Test Group',
        isPartOf: 'urn:test:library:1',
        $id: 'urn:test:group:1',
      };

      expect(isQueryGroupVersion(group)).toBe(false);
    });
  });

  describe('isQueryVersion', () => {
    it('should return true for valid QueryVersion', () => {
      const version: LdkitQueryVersion = {
        '@type': 'QueryVersion',
        $id: 'urn:test:query-version:1',
        queryString: 'SELECT * WHERE { ?s ?p ?o }',
        version: 1,
        queryType: QueryTypeIri.select,
        isPartOf: 'urn:test:query:1',
      };

      expect(isQueryVersion(version)).toBe(true);
    });

    it('should return false for other entity types', () => {
      const group: LdkitQueryGroup = {
        '@type': 'QueryGroup',
        name: 'Test Group',
        isPartOf: 'urn:test:library:1',
        $id: 'urn:test:group:1',
      };

      expect(isQueryVersion(group)).toBe(false);
    });
  });

  describe('isQueryIdInput', () => {
    it('should return true for valid QueryIdInput', () => {
      const queryIdInput = {
        '@type': 'QueryIdInput',
        $id: 'urn:test:query-id-input:1',
      };

      expect(isQueryIdInput(queryIdInput)).toBe(true);
    });

    it('should return false for other types', () => {
      const group: LdkitQueryGroup = {
        '@type': 'QueryGroup',
        name: 'Test Group',
        isPartOf: 'urn:test:library:1',
        $id: 'urn:test:group:1',
      };

      expect(isQueryIdInput(group)).toBe(false);
    });
  });

  describe('isQueryInputTuple', () => {
    it('should return true for valid QueryInputTuple', () => {
      const inputTuple: LdkitQueryInputTuple = {
        '@type': 'QueryInputTuple',
        $id: 'urn:test:input-tuple:1',
        memberEntries: [],
      };

      expect(isQueryInputTuple(inputTuple)).toBe(true);
    });

    it('should return false for QueryOutputTuple', () => {
      const outputTuple: LdkitQueryOutputTuple = {
        '@type': 'QueryOutputTuple',
        name: 'Test Tuple',
        $id: 'urn:test:output-tuple:1',
        memberEntries: [],
      };

      expect(isQueryInputTuple(outputTuple)).toBe(false);
    });
  });

  describe('isQueryOutputTuple', () => {
    it('should return true for valid QueryOutputTuple', () => {
      const outputTuple: LdkitQueryOutputTuple = {
        '@type': 'QueryOutputTuple',
        name: 'Test Tuple',
        $id: 'urn:test:output-tuple:1',
        memberEntries: [],
      };

      expect(isQueryOutputTuple(outputTuple)).toBe(true);
    });

    it('should return false for QueryInputTuple', () => {
      const inputTuple: LdkitQueryInputTuple = {
        '@type': 'QueryInputTuple',
        $id: 'urn:test:input-tuple:1',
        memberEntries: [],
      };

      expect(isQueryOutputTuple(inputTuple)).toBe(false);
    });
  });

  describe('isTriplesQuadsIO', () => {
    it('should return true for valid TriplesQuadsIO', () => {
      const triplesIO: LdkitTriplesQuadsIO = {
        '@type': 'TriplesQuadsIO',
        $id: 'urn:test:triples-io:1',
      };

      expect(isTriplesQuadsIO(triplesIO)).toBe(true);
    });

    it('should return false for other types', () => {
      const booleanIO: LdkitBooleanIO = {
        '@type': 'BooleanIO',
        $id: 'urn:test:boolean-io:1',
      };

      expect(isTriplesQuadsIO(booleanIO)).toBe(false);
    });
  });

  describe('isBooleanIO', () => {
    it('should return true for valid BooleanIO', () => {
      const booleanIO: LdkitBooleanIO = {
        '@type': 'BooleanIO',
        $id: 'urn:test:boolean-io:1',
      };

      expect(isBooleanIO(booleanIO)).toBe(true);
    });

    it('should return false for TriplesQuadsIO', () => {
      const triplesIO: LdkitTriplesQuadsIO = {
        '@type': 'TriplesQuadsIO',
        $id: 'urn:test:triples-io:1',
      };

      expect(isBooleanIO(triplesIO)).toBe(false);
    });
  });

  describe('isAnyNode', () => {
    it('should return true for QueryNode', () => {
      const queryNode: LdkitQueryNode = {
        '@type': 'QueryNode',
        $id: 'urn:test:node:1',
        queryId: 'urn:test:query:1',
        backendId: 'urn:test:backend:1',
        inputs: [],
        outputs: [],
      };

      expect(isAnyNode(queryNode)).toBe(true);
    });

    it('should return true for StartNode', () => {
      const startNode: LdkitStartNode = {
        '@type': 'StartNode',
        $id: 'urn:test:start:1',
        outputs: [],
      };

      expect(isAnyNode(startNode)).toBe(true);
    });

    it('should return true for EndNode', () => {
      const endNode: LdkitEndNode = {
        '@type': 'EndNode',
        $id: 'urn:test:end:1',
      };

      expect(isAnyNode(endNode)).toBe(true);
    });

    it('should return true for DynamicQueryNode', () => {
      const dynamicNode: LdkitDynamicQueryNode = {
        '@type': 'DynamicQueryNode',
        $id: 'urn:test:dynamic:1',
        queryId: 'urn:test:query:1',
        backendId: 'urn:test:backend:1',
        inputs: [],
        outputs: [],
      };

      expect(isAnyNode(dynamicNode)).toBe(true);
    });

    it('should return false for non-node entities', () => {
      const edge: LdkitQueryEdge = {
        '@type': 'QueryEdge',
        $id: 'urn:test:edge:1',
        sourceNodeId: 'urn:test:node:1',
        targetNodeId: 'urn:test:node:2',
      };

      expect(isAnyNode(edge)).toBe(false);
    });

    it('should return false for null/undefined', () => {
      expect(isAnyNode(null)).toBe(false);
      expect(isAnyNode(undefined)).toBe(false);
    });
  });

  describe('getNodeType', () => {
    it('should return QueryNode for QueryNode type', () => {
      const queryNode: LdkitQueryNode = {
        '@type': 'QueryNode',
        $id: 'urn:test:node:1',
        queryId: 'urn:test:query:1',
        backendId: 'urn:test:backend:1',
        inputs: [],
        outputs: [],
      };

      expect(getNodeType(queryNode)).toBe('QueryNode');
    });

    it('should return StartNode for StartNode type', () => {
      const startNode: LdkitStartNode = {
        '@type': 'StartNode',
        $id: 'urn:test:start:1',
        outputs: [],
      };

      expect(getNodeType(startNode)).toBe('StartNode');
    });

    it('should return EndNode for EndNode type', () => {
      const endNode: LdkitEndNode = {
        '@type': 'EndNode',
        $id: 'urn:test:end:1',
      };

      expect(getNodeType(endNode)).toBe('EndNode');
    });

    it('should return DynamicQueryNode for DynamicQueryNode type', () => {
      const dynamicNode: LdkitDynamicQueryNode = {
        '@type': 'DynamicQueryNode',
        $id: 'urn:test:dynamic:1',
        queryId: 'urn:test:query:1',
        backendId: 'urn:test:backend:1',
        inputs: [],
        outputs: [],
      };

      expect(getNodeType(dynamicNode)).toBe('DynamicQueryNode');
    });

    it('should throw error for invalid node type', () => {
      const invalidNode = {
        '@type': 'InvalidType',
        $id: 'urn:test:invalid:1',
      } as any;

      expect(() => getNodeType(invalidNode)).toThrow('Invalid node type');
    });
  });

  describe('hasQueryId', () => {
    it('should return true for QueryNode', () => {
      const queryNode: LdkitQueryNode = {
        '@type': 'QueryNode',
        $id: 'urn:test:node:1',
        queryId: 'urn:test:query:1',
        backendId: 'urn:test:backend:1',
        inputs: [],
        outputs: [],
      };

      expect(hasQueryId(queryNode)).toBe(true);
    });

    it('should return true for DynamicQueryNode', () => {
      const dynamicNode: LdkitDynamicQueryNode = {
        '@type': 'DynamicQueryNode',
        $id: 'urn:test:dynamic:1',
        queryId: 'urn:test:query:1',
        backendId: 'urn:test:backend:1',
        inputs: [],
        outputs: [],
      };

      expect(hasQueryId(dynamicNode)).toBe(true);
    });

    it('should return false for StartNode', () => {
      const startNode: LdkitStartNode = {
        '@type': 'StartNode',
        $id: 'urn:test:start:1',
        outputs: [],
      };

      expect(hasQueryId(startNode)).toBe(false);
    });

    it('should return false for EndNode', () => {
      const endNode: LdkitEndNode = {
        '@type': 'EndNode',
        $id: 'urn:test:end:1',
      };

      expect(hasQueryId(endNode)).toBe(false);
    });
  });

  describe('hasBackendId', () => {
    it('should return true for QueryNode', () => {
      const queryNode: LdkitQueryNode = {
        '@type': 'QueryNode',
        $id: 'urn:test:node:1',
        queryId: 'urn:test:query:1',
        backendId: 'urn:test:backend:1',
        inputs: [],
        outputs: [],
      };

      expect(hasBackendId(queryNode)).toBe(true);
    });

    it('should return true for DynamicQueryNode', () => {
      const dynamicNode: LdkitDynamicQueryNode = {
        '@type': 'DynamicQueryNode',
        $id: 'urn:test:dynamic:1',
        queryId: 'urn:test:query:1',
        backendId: 'urn:test:backend:1',
        inputs: [],
        outputs: [],
      };

      expect(hasBackendId(dynamicNode)).toBe(true);
    });

    it('should return false for StartNode', () => {
      const startNode: LdkitStartNode = {
        '@type': 'StartNode',
        $id: 'urn:test:start:1',
        outputs: [],
      };

      expect(hasBackendId(startNode)).toBe(false);
    });
  });

  describe('getNodeQueryId', () => {
    it('should return queryId for QueryNode', () => {
      const queryNode: LdkitQueryNode = {
        '@type': 'QueryNode',
        $id: 'urn:test:node:1',
        queryId: 'urn:test:query:1',
        backendId: 'urn:test:backend:1',
        inputs: [],
        outputs: [],
      };

      expect(getNodeQueryId(queryNode)).toBe('urn:test:query:1');
    });

    it('should return queryId for DynamicQueryNode', () => {
      const dynamicNode: LdkitDynamicQueryNode = {
        '@type': 'DynamicQueryNode',
        $id: 'urn:test:dynamic:1',
        queryId: 'urn:test:query:1',
        backendId: 'urn:test:backend:1',
        inputs: [],
        outputs: [],
      };

      expect(getNodeQueryId(dynamicNode)).toBe('urn:test:query:1');
    });

    it('should return undefined for StartNode', () => {
      const startNode: LdkitStartNode = {
        '@type': 'StartNode',
        $id: 'urn:test:start:1',
        outputs: [],
      };

      expect(getNodeQueryId(startNode)).toBeUndefined();
    });

    it('should return undefined for EndNode', () => {
      const endNode: LdkitEndNode = {
        '@type': 'EndNode',
        $id: 'urn:test:end:1',
      };

      expect(getNodeQueryId(endNode)).toBeUndefined();
    });
  });

  describe('getNodeBackendId', () => {
    it('should return backendId for QueryNode', () => {
      const queryNode: LdkitQueryNode = {
        '@type': 'QueryNode',
        $id: 'urn:test:node:1',
        queryId: 'urn:test:query:1',
        backendId: 'urn:test:backend:1',
        inputs: [],
        outputs: [],
      };

      expect(getNodeBackendId(queryNode)).toBe('urn:test:backend:1');
    });

    it('should return backendId for DynamicQueryNode', () => {
      const dynamicNode: LdkitDynamicQueryNode = {
        '@type': 'DynamicQueryNode',
        $id: 'urn:test:dynamic:1',
        queryId: 'urn:test:query:1',
        backendId: 'urn:test:backend:1',
        inputs: [],
        outputs: [],
      };

      expect(getNodeBackendId(dynamicNode)).toBe('urn:test:backend:1');
    });

    it('should return undefined for StartNode', () => {
      const startNode: LdkitStartNode = {
        '@type': 'StartNode',
        $id: 'urn:test:start:1',
        outputs: [],
      };

      expect(getNodeBackendId(startNode)).toBeUndefined();
    });
  });

  describe('getNodeInputTuples', () => {
    it('should return inputs array for QueryNode', () => {
      const queryNode: LdkitQueryNode = {
        '@type': 'QueryNode',
        $id: 'urn:test:node:1',
        queryId: 'urn:test:query:1',
        backendId: 'urn:test:backend:1',
        inputs: ['urn:test:input:1', 'urn:test:input:2'],
        outputs: [],
      };

      expect(getNodeInputTuples(queryNode)).toEqual(['urn:test:input:1', 'urn:test:input:2']);
    });

    it('should return empty array when inputs is undefined', () => {
      const queryNode = {
        '@type': 'QueryNode',
        $id: 'urn:test:node:1',
        queryId: 'urn:test:query:1',
        backendId: 'urn:test:backend:1',
        outputs: [],
      } as LdkitQueryNode;

      expect(getNodeInputTuples(queryNode)).toEqual([]);
    });

    it('should return empty array for StartNode (no inputs)', () => {
      const startNode: LdkitStartNode = {
        '@type': 'StartNode',
        $id: 'urn:test:start:1',
        outputs: [],
      };

      expect(getNodeInputTuples(startNode)).toEqual([]);
    });
  });

  describe('getNodeOutputTuples', () => {
    it('should return outputs array for QueryNode', () => {
      const queryNode: LdkitQueryNode = {
        '@type': 'QueryNode',
        $id: 'urn:test:node:1',
        queryId: 'urn:test:query:1',
        backendId: 'urn:test:backend:1',
        inputs: [],
        outputs: ['urn:test:output:1', 'urn:test:output:2'],
      };

      expect(getNodeOutputTuples(queryNode)).toEqual(['urn:test:output:1', 'urn:test:output:2']);
    });

    it('should return empty array when outputs is undefined', () => {
      const queryNode = {
        '@type': 'QueryNode',
        $id: 'urn:test:node:1',
        queryId: 'urn:test:query:1',
        backendId: 'urn:test:backend:1',
        inputs: [],
      } as LdkitQueryNode;

      expect(getNodeOutputTuples(queryNode)).toEqual([]);
    });

    it('should return outputs for StartNode', () => {
      const startNode: LdkitStartNode = {
        '@type': 'StartNode',
        $id: 'urn:test:start:1',
        outputs: ['urn:test:output:1'],
      };

      expect(getNodeOutputTuples(startNode)).toEqual(['urn:test:output:1']);
    });

  });

  describe('Edge cases', () => {
    it('should handle objects with numeric $id', () => {
      const obj = {
        '@type': 'QueryNode',
        $id: 123, // numeric instead of string
      };

      expect(isQueryNode(obj)).toBe(false);
    });

    it('should handle objects with numeric @type', () => {
      const obj = {
        '@type': 123, // numeric instead of string
        $id: 'urn:test:node:1',
      };

      expect(isQueryNode(obj)).toBe(false);
    });

    it('should handle empty strings for $id and @type', () => {
      const obj = {
        '@type': '',
        $id: '',
      };

      expect(isQueryNode(obj)).toBe(false);
    });

    it('should handle arrays', () => {
      expect(isQueryNode([])).toBe(false);
      expect(isStartNode([{ '@type': 'StartNode', $id: 'test' }])).toBe(false);
    });
  });
});