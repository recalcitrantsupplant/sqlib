/**
 * The assistant without its optional AI SDK packages.
 *
 * `ai` and `@ai-sdk/*` are optional dependencies of this package, so an
 * MCP-only install can leave them out. With FEATURE_ASSISTANT on and the
 * packages missing, the server must still boot, mount `/assistant`, and say
 * what is missing — not fail to start.
 */
import { describe, it, expect, afterAll, vi } from 'vitest';
import Fastify from 'fastify';
import { buildFeatureFlags, type FeatureFlags } from '@sparql-query-lib/types';
import * as schemas from '@sparql-query-lib/contracts/schema';
import { setupValidator } from '../../src/lib/validator-setup.js';
import { overrideCacheCoordinatorProvider } from '../../src/lib/CacheCoordinatorProvider.js';
import { registerApplicationRoutes } from '../../src/server/registerRoutes.js';
import * as assistantRoutes from '../../src/routes/assistant.js';
import { missingAiSdkModelClientFactory } from '../../src/assistant/model.js';

// What Node throws when `import 'ai'` cannot resolve the package.
vi.mock('../../src/assistant/ai-sdk-client.js', () => ({
  get aiSdkModelClientFactory() {
    throw Object.assign(new Error("Cannot find package 'ai'"), { code: 'ERR_MODULE_NOT_FOUND' });
  },
}));

overrideCacheCoordinatorProvider({
  getCacheCoordinator: () => ({ get: () => null, list: () => [] }),
  getEntityRepositories: () => ({}),
});

afterAll(() => {
  overrideCacheCoordinatorProvider(null);
  assistantRoutes.resetAssistantConfiguration();
});

describe('the assistant without the optional AI SDK', () => {
  it('still mounts /assistant, warns, and wires the explanatory factory', async () => {
    const configure = vi.spyOn(assistantRoutes, 'configureAssistant');
    // Only the assistant on, as in registerRoutes.flags.test.ts, to keep the boot small.
    const featureFlags = {
      ...buildFeatureFlags({}),
      queries: false, queryGroups: false, rulesSuite: false, tests: false, benchmarks: false, etl: false,
      playgroundQueries: false, playgroundRules: false, playgroundEtl: false,
      assistant: true,
    } as FeatureFlags;
    const warnings: string[] = [];
    const app = Fastify({ logger: false });
    vi.spyOn(app.log, 'warn').mockImplementation(((message: string) => { warnings.push(message); }) as never);
    setupValidator(app);
    for (const schema of Object.values(schemas)) {
      if (schema && typeof schema === 'object' && '$id' in schema) app.addSchema(schema as never);
    }
    const routes: string[] = [];
    app.addHook('onRoute', route => { routes.push(route.path); });

    await registerApplicationRoutes(app, { featureFlags, registerSwagger: false, publicBasePath: '' });
    await app.ready();
    await app.close();

    expect(routes.some(path => path.startsWith('/assistant'))).toBe(true);
    expect(warnings.some(message => message.includes('optional AI SDK packages'))).toBe(true);
    expect(configure).toHaveBeenCalledWith({ modelClientFactory: missingAiSdkModelClientFactory });
  });

  it('fails a turn with the fix in the message', async () => {
    const client = missingAiSdkModelClientFactory({ provider: 'anthropic', model: 'any' });
    await expect(client.stream({ messages: [], tools: [] })[Symbol.asyncIterator]().next())
      .rejects.toThrow(/optional AI SDK packages/);
  });
});
