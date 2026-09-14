#!/usr/bin/env ts-node

import { NodeParameterMappingRepository } from '../src/persistence/repositories/NodeParameterMappingRepository';

async function debugNodeParamMapping() {
  console.log('🔍 Debugging NodeParameterMappingRepository...');

  const repo = new NodeParameterMappingRepository();
  const testId = 'http://example.org/debug/mapping1';

  try {
    // Test 1: Find all
    console.log('\nTest 1: Find all NodeParameterMappings');
    const allMappings = await repo.findAll();
    console.log(`Found ${allMappings.length} mappings:`, allMappings);

    // Test 2: Create one
    console.log('\nTest 2: Create NodeParameterMapping');
    await repo.create({
      $id: testId,
      parameterName: 'testParam',
      parameterValue: 'testValue'
    });
    console.log('✅ Created mapping');

    // Test 3: Find it
    console.log('\nTest 3: Find created mapping');
    const foundMapping = await repo.findById(testId);
    console.log('Found mapping:', foundMapping);

    // Test 4: Find all again
    console.log('\nTest 4: Find all again');
    const allMappings2 = await repo.findAll();
    console.log(`Found ${allMappings2.length} mappings`);

    // Cleanup
    await repo.delete(testId);

  } catch (error) {
    console.error('❌ Debug failed:', error);
  }
}

debugNodeParamMapping();