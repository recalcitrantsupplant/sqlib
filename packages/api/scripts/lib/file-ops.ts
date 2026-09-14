/**
 * File I/O operations for schema generation
 *
 * Isolates file system operations from business logic to make the generator
 * testable and easier to maintain.
 */

import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import type { Schema } from '../../src/persistence/schema.js';

export interface SchemaFile {
  name: string;
  fileName: string;
  filePath: string;
  schema: Schema;
}

/**
 * Load every entity schema from the schemas directory.
 *
 * The schema modules are imported and their exported `<Name>Schema` const read
 * directly. The generator used to regex the object literal out of the file text
 * and `new Function`-eval it, which meant only that one literal was visible —
 * anything else a schema module declared was unreachable — and a parse failure
 * silently substituted a generic four-property fallback schema. Importing gets
 * the same objects (same namespace modules, same key order) with the module as
 * a whole in scope.
 *
 * @param schemasDir - Path to the entity schemas directory
 * @returns Array of schema files with their parsed schema object
 */
export async function loadEntitySchemas(schemasDir: string): Promise<SchemaFile[]> {
  const fileNames = fs.readdirSync(schemasDir).filter(file => file.endsWith('Schema.ts'));

  return Promise.all(fileNames.map(async fileName => {
    const filePath = path.join(schemasDir, fileName);
    const name = fileName.replace('Schema.ts', '');
    const exportName = `${name}Schema`;

    const module = await import(pathToFileURL(filePath).href) as Record<string, unknown>;
    const schema = module[exportName];
    if (!schema || typeof schema !== 'object') {
      throw new Error(`${fileName} does not export a schema object named ${exportName}`);
    }
    if (!('@type' in schema)) {
      throw new Error(`${exportName} is missing the required @type property`);
    }

    return { name, fileName, filePath, schema: schema as Schema };
  }));
}

export interface GeneratedFiles {
  entities: string;
  routes: string;
  index: string;
}

/**
 * Write generated schema files to the output directory
 *
 * @param outputDir - Path to the output directory
 * @param files - Generated file contents
 */
export function writeGeneratedFiles(outputDir: string, files: GeneratedFiles): void {
  const entitiesFile = path.join(outputDir, 'entities.generated.ts');
  const routesFile = path.join(outputDir, 'routes.generated.ts');
  const indexFile = path.join(outputDir, 'index.generated.ts');

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(entitiesFile, files.entities);
  fs.writeFileSync(routesFile, files.routes);
  fs.writeFileSync(indexFile, files.index);
}

/**
 * Load example JSON file if it exists
 *
 * @param examplesDir - Base examples directory
 * @param examplePath - Relative path to example file
 * @returns Parsed JSON object or undefined if file doesn't exist
 */
export function loadExample(examplesDir: string, examplePath: string): any | undefined {
  try {
    const fullPath = path.join(examplesDir, examplePath);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf8');
      return JSON.parse(content);
    }
  } catch (error) {
    console.warn(`Failed to load example from ${examplePath}:`, error);
  }
  return undefined;
}

/**
 * Build lookup map of create examples from basic workflow directory
 *
 * @param examplesDir - Base examples directory
 * @returns Map of schema names to example file paths
 */
export function buildCreateExampleLookup(examplesDir: string): Record<string, string> {
  const workflowDir = path.join(examplesDir, 'workflows', 'basic-workflow');

  try {
    if (!fs.existsSync(workflowDir)) {
      return {};
    }

    return fs.readdirSync(workflowDir).reduce((acc, file) => {
      const match = file.match(/^\d+-create-(.+)\.json$/);
      if (match) {
        acc[match[1]] = path.posix.join('workflows', 'basic-workflow', file);
      }
      return acc;
    }, {} as Record<string, string>);
  } catch (error) {
    console.warn('Failed to build create example lookup:', error);
    return {};
  }
}