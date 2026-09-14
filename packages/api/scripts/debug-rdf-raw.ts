#!/usr/bin/env ts-node

import { HttpSparqlExecutor } from '../src/server/HttpSparqlExecutor';
import { config } from '../src/server/config';
import { QueryNodeRepository } from '../src/persistence/repositories/QueryNodeRepository';

async function debugRawRDF() {
  console.log('🔍 Debug: Raw RDF inspection');
  
  const backendConfig = config.internalBackend;
  
  if (backendConfig.type !== 'http') {
    throw new Error('Debug requires HTTP SPARQL backend');
  }

  const sparqlExecutor = new HttpSparqlExecutor({
    queryUrl: backendConfig.queryUrl,
    updateUrl: backendConfig.updateUrl,
    username: backendConfig.username,
    password: backendConfig.password,
  });

  const queryNodeRepo = new QueryNodeRepository();
  const testId = 'http://example.org/debug/node1';

  try {
    console.log('\n1️⃣ Creating QueryNode with LDKit...');
    await queryNodeRepo.create({
      $id: testId,
      queryId: 'http://example.org/debug/query1',
      backendId: 'http://example.org/debug/backend1',
      canvasData: JSON.stringify({ test: true })
    });
    console.log('✅ LDKit created QueryNode');

    console.log('\n2️⃣ Checking what RDF was actually created...');
    const allTriplesQuery = `
      SELECT ?s ?p ?o WHERE {
        ?s ?p ?o .
        FILTER(STRSTARTS(STR(?s), "http://example.org/debug/"))
      }
      ORDER BY ?s ?p
    `;

    const result = await sparqlExecutor.selectQueryParsed(allTriplesQuery);
    console.log('All RDF triples for our test entity:');
    console.log(JSON.stringify(result, null, 2));

    console.log('\n3️⃣ Checking specifically for QueryNode type...');
    const typeQuery = `
      SELECT ?s WHERE {
        ?s a <https://sparql-query-lib/QueryNode> .
      }
    `;

    const typeResult = await sparqlExecutor.selectQueryParsed(typeQuery);
    console.log('Entities with QueryNode type:');
    console.log(JSON.stringify(typeResult, null, 2));

    console.log('\n4️⃣ Checking what LDKit schema expects vs what was created...');
    console.log('LDKit Schema mapping:');
    console.log('  @type: https://sparql-query-lib/QueryNode');
    console.log('  queryId: https://sparql-query-lib/queryId');
    console.log('  backendId: https://sparql-query-lib/backendId');
    console.log('  canvasData: https://sparql-query-lib/canvasData');

    // Cleanup
    console.log('\n🧹 Cleaning up...');
    await queryNodeRepo.delete(testId);

  } catch (error) {
    console.error('❌ Debug failed:', error);
  }
}

debugRawRDF();