import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';

const mockCache = {
  marker: 'cache',
} as const satisfies Record<string, unknown>;

const mockRepos = {
  marker: 'repos',
} as const satisfies Record<string, unknown>;

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: vi.fn(() => mockCache),
  getEntityRepositories: vi.fn(() => mockRepos),
}));

import { withCacheHandler, withReposHandler } from '../../src/routes/route-helpers.js';

type MockReply = Pick<FastifyReply, 'sent' | 'status' | 'send'> & {
  status: ReturnType<typeof vi.fn> & ((code: number) => MockReply);
  send: ReturnType<typeof vi.fn> & ((payload: unknown) => MockReply);
} & Partial<FastifyReply>;

const createRequest = () => ({
  log: {
    error: vi.fn(),
  },
}) as unknown as FastifyRequest;

const createReply = (): MockReply => {
  const reply: Partial<MockReply> = {
    sent: false,
    status: vi.fn().mockImplementation(function (this: MockReply) {
      return this;
    }),
    send: vi.fn().mockImplementation(function (this: MockReply) {
      return this;
    }),
  };
  return reply as MockReply;
};

describe('withCacheHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('provides cache, request and reply to the wrapped handler', async () => {
    const handler = vi.fn(async ({ cache }) => {
      expect(cache).toBe(mockCache);
      return 'ok';
    });

    const wrapped = withCacheHandler(handler);
    const request = createRequest();
    const reply = createReply();

    const result = await wrapped(request, reply as FastifyReply);

    expect(result).toBe('ok');
    expect(handler).toHaveBeenCalledTimes(1);
    const callArgs = handler.mock.calls[0][0];
    expect(callArgs.request).toBe(request);
    expect(callArgs.reply).toBe(reply);
    expect(callArgs.cache).toBe(mockCache);
    expect(reply.status).not.toHaveBeenCalled();
    expect(reply.send).not.toHaveBeenCalled();
  });

  it('maps handler errors with provided statusCode', async () => {
    const error = Object.assign(new Error('bad request'), { statusCode: 422 });
    const handler = vi.fn(async () => {
      throw error;
    });

    const wrapped = withCacheHandler(handler);
    const request = createRequest();
    const reply = createReply();

    await wrapped(request, reply as FastifyReply);

    expect(request.log.error).toHaveBeenCalledWith({
      err: error,
      route: 'undefined undefined',
      requestId: undefined,
      statusCode: 422,
      errorType: 'Error'
    }, 'Route handler failure');
    expect(reply.status).toHaveBeenCalledWith(422);
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
      error: 'bad request',
      route: 'undefined undefined'
    }));
  });

  it('falls back to 500 and generic message for unexpected errors', async () => {
    const handler = vi.fn(async () => {
      throw new Error('boom');
    });

    const wrapped = withCacheHandler(handler);
    const request = createRequest();
    const reply = createReply();

    await wrapped(request, reply as FastifyReply);

    expect(reply.status).toHaveBeenCalledWith(500);
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
      error: 'Internal Server Error',
      route: 'undefined undefined'
    }));
  });

  it('does not send a response if reply is already marked as sent', async () => {
    const handler = vi.fn(async () => {
      throw new Error('post-send failure');
    });

    const wrapped = withCacheHandler(handler);
    const request = createRequest();
    const reply = createReply();
    reply.sent = true;

    await wrapped(request, reply as FastifyReply);

    expect(reply.status).not.toHaveBeenCalled();
    expect(reply.send).not.toHaveBeenCalled();
  });
});

describe('withReposHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('provides repos, request and reply to the wrapped handler', async () => {
    const handler = vi.fn(async ({ repos }) => {
      expect(repos).toBe(mockRepos);
      return 'ok';
    });

    const wrapped = withReposHandler(handler);
    const request = createRequest();
    const reply = createReply();

    const result = await wrapped(request, reply as FastifyReply);

    expect(result).toBe('ok');
    expect(handler).toHaveBeenCalledTimes(1);
    const callArgs = handler.mock.calls[0][0];
    expect(callArgs.request).toBe(request);
    expect(callArgs.reply).toBe(reply);
    expect(callArgs.repos).toBe(mockRepos);
    expect(reply.status).not.toHaveBeenCalled();
    expect(reply.send).not.toHaveBeenCalled();
  });
});

describe('findVersionByNumber', () => {
  /*
   * This replaced fifteen copies of the same six lines across five route files.
   * The copies were each covered only through their own route's tests, so the
   * behaviour they shared was never asserted directly — which is what let them
   * stay copies. These are that assertion.
   */
  const versions = [
    { $id: 'v1', isPartOf: 'parent-a', version: 1 },
    { $id: 'v2', isPartOf: 'parent-a', version: 2 },
    { $id: 'other', isPartOf: 'parent-b', version: 1 },
  ];

  it('finds a version of the named parent', async () => {
    const { findVersionByNumber } = await import('../../src/routes/route-helpers.js');
    const result = findVersionByNumber(versions, 'parent-a', '2', 'data graph');
    expect(result).toEqual({ ok: true, version: versions[1] });
  });

  it('does not return another parent’s version of the same number', async () => {
    const { findVersionByNumber } = await import('../../src/routes/route-helpers.js');
    // `parent-b` has a v1, but `parent-a` is what was asked for; matching on
    // number alone would hand back a version of a different entity.
    const result = findVersionByNumber(
      [{ $id: 'other', isPartOf: 'parent-b', version: 1 }],
      'parent-a',
      '1',
      'data graph',
    );
    expect(result).toEqual({ ok: false, status: 404, error: 'Data graph version not found' });
  });

  it('rejects a non-numeric version with 400, not 404', async () => {
    const { findVersionByNumber } = await import('../../src/routes/route-helpers.js');
    // "you asked wrongly" and "it is not there" are different answers, and the
    // status code is the only place that difference is visible to a client.
    expect(findVersionByNumber(versions, 'parent-a', 'latest', 'test')).toEqual({
      ok: false,
      status: 400,
      error: 'Version must be a number',
    });
  });

  it('capitalises the noun for the message without the caller repeating it', async () => {
    const { findVersionByNumber } = await import('../../src/routes/route-helpers.js');
    expect(findVersionByNumber(versions, 'parent-a', '9', 'rule set')).toMatchObject({
      error: 'Rule set version not found',
    });
    expect(findVersionByNumber(versions, 'parent-a', '9', 'test')).toMatchObject({
      error: 'Test version not found',
    });
  });

  it('reads a numeric-looking version leniently, as parseInt always did', async () => {
    const { findVersionByNumber } = await import('../../src/routes/route-helpers.js');
    // Behaviour carried over deliberately rather than tightened: the routes
    // have accepted "2abc" as 2 for as long as they have existed, and changing
    // that here would be a silent API change hidden inside a refactor.
    expect(findVersionByNumber(versions, 'parent-a', '2abc', 'test')).toMatchObject({ ok: true });
  });
});
