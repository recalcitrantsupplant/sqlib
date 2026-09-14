export const SYSTEM_LIBRARY_ID = 'https://sparql-query-lib/system/library';

export const SYSTEM_QUERY_METADATA = {
  libraryCollection: {
    key: 'libraryCollection',
    queryId: 'https://sparql-query-lib/system/queries/library-collection',
    versionId: 'https://sparql-query-lib/system/query-versions/library-collection@v1',
    name: 'System Library Collection Export',
    description: 'Constructs RDF triples for every stored Library entity.',
  },
  libraryDescribe: {
    key: 'libraryDescribe',
    queryId: 'https://sparql-query-lib/system/queries/library-describe',
    versionId: 'https://sparql-query-lib/system/query-versions/library-describe@v1',
    name: 'System Single Library Export',
    description: 'Constructs RDF triples for a specific Library entity.',
  },
  getQueries: {
    key: 'getQueries',
    queryId: 'https://sparql-query-lib/system/queries/get-queries',
    versionId: 'https://sparql-query-lib/system/query-versions/get-queries@v1',
    name: 'System Query Export',
    description: 'Constructs RDF triples for Queries (optionally filtered by ?query).',
  },
  getRules: {
    key: 'getRules',
    queryId: 'https://sparql-query-lib/system/queries/get-rules',
    versionId: 'https://sparql-query-lib/system/query-versions/get-rules@v1',
    name: 'System Rule Export',
    description: 'Constructs RDF triples for Rules (optionally filtered by ?rule).',
  },
} as const;

export type SystemQueryKey = keyof typeof SYSTEM_QUERY_METADATA;

export interface SystemQueryDefinition {
  key: SystemQueryKey;
  queryId: string;
  versionId: string;
  name: string;
  description: string;
}

export class SystemQueryCatalog {
  static getDefinition(key: SystemQueryKey): SystemQueryDefinition {
    const def = SYSTEM_QUERY_METADATA[key];
    if (!def) {
      throw new Error(`Unknown system query key: ${key as string}`);
    }
    return { ...def };
  }

  static listDefinitions(): SystemQueryDefinition[] {
    return Object.values(SYSTEM_QUERY_METADATA).map(def => ({ ...def }));
  }

  static resolveQueryId(key: SystemQueryKey): string {
    return this.getDefinition(key).queryId;
  }
}
