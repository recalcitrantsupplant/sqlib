/**
 * Every request the API client sends carries the caller's token.
 *
 * Most calls go through `request`, which wraps them in `authorized()`, so a new
 * call written the usual way is covered without anyone thinking about it. The
 * calls that need the raw response — a run, whose body is the endpoint's own
 * bytes — call `fetch` themselves, and two of them did so without the wrapper:
 * running a query and executing a stored one sent no `Authorization` header.
 * Under an enforcing auth mode, or behind a gateway that checks the token, the
 * library loaded and every run was refused with 401.
 *
 * Read off the source rather than by running the client, like
 * requestHeaders.test.ts beside it: what matters is how each call is written.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CLIENT = resolve(import.meta.dirname, '../src/composables/useApiClient.ts');

/** The full argument text of each `fetch(…)` call, balanced on parentheses. */
function fetchCalls(source: string): { line: number; args: string }[] {
  const calls: { line: number; args: string }[] = [];
  for (const match of source.matchAll(/\bfetch\(/g)) {
    let depth = 1;
    let i = match.index! + match[0].length;
    while (depth > 0 && i < source.length) {
      if (source[i] === '(') depth += 1;
      else if (source[i] === ')') depth -= 1;
      i += 1;
    }
    calls.push({
      line: source.slice(0, match.index).split('\n').length,
      args: source.slice(match.index! + match[0].length, i - 1),
    });
  }
  return calls;
}

describe('API client authentication', () => {
  it('sends the token on every fetch', () => {
    const calls = fetchCalls(readFileSync(CLIENT, 'utf8'));
    const bare = calls
      .filter(({ args }) => !/\bauthorized\(/.test(args) && !/\bauthorization\b/.test(args))
      .map(({ line }) => `useApiClient.ts:${line}`);
    expect(bare, 'wrap the request in authorized(), as request() does').toEqual([]);
  });

  it('finds the calls, so the check cannot pass by finding nothing', () => {
    expect(fetchCalls(readFileSync(CLIENT, 'utf8')).length).toBeGreaterThanOrEqual(4);
  });
});
