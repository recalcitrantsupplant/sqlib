import { vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { memoryCacheManager, MemoryCacheManager } from '../../../src/lib/MemoryCacheManager.js';
import { oxigraphStoreManager } from '../../../src/lib/OxigraphStoreManager.js';
import backendRoutes from '../../../src/routes/backends.js';
import libraryRoutes from '../../../src/routes/libraries.js';
import queryRoutes from '../../../src/routes/queries.js';
import queryGroupRoutes from '../../../src/routes/query-groups.js';
import ruleRoutes from '../../../src/routes/rules.js';
import ruleSetRoutes from '../../../src/routes/rule-sets.js';
import executeRoutes from '../../../src/routes/execute.js';
import detectionRoutes from '../../../src/routes/detection.js';
import sparqlRoutes from '../../../src/routes/sparql.js';
import * as schemas from '@sparql-query-lib/contracts/schema';
import { serializerOpts, setupValidator } from '../../../src/lib/validator-setup.js';
import type { BackendRestApi, LibraryRestApi, QueryGroupRestApi } from '@sparql-query-lib/contracts/schema';

// MINIMAL mocking for scenario tests - only mock what's absolutely necessary

// Mock external network dependencies only
vi.mock('node-fetch', () => ({
  default: vi.fn(),
}));

// Mock file system operations for safety in tests
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    // Allow real file operations but in test directories only
  };
});

export interface ScenarioTestContext {
  app: FastifyInstance;
  tempDir: string;
  backendId: string;
  libraryId: string;
  cacheManager: MemoryCacheManager;
}

export class ScenarioTestBaseUnmocked {
  static async createTestContext(scenarioName: string): Promise<ScenarioTestContext> {
    // Disable cache write-through for scenario tests (cache-only mode)
    process.env.CACHE_WRITE_THROUGH = 'false';
    process.env.CACHE_PRELOAD = 'false';

    // Create temporary directory for this test scenario
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `scenario-test-${scenarioName}-`));

    // Initialize global Oxigraph store manager with test directory
    await oxigraphStoreManager.initialize(tempDir);
    console.log(`Global oxigraphStoreManager configured for test with dir: ${tempDir}`);

    // Initialize real memory cache manager
    const cacheManager = memoryCacheManager;
    await cacheManager.loadAll();

    // Create Fastify app with real configuration
    const app = Fastify({ logger: false, serializerOpts });

    // Set up real JSON schema validation
    setupValidator(app);

    // Add all schemas
    for (const schema of Object.values(schemas)) {
      if (schema && typeof schema === 'object' && '$id' in schema) {
        app.addSchema(schema as any);
      }
    }

    // Provide detailed validation errors to aid scenario debugging
    app.setErrorHandler((error, request, reply) => {
      const statusCode = error.statusCode || (error.validation ? 400 : 500);

      if (error.validation && Array.isArray(error.validation)) {
        const validationErrors = error.validation.map((err: any) => {
          const fieldPath = err.instancePath || err.dataPath || '';
          const field = err.params?.missingProperty || fieldPath.replace(/^\//, '') || 'Field';
          if (err.keyword === 'required') return `"${field}" is required`;
          if (err.keyword === 'type') return `"${field}" must be of type ${err.params?.type}`;
          if (err.keyword === 'format') return `"${field}" has invalid format (expected: ${err.params?.format})`;
          return err.message || 'Validation error';
        });

        return reply.status(statusCode).send({
          error: validationErrors[0] || 'Validation failed',
          validation: validationErrors
        });
      }

      return reply.status(statusCode).send({
        error: error.message || 'Internal Server Error'
      });
    });

    // Register all routes with real implementations
    await app.register(backendRoutes, { prefix: '/backends' });
    await app.register(libraryRoutes, { prefix: '/libraries' });
    await app.register(queryRoutes, { prefix: '/queries' });
    await app.register(queryGroupRoutes, { prefix: '/query-groups' });
    // Registered so a scenario can build a real RuleSetVersion behind a
    // RuleSetNode; without them a RuleSetNode can only ever be tested against a
    // dangling reference.
    await app.register(ruleRoutes, { prefix: '/rules' });
    await app.register(ruleSetRoutes, { prefix: '/rule-sets' });
    await app.register(executeRoutes, { prefix: '/execute' });
    await app.register(detectionRoutes);
    await app.register(sparqlRoutes, { prefix: '/sparql' });

    await app.ready();

    // Generate deterministic but unique IDs for this test run
    const backendId = `urn:scenario:backend:${scenarioName}`;
    const libraryId = `urn:scenario:library:${scenarioName}`;

    return {
      app,
      tempDir,
      backendId,
      libraryId,
      cacheManager,
    };
  }

  static async cleanupTestContext(context: ScenarioTestContext): Promise<void> {
    try {
      await context.app.close();
      console.log('Shutting down OxigraphStoreManager...');
      // The OxigraphStoreManager should handle its own cleanup
      console.log('OxigraphStoreManager shutdown complete');
    } catch (error) {
      console.error('Error during test cleanup:', error);
    }

    // Clean up temp directory
    try {
      await fs.rm(context.tempDir, { recursive: true, force: true });
    } catch (error) {
      console.warn('Could not clean up temp directory:', error);
    }
  }

  static async loadTurtleDataIntoBackend(context: ScenarioTestContext, filename: string): Promise<void> {
    const dataPath = path.join(__dirname, '..', 'data', filename);
    const turtleData = await fs.readFile(dataPath, 'utf-8');

    // Use the GLOBAL oxigraph manager singleton (same instance used by ExecutorFactory)
    const store = oxigraphStoreManager.createEphemeralStore(context.backendId);

    console.log(`📊 Store BEFORE load (${context.backendId}): ${store.size} quads`);
    await oxigraphStoreManager.loadDataFromString(store, turtleData, 'turtle');
    console.log(`📊 Store AFTER load (${context.backendId}): ${store.size} quads`);

    console.log(`Loaded ${turtleData.length} chars from ${filename} into backend ${context.backendId}`);
  }

  static async createOxigraphBackend(context: ScenarioTestContext, name: string): Promise<BackendRestApi> {
    const response = await context.app.inject({
      method: 'POST',
      url: '/backends/',
      payload: {
        id: context.backendId,
        name,
        backendType: 'oxigraphEphemeral'
      }
    });

    if (response.statusCode !== 201) {
      throw new Error(`Failed to create backend: ${response.statusCode} ${response.payload}`);
    }

    return response.json();
  }

  static async createLibrary(context: ScenarioTestContext, name: string): Promise<LibraryRestApi> {
    const response = await context.app.inject({
      method: 'POST',
      url: '/libraries/',
      payload: {
        id: context.libraryId,
        name,
        description: `Test library for scenario`
      }
    });

    if (response.statusCode !== 201) {
      throw new Error(`Failed to create library: ${response.statusCode} ${response.payload}`);
    }

    return response.json();
  }

  static async createQueryGroup(context: ScenarioTestContext, name: string): Promise<QueryGroupRestApi> {
    const response = await context.app.inject({
      method: 'POST',
      url: '/query-groups/',
      payload: {
        name,
        description: `Test query group for scenario`,
        isPartOf: context.libraryId
      }
    });

    if (response.statusCode !== 201) {
      throw new Error(`Failed to create query group: ${response.statusCode} ${response.payload}`);
    }

    return response.json();
  }

  static async readQueryFile(filename: string): Promise<string> {
    const queryPath = path.join(__dirname, '..', 'data', filename);
    return await fs.readFile(queryPath, 'utf-8');
  }


  static async executeQueryGroup(
    context: ScenarioTestContext,
    queryGroupId: string,
    initialArguments: any[] = []
  ): Promise<any> {
    const response = await context.app.inject({
      method: 'POST',
      url: '/execute/',
      payload: {
        targetId: queryGroupId,
        backendId: context.backendId,
        arguments: initialArguments
      }
    });

    if (response.statusCode !== 200) {
      throw new Error(`Failed to execute query group: ${response.statusCode} ${response.payload}`);
    }

    return response.json();
  }
}
