import type { SparqlResults } from '@sparql-query-lib/types';

/**
 * The query screen's inspector tabs, by id.
 *
 * One definition rather than three: the panel declares the strip, the work
 * area holds which one is open, and `useQueryExecution` switches to Results
 * when a run comes back. Each had its own copy of the union, so adding a tab
 * meant finding all three — and missing one is a type error in the file that
 * did not change.
 */
export type QueryInspectorTab = 'details' | 'arguments' | 'results' | 'code' | 'tests';

export type QueryExecutionResultPayload = {
  structured: SparqlResults | null;
  rawContent: string | null;
  contentType: string | null;
  timing?: {
    header?: string | null;
    breakdown?: {
      backendMs?: number;
      appMs?: number;
      serverTotalMs?: number;
      clientTotalMs?: number;
      networkMs?: number;
    };
  };
  executedAt?: string | null;
};
