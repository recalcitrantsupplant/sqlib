import { afterEach, describe, expect, it, vi } from 'vitest';

const accessToken = vi.fn<() => Promise<string | null>>();
vi.mock('../useAuth', () => ({ useAuth: () => ({ accessToken }) }));
vi.mock('../../lib/clientId', () => ({ clientId: () => 'tab-1' }));

import { authorizedFetch } from '../authorizedFetch';

describe('authorizedFetch', () => {
  const fetchMock = vi.fn(async () => new Response('{}'));
  vi.stubGlobal('fetch', fetchMock);

  afterEach(() => {
    fetchMock.mockClear();
    accessToken.mockReset();
  });

  const sentHeaders = () => (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Headers;

  it('sends the bearer token with the caller headers', async () => {
    accessToken.mockResolvedValue('tok');
    await authorizedFetch('/api/etl-jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    const headers = sentHeaders();
    expect(headers.get('authorization')).toBe('Bearer tok');
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('x-sqlib-client-id')).toBe('tab-1');
  });

  it('sends no authorization header without a token', async () => {
    accessToken.mockResolvedValue(null);
    await authorizedFetch('/api/etl-jobs');
    expect(sentHeaders().has('authorization')).toBe(false);
  });
});
