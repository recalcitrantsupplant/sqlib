import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const createStubApp = () => ({
  register: vi.fn().mockResolvedValue(undefined),
  ready: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  setValidatorCompiler: vi.fn(),
  addSchema: vi.fn(),
  setErrorHandler: vi.fn(),
  // The auth plugin decorates the request and installs an onRequest hook.
  decorateRequest: vi.fn(),
  addHook: vi.fn(),
  get: vi.fn(),
  listen: vi.fn().mockResolvedValue(undefined),
  log: {
    error: vi.fn(),
    info: vi.fn(),
    // Startup logs a warning for every disabled feature. Before ETL defaulted
    // off (#132) no branch here reached `warn`, so the stub never needed it.
    warn: vi.fn(),
  },
});

const hoisted = vi.hoisted(() => ({
  app: null as ReturnType<typeof createStubApp> | null,
  fastifyFactory: vi.fn(),
  corsPlugin: vi.fn(),
  multipartPlugin: vi.fn(),
  swaggerPlugin: vi.fn(),
  swaggerUiPlugin: vi.fn(),
  setupValidator: vi.fn(),
  memoryCacheManager: {
    loadAll: vi.fn().mockResolvedValue(undefined),
    getStats: vi.fn().mockReturnValue({}),
    isReady: vi.fn().mockReturnValue(true),
  },
  cacheMonitoringService: {
    start: vi.fn(),
    stop: vi.fn(),
  },
  oxigraphStoreManager: {
    getPersistentStore: vi.fn(() => null),
    createPersistentStore: vi.fn(async () => ({ store: true })),
    initialize: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
    getAllStoreStats: vi.fn(() => new Map()),
  },
  backendRoutes: vi.fn(),
  queryRoutes: vi.fn(),
  detectionRoutes: vi.fn(),
  queryGroupRoutes: vi.fn(),
  libraryRoutes: vi.fn(),
  executeRoutes: vi.fn(),
  sparqlRoutes: vi.fn(),
}));

describe('index bootstrap', () => {
  const originalProcessOn = process.on;
  let consoleLog: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    process.env.INTERNAL_BACKEND_TYPE = 'http';
    delete process.env.APP_BASE_PATH;
    delete process.env.APP_PUBLIC_BASE_PATH;
    vi.doMock('fastify', () => ({ __esModule: true, default: (...args: any[]) => hoisted.fastifyFactory(...args) }));
    vi.doMock('@fastify/cors', () => ({ __esModule: true, default: hoisted.corsPlugin }));
    vi.doMock('@fastify/multipart', () => ({ __esModule: true, default: hoisted.multipartPlugin }));
    vi.doMock('@fastify/swagger', () => ({ __esModule: true, default: hoisted.swaggerPlugin }));
    vi.doMock('@fastify/swagger-ui', () => ({ __esModule: true, default: hoisted.swaggerUiPlugin }));
    vi.doMock('../src/lib/validator-setup.ts', async () => ({
      __esModule: true,
      ...(await vi.importActual('../src/lib/validator-setup.ts')),
      setupValidator: hoisted.setupValidator,
    }));
    vi.doMock('../src/lib/MemoryCacheManager.js', () => ({ __esModule: true, memoryCacheManager: hoisted.memoryCacheManager }));
    vi.doMock('../src/lib/CacheMonitoringService.js', () => ({ __esModule: true, cacheMonitoringService: hoisted.cacheMonitoringService }));
    vi.doMock('../src/lib/OxigraphStoreManager.js', () => ({ __esModule: true, oxigraphStoreManager: hoisted.oxigraphStoreManager }));
    vi.doMock('../src/routes/backends.js', () => ({ __esModule: true, default: hoisted.backendRoutes }));
    vi.doMock('../src/routes/queries.js', () => ({ __esModule: true, default: hoisted.queryRoutes }));
    vi.doMock('../src/routes/detection.js', () => ({ __esModule: true, default: hoisted.detectionRoutes }));
    vi.doMock('../src/routes/query-groups.js', () => ({ __esModule: true, default: hoisted.queryGroupRoutes }));
    vi.doMock('../src/routes/libraries.js', () => ({ __esModule: true, default: hoisted.libraryRoutes }));
    vi.doMock('../src/routes/execute.js', () => ({ __esModule: true, default: hoisted.executeRoutes }));
    vi.doMock('../src/routes/sparql.js', () => ({ __esModule: true, default: hoisted.sparqlRoutes }));
    // Spreads the real module rather than replacing it: since the hub barrel
    // merged entities.generated and routes.generated behind one specifier, a
    // wholesale mock also starves route modules that import entity schemas from
    // it. The two fakes are what the assertions below actually care about — one
    // with an $id, one without — and they survive the spread.
    vi.doMock('@sparql-query-lib/contracts/schema', async (importOriginal) => ({
      ...(await importOriginal<Record<string, unknown>>()),
      __esModule: true,
      SchemaOne: { $id: 'SchemaOne' },
      NotSchema: { title: 'Not a schema' },
    }));
    vi.doMock('../src/otel-setup.js', () => ({ __esModule: true }));
    hoisted.app = createStubApp();
    hoisted.fastifyFactory.mockImplementation(() => hoisted.app);
    hoisted.setupValidator.mockClear();
    hoisted.memoryCacheManager.loadAll.mockClear();
    hoisted.memoryCacheManager.getStats.mockReset();
    hoisted.memoryCacheManager.getStats.mockReturnValue({
      totalEntities: 3,
      isLoaded: true,
      estimatedMemoryBytes: 1024,
      entityTypes: {
        Library: { count: 2, memoryBytes: 768 },
        Query: { count: 1, memoryBytes: 256 },
      },
    });
    hoisted.memoryCacheManager.isReady.mockReset();
    hoisted.memoryCacheManager.isReady.mockReturnValue(true);
    hoisted.cacheMonitoringService.start.mockClear();
    hoisted.oxigraphStoreManager.initialize.mockClear();
    hoisted.oxigraphStoreManager.getAllStoreStats.mockReset();
    hoisted.oxigraphStoreManager.getAllStoreStats.mockReturnValue(
      new Map([
        ['library-store', { tripleCount: 12, memoryUsage: 2048 }],
      ])
    );
    hoisted.app.addSchema.mockClear();
    hoisted.app.register.mockClear();
    hoisted.app.listen.mockClear();
    hoisted.executeRoutes.mockClear();
    hoisted.sparqlRoutes.mockClear();
    process.on = vi.fn();
    consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    delete process.env.INTERNAL_BACKEND_TYPE;
    delete process.env.APP_BASE_PATH;
    delete process.env.APP_PUBLIC_BASE_PATH;
    process.on = originalProcessOn;
    consoleLog.mockRestore();
    vi.doUnmock('fastify');
    vi.doUnmock('@fastify/cors');
    vi.doUnmock('@fastify/multipart');
    vi.doUnmock('@fastify/swagger');
    vi.doUnmock('@fastify/swagger-ui');
    vi.doUnmock('../src/lib/validator-setup.ts');
    vi.doUnmock('../src/lib/MemoryCacheManager.js');
    vi.doUnmock('../src/lib/CacheMonitoringService.js');
    vi.doUnmock('../src/lib/OxigraphStoreManager.js');
    vi.doUnmock('../src/routes/backends.js');
    vi.doUnmock('../src/routes/queries.js');
    vi.doUnmock('../src/routes/detection.js');
    vi.doUnmock('../src/routes/query-groups.js');
    vi.doUnmock('../src/routes/libraries.js');
    vi.doUnmock('../src/routes/execute.js');
    vi.doUnmock('../src/routes/sparql.js');
    vi.doUnmock('@sparql-query-lib/contracts/schema');
    vi.doUnmock('../src/otel-setup.js');
  });

  it('initializes plugins, schemas, cache, and routes during startup', async () => {
    const indexModuleUrl = new URL('../src/index.ts', import.meta.url);
    const indexModule = await import(indexModuleUrl.href) as any;

    // Explicitly call start() with the mocked app
    await indexModule.start(hoisted.app);
    await new Promise(resolve => setImmediate(resolve));

    const validatorModule = await import('../src/lib/validator-setup.js');
    expect(validatorModule.setupValidator).toBe(hoisted.setupValidator);

    expect(hoisted.app).not.toBeNull();
    expect(hoisted.setupValidator).toHaveBeenCalledWith(hoisted.app);
    // The response serialiser builds its own ajv, so the `iri` format has to be
    // handed to `Fastify()` itself — nothing later can register it (issue #311).
    expect(hoisted.fastifyFactory).toHaveBeenCalledWith(
      expect.objectContaining({ serializerOpts: validatorModule.serializerOpts }),
    );
    expect(hoisted.app!.addSchema).toHaveBeenCalledWith({ $id: 'SchemaOne' });
    expect(hoisted.app!.addSchema).not.toHaveBeenCalledWith({ title: 'Not a schema' } as any);
    expect(hoisted.memoryCacheManager.loadAll).toHaveBeenCalled();
    expect(hoisted.cacheMonitoringService.start).toHaveBeenCalled();
    const expectsOxigraphInit = process.env.ENABLE_OXIGRAPH === 'true';
    if (expectsOxigraphInit) {
      expect(hoisted.oxigraphStoreManager.initialize).toHaveBeenCalled();
    } else {
      expect(hoisted.oxigraphStoreManager.initialize).not.toHaveBeenCalled();
    }
    expect(hoisted.app!.register).toHaveBeenCalledWith(hoisted.corsPlugin, expect.any(Object));
    /*
     * `Accept` among them, because a report export negotiates its format with
     * it — `Accept: application/rdf+xml` on a test run returns EARL. That value
     * is not CORS-safelisted, so the request preflights, and a preflight that
     * does not list the header fails the whole call from a browser.
     */
    const corsOptions = hoisted.app!.register.mock.calls
      .find(([plugin]) => plugin === hoisted.corsPlugin)?.[1] as { allowedHeaders: string[] };
    expect(corsOptions.allowedHeaders).toContain('Accept');
    expect(hoisted.app!.listen).toHaveBeenCalledWith({ port: 3000, host: '0.0.0.0' });
    expect(hoisted.app!.register).toHaveBeenCalledWith(hoisted.swaggerUiPlugin, expect.any(Object));
    expect(hoisted.app!.register).toHaveBeenCalledWith(hoisted.backendRoutes, { prefix: '/backends' });
    // Auth is wired before routes, so every request carries a context.
    expect(hoisted.app!.addHook).toHaveBeenCalledWith('onRequest', expect.any(Function));
    expect(hoisted.app!.register).toHaveBeenCalledWith(hoisted.executeRoutes, { prefix: '/execute' });
    expect(hoisted.app!.register).toHaveBeenCalledWith(hoisted.sparqlRoutes, { prefix: '' });
    expect(hoisted.app!.get).toHaveBeenCalledWith('/', expect.any(Function));
    expect(hoisted.app!.get).toHaveBeenCalledWith('/health', expect.any(Object), expect.any(Function));
    expect(hoisted.app!.get).toHaveBeenCalledWith('/metrics', expect.any(Object), expect.any(Function));
    expect(process.on).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
  });

  it('registers all application routes beneath APP_BASE_PATH when configured', async () => {
    process.env.APP_BASE_PATH = '/proxy-base/';

    const indexModuleUrl = new URL('../src/index.ts', import.meta.url);
    const indexModule = await import(indexModuleUrl.href) as any;

    await indexModule.start(hoisted.app);
    await new Promise(resolve => setImmediate(resolve));

    expect(hoisted.app!.get).not.toHaveBeenCalledWith('/', expect.any(Function));

    const scopedRegistration = hoisted.app!.register.mock.calls.find(([, options]) => options?.prefix === '/proxy-base');
    expect(scopedRegistration).toBeDefined();
    expect(typeof scopedRegistration?.[0]).toBe('function');

    const scopedApp = createStubApp();
    await scopedRegistration![0](scopedApp);

    expect(scopedApp.register).toHaveBeenCalledWith(hoisted.swaggerUiPlugin, expect.any(Object));
    expect(scopedApp.register).toHaveBeenCalledWith(hoisted.backendRoutes, { prefix: '/backends' });
    expect(scopedApp.register).toHaveBeenCalledWith(hoisted.executeRoutes, { prefix: '/execute' });
    expect(scopedApp.register).toHaveBeenCalledWith(hoisted.sparqlRoutes, { prefix: '' });
    expect(scopedApp.get).toHaveBeenCalledWith('/', expect.any(Function));
    expect(scopedApp.get).toHaveBeenCalledWith('/health', expect.any(Object), expect.any(Function));
    expect(scopedApp.get).toHaveBeenCalledWith('/metrics', expect.any(Object), expect.any(Function));

    const redirectHandler = scopedApp.get.mock.calls.find(([path]) => path === '/')?.[1];
    expect(redirectHandler).toBeTypeOf('function');

    const reply = { redirect: vi.fn() };
    await redirectHandler({}, reply);
    expect(reply.redirect).toHaveBeenCalledWith('/proxy-base/docs/');
  });

  it('serves health and metrics snapshots', async () => {
    const indexModuleUrl = new URL('../src/index.ts', import.meta.url);
    const indexModule = await import(indexModuleUrl.href) as any;

    await indexModule.start(hoisted.app);
    await new Promise(resolve => setImmediate(resolve));

    const healthHandler = hoisted.app!.get.mock.calls.find(([path]) => path === '/health')?.[2];
    const metricsHandler = hoisted.app!.get.mock.calls.find(([path]) => path === '/metrics')?.[2];

    expect(healthHandler).toBeTypeOf('function');
    expect(metricsHandler).toBeTypeOf('function');

    const healthReply = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };
    await healthHandler({}, healthReply);
    expect(healthReply.status).toHaveBeenCalledWith(200);
    expect(healthReply.send).toHaveBeenCalledWith(expect.objectContaining({
      auth: { mode: 'disabled' },
      status: 'ok',
      cache: expect.objectContaining({
        ready: true,
        totalEntities: 3,
        estimatedMemoryBytes: 1024,
      }),
      /*
       * Both caps are environment-tunable, so the SPA reads them here rather
       * than carrying a copy: a deployment that raised the server's cap used to
       * leave a UI refusing uploads at the old figure.
       */
      limits: expect.objectContaining({
        dataGraphVersionBytes: expect.any(Number),
        dataGraphLibraryBytes: expect.any(Number),
        tupleSetVersionBytes: expect.any(Number),
        tupleSetLibraryBytes: expect.any(Number),
      }),
    }));

    /*
     * The payload carrying `readOnly` is not enough: Fastify serialises a
     * response against its schema and drops what the schema does not declare,
     * which is how a read-only deployment reported itself as writable and the
     * SPA went on offering Save (issue #26). So the declaration is what this
     * asserts, on both the ready and the not-ready response.
     */
    const healthSchema = hoisted.app!.get.mock.calls.find(([path]) => path === '/health')?.[1]
      ?.schema?.response as Record<string, any>;
    for (const status of [200, 503]) {
      expect(healthSchema[status].properties.readOnly, `${status} declares readOnly`).toEqual({
        type: 'boolean',
      });
      expect(healthSchema[status].required).toContain('readOnly');
    }
    expect(healthReply.send.mock.calls[0][0]).toHaveProperty('readOnly', false);

    const metricsReply = {
      send: vi.fn(),
    };
    await metricsHandler({}, metricsReply);
    expect(metricsReply.send).toHaveBeenCalledWith(expect.objectContaining({
      process: expect.objectContaining({
        pid: expect.any(Number),
        nodeVersion: expect.any(String),
      }),
      cache: expect.objectContaining({
        totalEntities: 3,
        entityTypes: expect.objectContaining({
          Library: { count: 2, memoryBytes: 768 },
        }),
      }),
      oxigraph: {
        stores: {
          'library-store': { tripleCount: 12, memoryUsage: 2048 },
        },
        summary: {
          totalStores: 1,
          totalTriples: 12,
          totalMemoryBytes: 2048,
        },
      },
      uptimeSeconds: expect.any(Number),
      timestamp: expect.any(String),
    }));
  });

  it('uses APP_PUBLIC_BASE_PATH for docs URLs without remounting application routes', async () => {
    process.env.APP_PUBLIC_BASE_PATH = '/proxy-base/';

    const indexModuleUrl = new URL('../src/index.ts', import.meta.url);
    const indexModule = await import(indexModuleUrl.href) as any;

    await indexModule.start(hoisted.app);
    await new Promise(resolve => setImmediate(resolve));

    expect(hoisted.app!.register).not.toHaveBeenCalledWith(expect.any(Function), { prefix: '/proxy-base' });

    const swaggerUiRegistration = hoisted.app!.register.mock.calls.find(([plugin]) => plugin === hoisted.swaggerUiPlugin);
    expect(swaggerUiRegistration?.[1]).toMatchObject({
      routePrefix: '/docs',
      indexPrefix: '/proxy-base',
    });

    const swaggerRegistration = hoisted.app!.register.mock.calls.find(([plugin]) => plugin === hoisted.swaggerPlugin);
    expect(swaggerRegistration?.[1]).toMatchObject({
      routePrefix: '/docs',
      openapi: expect.objectContaining({
        servers: [{ url: '/proxy-base' }],
      }),
    });

    const redirectHandler = hoisted.app!.get.mock.calls.find(([path]) => path === '/')?.[1];
    expect(redirectHandler).toBeTypeOf('function');

    const reply = { redirect: vi.fn() };
    await redirectHandler({}, reply);
    expect(reply.redirect).toHaveBeenCalledWith('/proxy-base/docs/');
  });
});

describe('normalizeBasePath', () => {
  it.each([
    [undefined, ''],
    ['', ''],
    ['/', ''],
    ['proxy', '/proxy'],
    ['/proxy', '/proxy'],
    ['/proxy/', '/proxy'],
    [' /proxy/nested/ ', '/proxy/nested'],
  ])('normalizes %p to %p', async (input, expected) => {
    const indexModuleUrl = new URL('../src/index.ts', import.meta.url);
    const indexModule = await import(indexModuleUrl.href) as any;

    expect(indexModule.normalizeBasePath(input)).toBe(expected);
  });
});

afterAll(() => {
  vi.doUnmock('fastify');
  vi.doUnmock('@fastify/cors');
  vi.doUnmock('@fastify/multipart');
  vi.doUnmock('@fastify/swagger');
  vi.doUnmock('@fastify/swagger-ui');
  vi.doUnmock('../src/lib/validator-setup.ts');
  vi.doUnmock('../src/lib/MemoryCacheManager.js');
  vi.doUnmock('../src/lib/CacheMonitoringService.js');
  vi.doUnmock('../src/lib/OxigraphStoreManager.js');
  vi.doUnmock('../src/routes/backends.js');
  vi.doUnmock('../src/routes/queries.js');
  vi.doUnmock('../src/routes/detection.js');
  vi.doUnmock('../src/routes/query-groups.js');
  vi.doUnmock('../src/routes/libraries.js');
  vi.doUnmock('../src/routes/execute.js');
  vi.doUnmock('../src/routes/sparql.js');
  vi.doUnmock('@sparql-query-lib/contracts/schema');
  vi.doUnmock('../src/otel-setup.js');
  vi.resetModules();
});
