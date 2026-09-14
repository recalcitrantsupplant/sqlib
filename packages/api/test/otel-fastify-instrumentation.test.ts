import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { NodeTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { FastifyOtelInstrumentation } from '@fastify/otel';

/**
 * `otel-setup.ts` wires `@fastify/otel` into the NodeSDK bootstrap (issue
 * #203, replacing the deprecated `@opentelemetry/instrumentation-fastify`),
 * but that bootstrap is exercised behind heavy module mocks in
 * `otel-setup.test.ts` — enough to check the SDK is constructed and shut down,
 * not to see a real span. This drives the instrumentation itself, the same
 * way `otel-setup.ts` configures it, so a span-shape regression across an
 * upstream `@fastify/otel` bump shows up here rather than only in a
 * dashboard.
 */
describe('@fastify/otel instrumentation', () => {
  it('emits a request span with the method, route, and status a dashboard reads', async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });

    const instrumentation = new FastifyOtelInstrumentation();
    instrumentation.setTracerProvider(provider);

    const app = Fastify();
    await app.register(instrumentation.plugin());
    app.get('/widgets/:id', async (request) => ({ id: (request.params as { id: string }).id }));
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/widgets/42' });
    await app.close();

    expect(response.statusCode).toBe(200);

    // Read before shutdown: InMemorySpanExporter clears its buffer on shutdown.
    const requestSpan = exporter.getFinishedSpans().find((span) => span.name === 'request');
    await provider.shutdown();

    expect(requestSpan).toBeDefined();
    expect(requestSpan?.attributes['http.request.method']).toBe('GET');
    expect(requestSpan?.attributes['http.route']).toBe('/widgets/:id');
    expect(requestSpan?.attributes['http.response.status_code']).toBe(200);
  });
});
