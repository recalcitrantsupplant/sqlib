#!/usr/bin/env ts-node

/**
 * Debug QueryNode LDKit integration
 */

import { QueryNodeRepository } from '../src/persistence/repositories/QueryNodeRepository';
import { NodeParameterMappingRepository } from '../src/persistence/repositories/NodeParameterMappingRepository';

async function debugQueryNode() {
  console.log('🔍 Debugging QueryNode LDKit integration...\n');

  const queryNodeRepo = new QueryNodeRepository();
  const nodeParameterMappingRepo = new NodeParameterMappingRepository();

  const testNodeId = 'http://example.org/debug/node1';
  const testParamId = 'http://example.org/debug/param1';

  try {
    // Cleanup
    await queryNodeRepo.delete(testNodeId).catch(() => {});
    await nodeParameterMappingRepo.delete(testParamId).catch(() => {});

    // Test 1: Simple QueryNode creation
    console.log('Test 1: Simple QueryNode creation');
    const simpleNode = {
      $id: testNodeId,
      queryId: 'http://example.org/debug/query1',
      canvasData: JSON.stringify({ x: 100, y: 100 })
    };

    await queryNodeRepo.create(simpleNode);
    console.log('✅ Simple QueryNode created');

    // Test 2: Retrieve using LDKit
    const retrievedNode = await queryNodeRepo.findById(testNodeId);
    console.log('✅ QueryNode retrieved:', retrievedNode);

    // Test 3: Create parameter mapping separately
    const paramMapping = {
      $id: testParamId,
      parameterName: 'limit',
      parameterValue: '10'
    };

    await nodeParameterMappingRepo.create(paramMapping);
    console.log('✅ Parameter mapping created');

    // Test 4: Update QueryNode to reference parameter mapping
    await queryNodeRepo.update(testNodeId, {
      parameterMappings: testParamId
    });
    console.log('✅ QueryNode updated with parameter mapping reference');

    // Test 5: Retrieve with parameter mappings
    const nodeWithParams = await queryNodeRepo.findByIdWithParameterMappings(testNodeId);
    console.log('✅ QueryNode with parameters:', nodeWithParams);

    // Cleanup
    await queryNodeRepo.delete(testNodeId);
    await nodeParameterMappingRepo.delete(testParamId);

  } catch (error) {
    console.error('❌ Debug failed:', error);
  }
}

debugQueryNode();