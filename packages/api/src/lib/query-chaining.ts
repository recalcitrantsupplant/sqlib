// Based on argumentValueSchema
export interface SparqlValue { // Already exported
  type: 'uri' | 'literal'; // Assuming bnode is not used here based on schema enum
  value: string;
  datatype?: string; // Optional based on schema
  'xml:lang'?: string; // Optional based on schema
}

// Based on argumentRowSchema (Record<string, SparqlValue>)
export type SparqlBinding = Record<string, SparqlValue>; // Export SparqlBinding

// Based on argumentSetSchema
export interface ArgumentSet { // Already exported
  head: {
    vars: string[];
  };
  arguments: {
    bindings: SparqlBinding[];
  };
  /** Explicit policy for an absent input at execution time. */
  whenEmpty?: 'unconstrained' | 'propagateEmpty' | 'require';
}

// Define SparqlResultsJson locally, using the manually defined SparqlBinding
export interface SparqlResultsJson {
  head: {
    vars: string[];
    link?: string[]; // Optional link headers
  };
  results: {
    bindings: SparqlBinding[]; // Use the derived SparqlBinding type
  };
  boolean?: boolean; // For ASK queries
}
