/**
 * Type definitions for contract module generation
 *
 * These types define the structure needed to generate entity contract modules
 * (Backend, Library, Query, QueryGroup, etc.) using ts-morph.
 */

/**
 * Defines a Zod schema field with its validation rules and refinements
 */
export interface ZodFieldDefinition {
  /** Field name in the schema */
  name: string;
  /** Zod type expression (e.g., 'z.string()', 'iriString', 'backendTypeEnum') */
  zodType: string;
  /** Whether this field is required in the base schema */
  required: boolean;
  /** Optional additional validation methods (e.g., '.min(1, "error")', '.regex(...)') */
  validators?: string[];
}

/**
 * Defines a custom Zod type that can be reused across schemas
 */
export interface ZodReusableType {
  /** Variable name for this type */
  name: string;
  /** Zod type definition */
  definition: string;
  /** Optional comment describing the type */
  comment?: string;
  /**
   * Export it. Only the version shapes module needs this: the two hand-written
   * version contracts build their draft schemas out of individual shape fields
   * (`limitParameterShape.name`), so the shape itself has to cross the module
   * boundary, not just the schema built from it.
   */
  exported?: boolean;
}

/**
 * Defines a refinement function for a schema
 */
export interface ZodRefinement {
  /** Type of refinement: 'superRefine' for complex validation, 'refine' for simple checks */
  type: 'superRefine' | 'refine';
  /** The refinement function code */
  code: string;
}

/**
 * Defines a Zod schema object
 */
export interface ZodSchemaDefinition {
  /** Schema name (e.g., 'backendSchema', 'backendCreateSchema') */
  name: string;
  /** Fields in this schema */
  fields: ZodFieldDefinition[];
  /** Whether to add .strict() to the schema */
  strict?: boolean;
  /** Refinements to apply to the schema */
  refinements?: ZodRefinement[];
  /** Comment describing this schema */
  comment?: string;
}

/**
 * Complete definition for generating a contract module
 */
export interface ContractDefinition {
  /** Entity name (e.g., 'Backend', 'Library', 'Query') */
  entityName: string;

  /** Import statements needed for this contract */
  imports: {
    /** Imports from external packages */
    external: Array<{ from: string; imports: string[] }>;
    /** Type imports */
    types?: Array<{ from: string; imports: string[] }>;
  };

  /** Constants to define at module level */
  constants?: Array<{
    name: string;
    value: string;
    comment?: string;
  }>;

  /** Reusable Zod types to define */
  reusableTypes: ZodReusableType[];

  /** Zod schemas to generate */
  schemas: ZodSchemaDefinition[];

  /** TypeScript types to export from schemas */
  typeExports: Array<{
    /** Type name */
    name: string;
    /** Zod schema to infer from */
    zodSchemaName: string;
    /** Comment describing this type */
    comment?: string;
  }>;

  /** Custom code blocks to insert (for special cases like helper functions) */
  customBlocks?: Array<{
    /** Position: 'before-schemas', 'after-schemas', 'before-routes', 'after-routes' */
    position: 'before-schemas' | 'after-schemas' | 'before-routes' | 'after-routes';
    /** Code to insert */
    code: string;
  }>;
}
