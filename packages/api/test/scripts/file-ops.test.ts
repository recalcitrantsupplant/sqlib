import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  loadEntitySchemas,
  writeGeneratedFiles,
  loadExample,
  buildCreateExampleLookup,
  type SchemaFile,
  type GeneratedFiles
} from '../../scripts/lib/file-ops.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('file-ops', () => {
  describe('loadEntitySchemas', () => {
    const schemasDir = path.join(__dirname, '../../src/persistence/schemas');

    it('should load schema files from directory', async () => {
      const schemas = await loadEntitySchemas(schemasDir);

      expect(schemas).toBeInstanceOf(Array);
      expect(schemas.length).toBeGreaterThan(0);

      // Check structure of first schema
      const firstSchema = schemas[0];
      expect(firstSchema).toHaveProperty('name');
      expect(firstSchema).toHaveProperty('fileName');
      expect(firstSchema).toHaveProperty('filePath');
      expect(firstSchema).toHaveProperty('schema');

      expect(firstSchema.fileName).toMatch(/Schema\.ts$/);
      expect(firstSchema.schema['@type']).toBeTruthy();
    });

    it('should extract correct schema names', async () => {
      const schemas = await loadEntitySchemas(schemasDir);

      const backendSchema = schemas.find(s => s.name === 'Backend');
      expect(backendSchema).toBeDefined();
      expect(backendSchema?.fileName).toBe('BackendSchema.ts');

      const querySchema = schemas.find(s => s.name === 'Query');
      expect(querySchema).toBeDefined();
      expect(querySchema?.fileName).toBe('QuerySchema.ts');
    });

    it('should only load files ending with Schema.ts', async () => {
      const schemas = await loadEntitySchemas(schemasDir);

      schemas.forEach(schema => {
        expect(schema.fileName).toMatch(/Schema\.ts$/);
      });
    });

    it('should return the evaluated schema object, with namespaces resolved', async () => {
      const schemas = await loadEntitySchemas(schemasDir);

      const library = schemas.find(s => s.name === 'Library');
      expect(library?.schema).toMatchObject({
        '@type': 'https://sparql-query-lib/Library',
        name: { '@id': 'https://schema.org/name' },
        defaultBackend: {
          '@id': 'https://sparql-query-lib/defaultBackend',
          '@type': 'https://ldkit.io/ontology/IRI',
          '@optional': true,
        },
      });
    });

    it('should reject a directory whose module does not export the expected schema', async () => {
      const emptyDir = path.join(__dirname, '../../test-schemas-temp');
      fs.mkdirSync(emptyDir, { recursive: true });
      fs.writeFileSync(path.join(emptyDir, 'BogusSchema.ts'), 'export const NotIt = {};\n');

      try {
        await expect(loadEntitySchemas(emptyDir)).rejects.toThrow(
          /BogusSchema\.ts does not export a schema object named BogusSchema/
        );
      } finally {
        fs.rmSync(emptyDir, { recursive: true, force: true });
      }
    });
  });

  describe('writeGeneratedFiles', () => {
    const testOutputDir = path.join(__dirname, '../../test-output-temp');

    beforeEach(() => {
      // Clean up test directory
      if (fs.existsSync(testOutputDir)) {
        fs.rmSync(testOutputDir, { recursive: true });
      }
    });

    afterEach(() => {
      // Clean up after test
      if (fs.existsSync(testOutputDir)) {
        fs.rmSync(testOutputDir, { recursive: true });
      }
    });

    it('should create output directory if it does not exist', () => {
      const files: GeneratedFiles = {
        entities: '// entities content',
        routes: '// routes content',
        index: '// index content'
      };

      writeGeneratedFiles(testOutputDir, files);

      expect(fs.existsSync(testOutputDir)).toBe(true);
    });

    it('should write all three files', () => {
      const files: GeneratedFiles = {
        entities: '// entities content',
        routes: '// routes content',
        index: '// index content'
      };

      writeGeneratedFiles(testOutputDir, files);

      expect(fs.existsSync(path.join(testOutputDir, 'entities.generated.ts'))).toBe(true);
      expect(fs.existsSync(path.join(testOutputDir, 'routes.generated.ts'))).toBe(true);
      expect(fs.existsSync(path.join(testOutputDir, 'index.generated.ts'))).toBe(true);
    });

    it('should write correct content to files', () => {
      const files: GeneratedFiles = {
        entities: '// entities test content',
        routes: '// routes test content',
        index: '// index test content'
      };

      writeGeneratedFiles(testOutputDir, files);

      const entitiesContent = fs.readFileSync(
        path.join(testOutputDir, 'entities.generated.ts'),
        'utf-8'
      );
      const routesContent = fs.readFileSync(
        path.join(testOutputDir, 'routes.generated.ts'),
        'utf-8'
      );
      const indexContent = fs.readFileSync(
        path.join(testOutputDir, 'index.generated.ts'),
        'utf-8'
      );

      expect(entitiesContent).toBe('// entities test content');
      expect(routesContent).toBe('// routes test content');
      expect(indexContent).toBe('// index test content');
    });

    it('should overwrite existing files', () => {
      const files1: GeneratedFiles = {
        entities: '// original content',
        routes: '// original content',
        index: '// original content'
      };

      const files2: GeneratedFiles = {
        entities: '// updated content',
        routes: '// updated content',
        index: '// updated content'
      };

      writeGeneratedFiles(testOutputDir, files1);
      writeGeneratedFiles(testOutputDir, files2);

      const entitiesContent = fs.readFileSync(
        path.join(testOutputDir, 'entities.generated.ts'),
        'utf-8'
      );

      expect(entitiesContent).toBe('// updated content');
    });
  });

  describe('loadExample', () => {
    const examplesDir = path.join(__dirname, '../../examples');

    it('should load existing example file', () => {
      // Try to load an actual example if it exists
      const result = loadExample(examplesDir, 'workflows/basic-workflow/01-create-backend.json');

      if (result) {
        expect(result).toBeTypeOf('object');
        expect(result).toHaveProperty('name');
      }
    });

    it('should return undefined for non-existent file', () => {
      const result = loadExample(examplesDir, 'non-existent-file.json');
      expect(result).toBeUndefined();
    });

    it('should return undefined for invalid JSON', () => {
      // Create temp invalid JSON file
      const tempDir = path.join(__dirname, '../../test-examples-temp');
      const invalidFile = path.join(tempDir, 'invalid.json');

      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(invalidFile, 'not valid json {]');

      const result = loadExample(tempDir, 'invalid.json');
      expect(result).toBeUndefined();

      // Cleanup
      fs.rmSync(tempDir, { recursive: true });
    });
  });

  describe('buildCreateExampleLookup', () => {
    const examplesDir = path.join(__dirname, '../../examples');

    it('should build lookup map from workflow directory', () => {
      const lookup = buildCreateExampleLookup(examplesDir);

      expect(lookup).toBeTypeOf('object');

      // If examples exist, verify structure
      if (Object.keys(lookup).length > 0) {
        const entries = Object.entries(lookup);

        entries.forEach(([key, value]) => {
          // Keys should be kebab-case entity names
          expect(key).toMatch(/^[a-z-]+$/);
          // Values should be relative paths
          expect(value).toContain('workflows/basic-workflow');
          expect(value).toMatch(/\.json$/);
        });
      }
    });

    it('should return empty object for non-existent directory', () => {
      const lookup = buildCreateExampleLookup('/non-existent-directory');
      expect(lookup).toEqual({});
    });

    it('should extract entity names from numbered files', () => {
      // Create temp directory with example files
      const tempDir = path.join(__dirname, '../../test-examples-temp');
      const workflowDir = path.join(tempDir, 'workflows', 'basic-workflow');

      fs.mkdirSync(workflowDir, { recursive: true });
      fs.writeFileSync(path.join(workflowDir, '01-create-backend.json'), '{}');
      fs.writeFileSync(path.join(workflowDir, '02-create-library.json'), '{}');
      fs.writeFileSync(path.join(workflowDir, '03-create-query-group.json'), '{}');
      fs.writeFileSync(path.join(workflowDir, 'not-a-create.json'), '{}');

      const lookup = buildCreateExampleLookup(tempDir);

      expect(lookup).toHaveProperty('backend');
      expect(lookup).toHaveProperty('library');
      expect(lookup).toHaveProperty('query-group');
      expect(lookup).not.toHaveProperty('not-a-create');

      expect(lookup['backend']).toContain('01-create-backend.json');
      expect(lookup['library']).toContain('02-create-library.json');
      expect(lookup['query-group']).toContain('03-create-query-group.json');

      // Cleanup
      fs.rmSync(tempDir, { recursive: true });
    });
  });
});