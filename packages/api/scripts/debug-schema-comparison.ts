#!/usr/bin/env ts-node

/**
 * Debug schema differences between working and non-working entities
 */

import { NodeParameterMappingRepository } from '../src/persistence/repositories/NodeParameterMappingRepository';

async function debugSchemaComparison() {
  console.log('🔍 Debugging schema differences...\n');

  const nodeParamRepo = new NodeParameterMappingRepository();

  try {
    // Test NodeParameterMapping (known to work)
    const testParamId = 'http://example.org/schema-debug/param1';
    
    console.log('Test 1: NodeParameterMapping (should work)');
    const param = {
      $id: testParamId,
      parameterName: 'test',
      parameterValue: 'value'
    };

    await nodeParamRepo.create(param);
    console.log('✅ NodeParameterMapping created');

    const foundParam = await nodeParamRepo.findById(testParamId);
    console.log('Found parameter:', foundParam);

    const allParams = await nodeParamRepo.findAll();
    console.log(`Found ${allParams.length} NodeParameterMappings`);

    // Cleanup
    await nodeParamRepo.delete(testParamId);

  } catch (error) {
    console.error('❌ Schema comparison debug failed:', error);
    throw error;
  }
}

debugSchemaComparison();