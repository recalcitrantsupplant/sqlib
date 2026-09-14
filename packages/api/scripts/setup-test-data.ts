#!/usr/bin/env ts-node

/**
 * Script to set up test data for the LDKit migration comparison
 * 
 * This creates sample data using LDKit utilities.
*/

import { config } from '../src/server/config';
import { createLibrary, Libraries } from '../src/persistence/utils/LibraryUtils';
import { createStoredQuery, StoredQueries } from '../src/persistence/utils/StoredQueryUtils';
import { createNodeParameterMappings } from '../src/persistence/utils/NodeParameterMappingUtils';
import { createQueryNode, QueryNodes } from '../src/persistence/utils/QueryNodeUtils';
import { createQueryGroup, QueryGroups } from '../src/persistence/utils/QueryGroupUtils';

async function setupTestData() {
  console.log('🚀 Setting up test data for LDKit migration comparison...\n');

  // Ensure HTTP backend is configured
  const backendConfig = config.internalBackend;
  if (backendConfig.type !== 'http') throw new Error('Test data setup requires HTTP SPARQL endpoint');

  try {
    // 1. Create a test library
    console.log('📚 Creating test library...');
    const testLibrary = await createLibrary({
      $id: 'http://example.org/migration-test/library1',
      name: 'Migration Test Library',
      description: 'Library for testing LDKit migration'
    });
    console.log('✅ Test library created');

    // 2. Create a test stored query
    console.log('📝 Creating test stored query...');
    const testQuery = await createStoredQuery({
      '@id': 'http://example.org/migration-test/query1',
      name: 'Test Query for Migration',
      description: 'A test query with parameters',
      query: 'SELECT ?subject ?predicate ?object WHERE { ?subject ?predicate ?object } LIMIT ?limit OFFSET ?offset',
      queryType: 'SELECT',
      'https://schema.org/isPartOf': testLibrary.$id
    });
    console.log('✅ Test query created');

    // 3. Create NodeParameterMapping entities
    console.log('🔧 Creating NodeParameterMapping entities...');
    await createNodeParameterMappings([
      { id: 'http://example.org/migration-test/param-mapping1', parameterName: 'limit', parameterValue: '10' },
      { id: 'http://example.org/migration-test/param-mapping2', parameterName: 'offset', parameterValue: '0' },
      { id: 'http://example.org/migration-test/param-mapping3', parameterName: 'maxResults', parameterValue: '100' }
    ]);

    // 4. Create QueryNodes with parameterMappings
    console.log('🎯 Creating test QueryNodes...');
    await createQueryNode({ '@id': 'http://example.org/migration-test/node1', queryId: testQuery['@id'], parameterMappings: ['http://example.org/migration-test/param-mapping1','http://example.org/migration-test/param-mapping2'] });
    await createQueryNode({ '@id': 'http://example.org/migration-test/node2', queryId: testQuery['@id'], parameterMappings: ['http://example.org/migration-test/param-mapping3'] });
    console.log('✅ Test QueryNodes created with NodeParameterMappings');

    // 5. Create a QueryGroup to contain the nodes
    console.log('📊 Creating test QueryGroup...');
    await createQueryGroup({ '@id': 'http://example.org/migration-test/group1', name: 'Migration Test Group', description: 'A test group containing nodes with parameter mappings', nodes: ['http://example.org/migration-test/node1','http://example.org/migration-test/node2'], edges: [], startNodeIds: ['http://example.org/migration-test/node1'], endNodeIds: ['http://example.org/migration-test/node2'], 'https://schema.org/isPartOf': testLibrary.$id });
    console.log('✅ Test QueryGroup created');

    // 6. Verify data was created
    console.log('\n🔍 Verifying test data...');
    const [nodes, stored] = await Promise.all([
      QueryNodes.find(),
      StoredQueries.find()
    ]);
    console.log(`✅ QueryNode entities present: ${nodes.length}`);
    console.log(`✅ StoredQuery entities present: ${stored.length}`);

    console.log('\n🎉 Test data setup completed successfully!');
    console.log('\nNow you can run validation scripts as needed.');

  } catch (error) {
    console.error('❌ Error setting up test data:', error);
    throw error;
  }
}

// Allow running this file directly
if (require.main === module) {
  setupTestData()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Test data setup failed:', error);
      process.exit(1);
    });
}

export { setupTestData };
