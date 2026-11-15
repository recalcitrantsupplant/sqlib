/**
 * `GET /health` reports `SQLIB_LOCATION`, which the web UI shows beside its
 * warning for a slow round trip. Unset or blank gives null.
 */
import { afterEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { registerHealthRoute } from '../../src/server/health.js';

async function health(): Promise<Record<string, unknown>> {
  const app = Fastify();
  registerHealthRoute(app);
  const response = await app.inject({ method: 'GET', url: '/health' });
  await app.close();
  return response.json();
}

describe('GET /health location', () => {
  const original = process.env.SQLIB_LOCATION;
  afterEach(() => {
    if (original === undefined) delete process.env.SQLIB_LOCATION;
    else process.env.SQLIB_LOCATION = original;
  });

  it('is null when unset', async () => {
    delete process.env.SQLIB_LOCATION;
    expect((await health()).location).toBeNull();
  });

  it('is null when blank', async () => {
    process.env.SQLIB_LOCATION = '   ';
    expect((await health()).location).toBeNull();
  });

  it('reports the trimmed value', async () => {
    process.env.SQLIB_LOCATION = ' Sydney ';
    expect((await health()).location).toBe('Sydney');
  });
});
