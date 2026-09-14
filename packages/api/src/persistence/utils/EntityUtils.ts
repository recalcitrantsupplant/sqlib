/**
 * Generic entity CRUD factory.
 *
 * Backend-neutral: it composes the repository from `createRepositoryLens`, which
 * now sits on the self-hosted persistence adapter rather than an LDKit lens.
 */

import type { Property, Schema } from '../schema.js';
import { createRepositoryLens } from './entityRepository.js';
import { toLdkit } from './id-adapter.js';
import { cleanNullValues } from './type-conversions.js';

/**
 * The fields an entity schema says are mandatory.
 *
 * `@optional` on a property is already the schema's statement about whether a
 * value has to be there, so the create-time check reads it rather than being
 * told again by each caller. Pass `requiredFields` explicitly only where the
 * API deliberately requires something the RDF shape leaves optional.
 */
function requiredFieldsFrom(schema: Schema): string[] {
  return Object.entries(schema)
    .filter(([key, value]) =>
      key !== '@type' &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !(value as Property)['@optional'])
    .map(([key]) => key);
}

/**
 * Base interface that all LDKit entities must have
 */
interface BaseLdkitEntity {
  $id: string;
  '@type'?: string;
  dateCreated?: string | null; // ISO string format for RDF/JSON-LD compatibility
  dateModified?: string | null; // ISO string format for RDF/JSON-LD compatibility
}

/**
 * Generic entity utilities factory
 * Generates standardized CRUD operations for any LDKit entity
 */
export function createEntityUtils<T extends BaseLdkitEntity>(
  schema: Schema,
  entityName: string,
  requiredFields: (keyof T)[] = requiredFieldsFrom(schema) as (keyof T)[],
  customPrepareForLdkit?: (entity: any) => any
) {
  const Repository = createRepositoryLens(schema);

  /**
   * Convert entity to LDKit format (null to undefined)
   * Can be overridden via customPrepareForLdkit parameter
   */
  const prepareForLdkit = customPrepareForLdkit || ((entity: any): any => {
    const prepared: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(entity)) {
      if (value === null || value === undefined) {
        continue;
      }
      prepared[key] = value;
    }
    return prepared;
  });

  const self = {
    Repository,
    prepareForLdkit,

    /**
     * Find all entities
     */
    findAll: async (): Promise<T[]> => {
      const entities = await Repository.find();
      return entities.map(entity => cleanNullValues(entity) as unknown as T);
    },

    /**
     * Find entity by ID
     */
    findById: async (id: string): Promise<T | null> => {
      const entity = await Repository.findByIri(id);
      return entity ? cleanNullValues(entity) as unknown as T : null;
    },

    /**
     * Find entities by field value
     */
    findBy: async (field: keyof T, value: any): Promise<T[]> => {
      const allEntities = await Repository.find();
      const filtered = allEntities.filter(entity => (entity as unknown as Partial<T>)[field] === value);
      return filtered.map(entity => cleanNullValues(entity) as unknown as T);
    },

    /**
     * Create entity with automatic timestamps and validation
     */
    create: async (data: Omit<T, '$id' | 'dateCreated' | 'dateModified'> & { '@id'?: string; $id?: string }): Promise<void> => {
      // Validate required fields
      const missingFields = requiredFields.filter(field => !(data as Partial<T>)[field]);
      if (missingFields.length > 0) {
        const fields = requiredFields.map(f => String(f));
        let requiredFieldsString;
        if (fields.length === 1) {
            requiredFieldsString = fields[0];
        } else if (fields.length === 2) {
            requiredFieldsString = fields.join(' and ');
        } else {
            requiredFieldsString = fields.slice(0, -1).join(', ') + ', and ' + fields.slice(-1);
        }
        throw new Error(`${entityName} requires ${requiredFieldsString}`);
      }

      const now = new Date().toISOString();
      const entity = toLdkit<T>({ ...data });
      entity.dateCreated = now;
      entity.dateModified = now;

      // Convert null to undefined for LDKit compatibility
      const insertData = prepareForLdkit(entity);

      await Repository.insert(insertData);
    },

    /**
     * Update entity with automatic dateModified timestamp
     *
     * NOTE: This function is mostly unused. Routes use MemoryCacheManager.update()
     * which calls the LDKit Repository.update() directly.
     *
     * IMPORTANT: LDKit's update() expects PARTIAL objects (only $id + changed fields).
     * Passing complete entities with all fields will cause LDKit to generate no UPDATE.
     */
    update: async (id: string, updates: Partial<Omit<T, '$id'>>): Promise<void> => {
      // Verify entity exists in backend
      const existing = await Repository.findByIri(id);
      if (!existing) {
        return;
      }

      // Prepare partial update for LDKit ($id + changed fields only)
      const partialUpdate: any = {
        $id: id,
        dateModified: new Date().toISOString(),
        ...updates,
      };

      // Convert null to undefined for LDKit compatibility
      const updateData = prepareForLdkit(partialUpdate);

      await Repository.update(updateData);
    },

    /**
     * Delete entity
     */
    delete: async (id: string): Promise<boolean> => {
      try {
        await Repository.delete(id);
        return true;
      } catch (error) {
        return false;
      }
    }
  };
  return self;
}

/**
 * Entity utilities with field-specific type conversion
 * For entities that need custom null/undefined handling per field
 *
 * `config.requiredFields` overrides what the schema says is mandatory; omit it
 * unless the API's create-time contract genuinely differs from the RDF shape.
 */
export function createEntityUtilsWithFields<T extends BaseLdkitEntity>(
  schema: Schema,
  entityName: string,
  config: {
    requiredFields?: (keyof T)[];
  } = {}
) {
  /**
   * Field-specific type conversion for entities with mixed field types
   */
  const prepareForLdkit = (entity: any): any => {
    const prepared: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(entity)) {
      if (value === null) {
        prepared[key] = undefined;
      } else {
        prepared[key] = value;
      }
    }
    return prepared;
  };

  // Create base utilities with custom prepareForLdkit injected
  return createEntityUtils<T>(schema, entityName, config.requiredFields, prepareForLdkit);
}
