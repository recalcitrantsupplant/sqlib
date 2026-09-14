import { QueryTypeIri } from '../../src/constants/queryTypes.js';
// --- Common Test Data ---
// Construct a LDKit-shaped StoredQuery entity used by tests

export const commonQueryId = 'urn:sqlib:query:common-test';
export const commonEncodedQueryId = encodeURIComponent(commonQueryId);

export const commonExistingQuery = {
  $id: commonQueryId,
  name: 'Common Query Name',
  description: 'Common Desc',
  query: 'SELECT ?s WHERE { ?s a <urn:type:CommonThing> }',
  queryType: QueryTypeIri.select,
  outputVars: [],
  parameterGroups: [],
  limitParameters: [],
  offsetParameters: [],
  'https://schema.org/isPartOf': ['urn:test-library:common'],
  'https://schema.org/dateCreated': new Date().toISOString(),
  'https://schema.org/dateModified': new Date().toISOString(),
};