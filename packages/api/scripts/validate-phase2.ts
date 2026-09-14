#!/usr/bin/env ts-node

/**
 * Phase 2 Validation Script
 * 
 * Comprehensive validation of all Phase 2 components to ensure
 * the LDKit migration is stable and ready for Phase 3.
 */

import { 
  reconstructParamsFromMappings,
  loadNodeParameterMappingsByIds,
  createNodeParameterMappings,
  updateNodeParameterMappings,
  deleteNodeParameterMappings
} from '../src/persistence/utils/NodeParameterMappingUtils';
import { createQueryNode, QueryNodes } from '../src/persistence/utils/QueryNodeUtils';
import { config } from '../src/server/config';
import type { LdkitNodeParameterMapping } from '../src/persistence/schemas/NodeParameterMappingSchema';

interface ValidationResult {
  testName: string;
  passed: boolean;
  details: string;
  error?: Error;
}

class Phase2Validator {
  private results: ValidationResult[] = [];
  // Using LDKit utils only

  constructor() {
    const backendConfig = config.internalBackend;
    
    if (backendConfig.type !== 'http') {
      throw new Error('Validation requires HTTP SPARQL endpoint');
    }
  }

  private addResult(testName: string, passed: boolean, details: string, error?: Error) {
    this.results.push({ testName, passed, details, error });
    const status = passed ? '✅' : '❌';
    console.log(`${status} ${testName}: ${details}`);
    if (error) {
      console.log(`   Error: ${error.message}`);
    }
  }

  async runAllValidations(): Promise<void> {
    console.log('🔍 Starting Phase 2 Comprehensive Validation...\n');

    // Test 1: Basic LDKit Operations
    await this.validateBasicLdkitOps();

    // Test 2: Utility Functions
    await this.validateUtilityFunctions();

    // Test 3: Complex Workflow Simulation
    await this.validateComplexWorkflow();

    // Test 4: Error Handling and Edge Cases
    await this.validateErrorHandling();

    // Test 5: Performance and Scalability
    await this.validatePerformance();

    this.printSummary();
  }

  private async validateBasicLdkitOps(): Promise<void> {
    console.log('\n📋 Test 1: Basic LDKit Operations');
    
    const testId = 'http://example.org/validation/basic-test';
    
    try {
      // Cleanup first
      await deleteNodeParameterMappings([testId]).catch(() => {});

      // Test create
      const entity: LdkitNodeParameterMapping = {
        $id: testId,
        parameterName: 'validation_param',
        parameterValue: 'validation_value'
      };

      const created = (await createNodeParameterMappings([{ id: testId, parameterName: 'validation_param', parameterValue: 'validation_value' }]))[0]!;
      if (created.$id !== testId) {
        throw new Error('Created entity ID mismatch');
      }

      // Test read
      const found = (await loadNodeParameterMappingsByIds([testId]))[0];
      if (!found || found.parameterName !== 'validation_param') {
        throw new Error('Could not read created entity correctly');
      }

      // Test update
      const updated = (await updateNodeParameterMappings([{ id: testId, parameterValue: 'updated_value' }]))[0];
      if (!updated || updated.parameterValue !== 'updated_value') {
        throw new Error('Update operation failed');
      }

      // Test delete
      const deleted = (await deleteNodeParameterMappings([testId]))[0];
      if (!deleted) throw new Error('Delete operation failed');

      // Verify deletion
      const notFound = await loadNodeParameterMappingsByIds([testId]);
      if (notFound.length) throw new Error('Entity still exists after deletion');

      this.addResult('Basic Repository CRUD', true, 'All CRUD operations working correctly');

    } catch (error) {
      this.addResult('Basic Repository CRUD', false, 'CRUD operations failed', error as Error);
    }
  }

  private async validateUtilityFunctions(): Promise<void> {
    console.log('\n🛠️ Test 3: Utility Functions');
    
    try {
      // Test reconstructParamsFromMappings with LDKit-style inputs
      const ldkitMappings: LdkitNodeParameterMapping[] = [
        { $id: 'test1', parameterName: 'param1', parameterValue: 'value1' } as any,
        { $id: 'test2', parameterName: 'param2', parameterValue: 'value2' } as any,
      ];

      const params = reconstructParamsFromMappings(ldkitMappings);
      if (params.param1 !== 'value1' || params.param2 !== 'value2') {
        throw new Error('reconstructParamsFromMappings failed');
      }

      // Test bulk operations
      const testIds = [
        'http://example.org/validation/util1',
        'http://example.org/validation/util2'
      ];

      // Cleanup first
      await deleteNodeParameterMappings(testIds);

      // Create multiple
      const created = await createNodeParameterMappings([
        { id: testIds[0], parameterName: 'util_param1', parameterValue: 'util_value1' },
        { id: testIds[1], parameterName: 'util_param2', parameterValue: 'util_value2' }
      ]);

      if (created.length !== 2) {
        throw new Error('Bulk create failed');
      }

      // Load multiple
      const loaded = await loadNodeParameterMappingsByIds(testIds);
      
      if (loaded.length !== 2) {
        throw new Error('Bulk load failed');
      }

      // Update multiple
      const updated = await updateNodeParameterMappings([
        { id: testIds[0], parameterValue: 'updated_util_value1' }
      ]);

      if (!updated[0] || updated[0].parameterValue !== 'updated_util_value1') {
        throw new Error('Bulk update failed');
      }

      // Delete multiple
      const deleted = await deleteNodeParameterMappings(testIds);
      
      if (deleted.length !== 2 || !deleted[0] || !deleted[1]) {
        throw new Error('Bulk delete failed');
      }

      this.addResult('Utility Functions', true, 'All utility functions working correctly with mixed formats');

    } catch (error) {
      this.addResult('Utility Functions', false, 'Utility functions failed', error as Error);
    }
  }

  private async validateComplexWorkflow(): Promise<void> {
    console.log('\n🔄 Test 3: Complex Workflow Simulation');
    
    try {
      // Simulate a complex workflow: QueryNode with multiple NodeParameterMappings
      const nodeId = 'http://example.org/validation/complex-node';
      const paramIds = [
        'http://example.org/validation/complex-param1',
        'http://example.org/validation/complex-param2',
        'http://example.org/validation/complex-param3'
      ];

      // Cleanup first
      await QueryNodes.delete(nodeId).catch(() => {});
      await deleteNodeParameterMappings(paramIds);

      // Create NodeParameterMappings using LDKit
      await createNodeParameterMappings([
        { id: paramIds[0], parameterName: 'limit', parameterValue: '10' },
        { id: paramIds[1], parameterName: 'offset', parameterValue: '0' },
        { id: paramIds[2], parameterName: 'timeout', parameterValue: '30' }
      ]);

      await createQueryNode({ '@id': nodeId, queryId: 'http://example.org/validation/test-query', parameterMappings: paramIds });
      const loadedNode = await QueryNodes.findByIri(nodeId);
      if (!loadedNode || !loadedNode.parameterMappings || loadedNode.parameterMappings.length !== 3) throw new Error('ParameterMappings not set');

      // Convert to params dictionary using utility function
      const params = reconstructParamsFromMappings([
        { $id: paramIds[0], parameterName: 'limit', parameterValue: '10' },
        { $id: paramIds[1], parameterName: 'offset', parameterValue: '0' },
        { $id: paramIds[2], parameterName: 'timeout', parameterValue: '30' }
      ] as any);
      
      if (params.limit !== '10' || params.offset !== '0' || params.timeout !== '30') {
        throw new Error('Parameter reconstruction failed in complex workflow');
      }

      // Update one parameter using LDKit
      await updateNodeParameterMappings([{ id: paramIds[0], parameterValue: '20' }]);
      const reloadedNode = await QueryNodes.findByIri(nodeId);
      const reloadedMappings = reloadedNode?.parameterMappings || [];

      const updatedParams = reconstructParamsFromMappings(reloadedMappings);
      
      if (updatedParams.limit !== '20') {
        throw new Error('LDKit update not visible in QueryNode');
      }

      // Cleanup
      await QueryNodes.delete(nodeId).catch(() => {});
      await deleteNodeParameterMappings(paramIds).catch(() => {});

      this.addResult('Complex Workflow', true, 'QueryNode + NodeParameterMappings workflow works correctly with LDKit');

    } catch (error) {
      this.addResult('Complex Workflow', false, 'Complex workflow failed', error as Error);
    }
  }

  private async validateErrorHandling(): Promise<void> {
    console.log('\n🚨 Test 4: Error Handling and Edge Cases');
    
    try {
      // Test non-existent entity operations
      const nonExistentId = 'http://example.org/validation/non-existent';

      const notFound = await loadNodeParameterMappingsByIds([nonExistentId]);
      if (notFound.length !== 0) throw new Error('Expected no results for non-existent entity');

      const updateResult = (await updateNodeParameterMappings([{ id: nonExistentId, parameterValue: 'new' }]))[0];
      if (updateResult !== undefined) throw new Error('Expected undefined for update of non-existent entity');

      const deleteResult = (await deleteNodeParameterMappings([nonExistentId]))[0];
      if (deleteResult !== false) throw new Error('Expected false for delete of non-existent entity');

      // Test empty/invalid inputs
      const emptyParams = reconstructParamsFromMappings(undefined);
      if (Object.keys(emptyParams).length !== 0) {
        throw new Error('Expected empty object for undefined input');
      }

      const emptyArrayParams = reconstructParamsFromMappings([]);
      if (Object.keys(emptyArrayParams).length !== 0) {
        throw new Error('Expected empty object for empty array input');
      }

      // Test malformed data handling
      const malformedMappings = [
        { $id: 'test', parameterName: undefined, parameterValue: 'value' },
        { $id: 'test2', parameterName: 'name', parameterValue: undefined }
      ] as any;

      const malformedParams = reconstructParamsFromMappings(malformedMappings);
      if (Object.keys(malformedParams).length !== 0) {
        throw new Error('Expected empty object for malformed mappings');
      }

      this.addResult('Error Handling', true, 'All error cases handled gracefully');

    } catch (error) {
      this.addResult('Error Handling', false, 'Error handling failed', error as Error);
    }
  }

  private async validatePerformance(): Promise<void> {
    console.log('\n⚡ Test 8: Performance and Scalability');
    
    try {
      const startTime = Date.now();
      const batchSize = 10;
      const testIds: string[] = [];

      // Generate test IDs
      for (let i = 0; i < batchSize; i++) {
        testIds.push(`http://example.org/validation/perf-test-${i}`);
      }

      // Cleanup first
      await deleteNodeParameterMappings(testIds);

      // Measure bulk create performance
      const createStartTime = Date.now();
      const createData = testIds.map((id, index) => ({
        id,
        parameterName: `perf_param_${index}`,
        parameterValue: `perf_value_${index}`
      }));

      const created = await createNodeParameterMappings(createData);
      const createTime = Date.now() - createStartTime;

      if (created.length !== batchSize) {
        throw new Error(`Expected ${batchSize} entities created, got ${created.length}`);
      }

      // Measure bulk load performance
      const loadStartTime = Date.now();
      const loaded = await loadNodeParameterMappingsByIds(testIds);
      const loadTime = Date.now() - loadStartTime;

      if (loaded.length !== batchSize) {
        throw new Error(`Expected ${batchSize} entities loaded, got ${loaded.length}`);
      }

      // Measure bulk delete performance
      const deleteStartTime = Date.now();
      const deleted = await deleteNodeParameterMappings(testIds);
      const deleteTime = Date.now() - deleteStartTime;

      const successfulDeletes = deleted.filter(result => result).length;
      if (successfulDeletes !== batchSize) {
        throw new Error(`Expected ${batchSize} successful deletes, got ${successfulDeletes}`);
      }

      const totalTime = Date.now() - startTime;

      const details = `Batch operations (${batchSize} entities): Create=${createTime}ms, Load=${loadTime}ms, Delete=${deleteTime}ms, Total=${totalTime}ms`;
      
      // Performance thresholds (reasonable for test environment)
      if (totalTime > 5000) { // 5 seconds for 10 entities should be more than enough
        throw new Error(`Performance too slow: ${totalTime}ms for ${batchSize} entities`);
      }

      this.addResult('Performance', true, details);

    } catch (error) {
      this.addResult('Performance', false, 'Performance test failed', error as Error);
    }
  }

  private printSummary(): void {
    console.log('\n' + '='.repeat(80));
    console.log('📊 PHASE 2 VALIDATION SUMMARY');
    console.log('='.repeat(80));

    const passed = this.results.filter(r => r.passed).length;
    const total = this.results.length;
    const failed = total - passed;

    console.log(`\n🎯 Overall Result: ${passed}/${total} tests passed`);
    
    if (failed === 0) {
      console.log('🎉 ALL VALIDATIONS PASSED! Phase 2 is solid and ready for Phase 3!');
    } else {
      console.log(`❌ ${failed} validation(s) failed. Review issues before proceeding to Phase 3.`);
    }

    console.log('\n📋 Detailed Results:');
    this.results.forEach((result, index) => {
      const status = result.passed ? '✅' : '❌';
      console.log(`${index + 1}. ${status} ${result.testName}`);
      if (!result.passed && result.error) {
        console.log(`   Error: ${result.error.message}`);
      }
    });

    console.log('\n' + '='.repeat(80));
  }
}

async function main() {
  const validator = new Phase2Validator();
  await validator.runAllValidations();
}

// Allow running this file directly
if (require.main === module) {
  main()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Validation failed:', error);
      process.exit(1);
    });
}

export { Phase2Validator };
