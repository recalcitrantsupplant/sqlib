import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { generateSchemas, DEFAULT_OUTPUT_DIRS } from '../../scripts/generate-schemas.js';

/**
 * The committed generator output is exactly what the generator writes.
 *
 * Generates into a temp directory and compares, so a test run never touches the
 * committed files (it used to regenerate them in place and assert only that
 * they were non-empty). `scripts/ci/generated-check.sh` asks the same question
 * of a whole `generate-schemas` run with `git diff`; this is the version that
 * runs with the unit tests and names the file that drifted.
 */
describe('route generation snapshot tests', () => {
  let tmpRoot: string;
  let schemaDir: string;
  let contractsDir: string;
  let written: string[];

  beforeAll(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'generate-schemas-'));
    schemaDir = path.join(tmpRoot, 'schema');
    contractsDir = path.join(tmpRoot, 'generated');
    written = await generateSchemas({ schemaDir, contractsDir });
  });

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  const committedPathFor = (file: string) =>
    file.startsWith(schemaDir + path.sep)
      ? path.join(DEFAULT_OUTPUT_DIRS.schemaDir, path.relative(schemaDir, file))
      : path.join(DEFAULT_OUTPUT_DIRS.contractsDir, path.relative(contractsDir, file));

  it('writes only into the directories it was given', () => {
    expect(written.length).toBeGreaterThan(0);
    for (const file of written) {
      expect(file.startsWith(schemaDir + path.sep) || file.startsWith(contractsDir + path.sep), file).toBe(true);
      expect(fs.existsSync(file), file).toBe(true);
    }
  });

  it('matches every committed generated file byte for byte', () => {
    const drifted = written.filter(
      file => fs.readFileSync(file, 'utf-8') !== fs.readFileSync(committedPathFor(file), 'utf-8')
    );
    // Regenerate with `pnpm generate-schemas` and commit the result.
    expect(drifted.map(committedPathFor)).toEqual([]);
  });

  it('owns every file in contracts/src/generated — hand-written modules live in src/hand-written', () => {
    // A file here the generator does not write is either stale output or a
    // hand-written module in the wrong place; both read as generated and are not.
    const generated = fs.readdirSync(contractsDir).sort();
    const committed = fs.readdirSync(DEFAULT_OUTPUT_DIRS.contractsDir).sort();
    expect(committed).toEqual(generated);
  });

  it('owns every *.generated.ts file in contracts/src/schema', () => {
    const generated = fs.readdirSync(schemaDir).sort();
    const committed = fs
      .readdirSync(DEFAULT_OUTPUT_DIRS.schemaDir)
      .filter(name => name.endsWith('.generated.ts'))
      .sort();
    expect(committed).toEqual(generated);
    // The rest of that directory is the two hand-written entry-point barrels.
    const handWritten = fs
      .readdirSync(DEFAULT_OUTPUT_DIRS.schemaDir)
      .filter(name => !name.endsWith('.generated.ts'))
      .sort();
    expect(handWritten).toEqual(['index.ts', 'routes.ts']);
  });

  it('includes all expected route schema exports', () => {
    const routes = fs.readFileSync(path.join(schemaDir, 'routes.generated.ts'), 'utf-8');
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
      expect(routes).toContain(`export const ${exportName}`);
    }
  });

  it('includes all expected entity schema and interface exports', () => {
    const entities = fs.readFileSync(path.join(schemaDir, 'entities.generated.ts'), 'utf-8');
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
      expect(entities).toContain(`export const ${schemaName}`);
    }
    const expectedInterfaces = [
      'BackendRestApi',
      'LibraryRestApi',
      'QueryRestApi',
      'QueryGroupRestApi',
      'QueryVersionRestApi',
      'QueryGroupVersionRestApi'
    ];
    for (const interfaceName of expectedInterfaces) {
      expect(entities).toContain(`export interface ${interfaceName}`);
    }
  });
});
