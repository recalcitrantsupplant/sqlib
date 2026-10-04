/**
 * A fake of what `useApiClient()` returns, for mounting a whole work area.
 *
 * The component specs fake the client rather than `fetch` (see
 * `BackendWorkArea.test.ts`), each listing the handful of methods its
 * component calls. A work area like QueryWorkArea reaches the client through
 * a dozen stores and composables, so an explicit list would be a hundred lines
 * that drift every time one of them starts calling something new. This answers
 * any method instead, and records every call:
 *
 *   - a method with a handler set on `responses` resolves with what it returns;
 *   - an unhandled `list*` method resolves with `[]` (nothing of that kind yet);
 *   - any other unhandled method rejects, naming itself — a call the spec did
 *     not anticipate fails loudly rather than resolving with `undefined`.
 *
 * Every call is recorded in order, whether handled or not, so a spec asserts
 * on the request the "server" received: `fake.callsTo('createQueryVersion')`.
 */

export interface FakeApiCall {
  method: string;
  args: unknown[];
}

export type FakeApiHandler = (...args: never[]) => unknown;

export interface FakeApiClient {
  /** Pass to `vi.mock('@/composables/useApiClient', …)` as the client. */
  client: Record<string, (...args: unknown[]) => Promise<unknown>>;
  /** Every call, in order. */
  calls: FakeApiCall[];
  /** Per-method responses; replace or add one in a spec or a `beforeEach`. */
  responses: Record<string, FakeApiHandler>;
  /** The argument lists of every call to one method, in order. */
  callsTo(method: string): unknown[][];
  /** Forget calls and responses, between tests. */
  reset(): void;
}

export function createFakeApiClient(): FakeApiClient {
  const calls: FakeApiCall[] = [];
  const responses: Record<string, FakeApiHandler> = {};

  const client = new Proxy({} as Record<string, (...args: unknown[]) => Promise<unknown>>, {
    get(_target, property) {
      // Not a method: symbols, and `then` — answering `then` would make the
      // client itself look like a promise to anything that awaits it.
      if (typeof property !== 'string' || property === 'then') return undefined;
      return (...args: unknown[]) => {
        calls.push({ method: property, args });
        const handler = responses[property] as ((...handlerArgs: unknown[]) => unknown) | undefined;
        if (handler) return Promise.resolve().then(() => handler(...args));
        if (property.startsWith('list')) return Promise.resolve([]);
        return Promise.reject(new Error(`fake API: no response for ${property}`));
      };
    },
  });

  return {
    client,
    calls,
    responses,
    callsTo: (method) => calls.filter((call) => call.method === method).map((call) => call.args),
    reset() {
      calls.length = 0;
      for (const key of Object.keys(responses)) delete responses[key];
    },
  };
}
