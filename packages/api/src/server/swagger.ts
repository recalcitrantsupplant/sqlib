/**
 * The OpenAPI document and its UI at `/docs`. Tags follow the feature flags, so
 * a section that is switched off is not advertised.
 */
import type { FastifyInstance } from 'fastify';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import type { FeatureFlags } from '@sparql-query-lib/types';

export async function registerSwaggerDocs(
  fastifyApp: FastifyInstance,
  featureFlags: FeatureFlags,
  publicBasePath: string,
): Promise<void> {
  const swaggerTags = [
    { name: 'Library', description: 'Routes for managing Query Libraries' },
  ];

  if (featureFlags.backends) {
    swaggerTags.push({ name: 'Backend', description: 'Routes for managing SPARQL backends' });
  }

  if (featureFlags.queries) {
    swaggerTags.push({ name: 'Query', description: 'Routes for managing SPARQL queries' });
    swaggerTags.push({ name: 'Execution', description: 'Routes for executing queries' });
  }

  if (featureFlags.rulesSuite) {
    swaggerTags.push({ name: 'Rule', description: 'Routes for managing SHACL rules' });
    swaggerTags.push({ name: 'DataBlock', description: 'Routes for managing data blocks' });
    swaggerTags.push({ name: 'RuleSet', description: 'Routes for managing rule sets' });
  }

  if (featureFlags.queryGroups) {
    swaggerTags.push({ name: 'QueryGroup', description: 'Routes for managing Query Groups' });
  }

  if (featureFlags.benchmarks) {
    swaggerTags.push({ name: 'Benchmark', description: 'Routes for managing benchmarks' });
  }

  swaggerTags.push({ name: 'Utility', description: 'Utility routes for query analysis' });

  await fastifyApp.register(fastifySwagger as unknown as Parameters<FastifyInstance['register']>[0], {
    routePrefix: '/docs',
    openapi: {
      info: {
        title: 'SPARQL Query Library API',
        description: 'API for managing and running SPARQL queries',
        version: '1.0.0'
      },
      externalDocs: {
        url: 'https://swagger.io',
        description: 'Find more info here'
      },
      tags: swaggerTags,
      servers: [{ url: publicBasePath || '/' }]
    },
    // hide the routes from swagger documentation
    hideUntagged: true,
    stripBasePath: true,
  });

  await fastifyApp.register(fastifySwaggerUi, {
    routePrefix: '/docs',
    staticCSP: false,
    indexPrefix: publicBasePath
  });
}
