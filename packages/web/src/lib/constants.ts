/**
 * Shared constants used across the web application
 */

/**
 * System library ID - contains meta-queries for querying the RDF persistence layer
 */
export const SYSTEM_LIBRARY_ID = 'https://sparql-query-lib/system/library';

/**
 * System query for exporting Queries (backend executes against internal store)
 */
export const SYSTEM_GET_QUERIES_ID = 'https://sparql-query-lib/system/queries/get-queries';

/**
 * System query for exporting Rules (backend executes against internal store)
 */
export const SYSTEM_GET_RULES_ID = 'https://sparql-query-lib/system/queries/get-rules';
