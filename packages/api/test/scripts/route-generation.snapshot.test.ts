import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateSchemas } from '../../scripts/generate-schemas.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('route generation snapshot tests', () => {
  const routesFile = path.join(__dirname, '../../../contracts/src/schema/routes.generated.ts');
  const entitiesFile = path.join(__dirname, '../../../contracts/src/schema/entities.generated.ts');
  const indexFile = path.join(__dirname, '../../../contracts/src/schema/index.generated.ts');

  let originalRoutes: string;
  let originalEntities: string;
  let originalIndex: string;

  beforeAll(() => {
    // Capture original content
    originalRoutes = fs.readFileSync(routesFile, 'utf-8');
    originalEntities = fs.readFileSync(entitiesFile, 'utf-8');
    originalIndex = fs.readFileSync(indexFile, 'utf-8');
  });

  it('should generate routes file', async () => {
    await generateSchemas();

    const newRoutes = fs.readFileSync(routesFile, 'utf-8');
    expect(newRoutes).toBeTruthy();
    expect(newRoutes.length).toBeGreaterThan(0);
  });

  it('should generate entities file', async () => {
    await generateSchemas();

    const newEntities = fs.readFileSync(entitiesFile, 'utf-8');
    expect(newEntities).toBeTruthy();
    expect(newEntities.length).toBeGreaterThan(0);
  });

  it('should generate index file', async () => {
    await generateSchemas();

    const newIndex = fs.readFileSync(indexFile, 'utf-8');
    expect(newIndex).toBeTruthy();
    expect(newIndex.length).toBeGreaterThan(0);
  });

  it('should have consistent structure in routes file (ignore timestamp)', async () => {
    await generateSchemas();

    const newRoutes = fs.readFileSync(routesFile, 'utf-8');

    // Remove timestamp lines for comparison
    const stripTimestamp = (content: string) =>
      content.replace(/Generated on: .+\n/, 'Generated on: TIMESTAMP\n');

    const normalizedOriginal = stripTimestamp(originalRoutes);
    const normalizedNew = stripTimestamp(newRoutes);

    // They should be identical when timestamps are normalized
    expect(normalizedNew).toBe(normalizedOriginal);
  });

  it('should have consistent structure in entities file (ignore timestamp)', async () => {
    await generateSchemas();

    const newEntities = fs.readFileSync(entitiesFile, 'utf-8');

    // Remove timestamp lines for comparison
    const stripTimestamp = (content: string) =>
      content.replace(/Generated on: .+\n/, 'Generated on: TIMESTAMP\n');

    const normalizedOriginal = stripTimestamp(originalEntities);
    const normalizedNew = stripTimestamp(newEntities);

    // They should be identical when timestamps are normalized
    expect(normalizedNew).toBe(normalizedOriginal);
  });

  it('should include all expected route schema exports', async () => {
    await generateSchemas();

    const newRoutes = fs.readFileSync(routesFile, 'utf-8');

    // Check for key route schema exports
    const expectedExports = [
      'getBackendsSchema',
      'createBackendSchema',
      'getQuerysSchema',  // Note: pluralization is Schema+'s', not 'Queries'
      'createQuerySchema',
      'getQueryGroupsSchema',
      'createQueryGroupSchema',
      'listQueryVersionsForQuerySchema',
      'createQueryVersionForQuerySchema',
      'getQueryVersionForQuerySchema',
      'patchQueryVersionForQuerySchema',
      'listQueryGroupVersionsForGroupSchema',
      'createQueryGroupVersionForGroupFlatSchema',
      'getQueryGroupVersionForGroupSchema',
      'detectInputsQueryVersionSchema',
      'detectOutputsQueryVersionSchema'
    ];

    for (const exportName of expectedExports) {
      expect(newRoutes).toContain(`export const ${exportName}`);
    }
  });

  it('should include all expected entity schema exports', async () => {
    await generateSchemas();

    const newEntities = fs.readFileSync(entitiesFile, 'utf-8');

    // Check for key entity schema exports
    const expectedSchemas = [
      'backendSchema',
      'librarySchema',
      'querySchema',
      'querygroupSchema',
      'queryversionSchema',
      'querygroupversionSchema',
      'queryinputvariableSchema',
      'queryoutputvariableSchema',
      'tuplememberSchema',
      'queryinputtupleSchema',
      'queryoutputtupleSchema'
    ];

    for (const schemaName of expectedSchemas) {
      expect(newEntities).toContain(`export const ${schemaName}`);
    }
  });

  it('should include all expected interface exports', async () => {
    await generateSchemas();

    const newEntities = fs.readFileSync(entitiesFile, 'utf-8');

    // Check for key interface exports
    const expectedInterfaces = [
      'BackendRestApi',
      'LibraryRestApi',
      'QueryRestApi',
      'QueryGroupRestApi',
      'QueryVersionRestApi',
      'QueryGroupVersionRestApi'
    ];

    for (const interfaceName of expectedInterfaces) {
      expect(newEntities).toContain(`export interface ${interfaceName}`);
    }
  });
});