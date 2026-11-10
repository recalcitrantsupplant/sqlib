import { describe, it, expect } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { request } from 'undici';
import { TracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';

/**
 * SPARQL backends are called through undici (`server/HttpSparqlExecutor.ts`),
 * which the `node:http` instrumentation does not see. `otel-setup.ts` adds
 * the undici instrumentation for this hop; this drives it the same way, so a
 * span-shape change across an upstream bump shows up here.
 */
describe('undici instrumentation', () => {
  it('emits a client span for a request to a SPARQL endpoint', async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter })] });
    const instrumentation = new UndiciInstrumentation();
    instrumentation.setTracerProvider(provider);
    instrumentation.enable();

    const server = http.createServer((_req, res) => {
      res.setHeader('content-type', 'application/sparql-results+json');
      res.end('{"head":{"vars":[]},"results":{"bindings":[]}}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const response = await request(`http://127.0.0.1:${port}/sparql`, { method: 'POST', body: 'query=ASK{}' });
      await response.body.text();
    } finally {
      instrumentation.disable();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    const spans = exporter.getFinishedSpans();
    await provider.shutdown();
    const client = spans.find((span) => span.attributes['url.full'] === `http://127.0.0.1:${port}/sparql`);
    expect(client).toBeDefined();
    expect(client?.attributes['http.request.method']).toBe('POST');
    expect(client?.attributes['http.response.status_code']).toBe(200);
  });
});
