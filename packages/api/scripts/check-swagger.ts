import Fastify from 'fastify';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import * as schemas from '../../contracts/src/schema/index.js';

async function main() {
  const app = Fastify({ logger: false });

  // Register swagger (JSON) and swagger-ui (HTML) with a test prefix
  await app.register(fastifySwagger as any, {
    routePrefix: '/docs',
    openapi: {
      info: {
        title: 'Test API',
        description: 'Testing OpenAPI generation',
        version: '0.0.0'
      },
      tags: []
    },
    hideUntagged: true,
    stripBasePath: true,
  });

  await app.register(fastifySwaggerUi, {
    routePrefix: '/docs',
    staticCSP: false,
  });

  // Try adding schemas one by one to pinpoint failures
  const idSchemas = Object.entries(schemas).filter(([, s]) => s && typeof s === 'object' && '$id' in (s as any)) as Array<[string, any]>;
  for (const [name, schema] of idSchemas) {
    const local = Fastify({ logger: false });
    await local.register(fastifySwagger as any, {
      routePrefix: '/docs',
      openapi: { info: { title: 'Test API', version: '0.0.0' } },
      hideUntagged: true,
      stripBasePath: true,
    });
    await local.register(fastifySwaggerUi, { routePrefix: '/docs', staticCSP: false });
    local.addSchema(schema);
    await local.ready();
    const res = await local.inject({ method: 'GET', url: '/docs/json' });
    if (res.statusCode !== 200) {
      console.error(`Schema '${name}' with $id='${schema.$id}' caused failure:`, res.statusCode, res.body);
      process.exit(1);
    }
    await local.close();
  }

  // If all individual schemas pass, try all together
  for (const [, schema] of idSchemas) app.addSchema(schema);
  await app.ready();
  const res = await app.inject({ method: 'GET', url: '/docs/json' });
  if (res.statusCode !== 200) {
    console.error('Combined schemas caused failure:', res.statusCode, res.body);
    process.exit(1);
  }
  const json = res.json();
  console.log('OpenAPI title:', json?.info?.title);
  console.log('Schemas OK count:', Object.keys(json?.components?.schemas || {}).length);

  await app.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
