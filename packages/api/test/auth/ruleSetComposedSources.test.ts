/**
 * The rule-set twin of `queryGroupComposedSources.test.ts`.
 *
 * A rule set version pins rule and data block versions by id, and they need
 * not live in the rule set's library. Executing the set runs them, so pinning
 * one needs Execute on the library it belongs to — otherwise write on your own
 * set was a way to run another library's rules.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type { AuthContext, LibraryMode } from '../../src/auth/types.js';
import { AuthorizationError } from '../../src/auth/enforce.js';
import { overrideCacheCoordinatorProvider } from '../../src/lib/CacheCoordinatorProvider.js';
import { createRuleSetVersion } from '../../src/lib/RuleSetVersionWriter.js';

const MINE = 'urn:sqlib:library:hydrology';
const THEIRS = 'urn:sqlib:library:payroll';
const MY_SET = 'urn:sqlib:ruleset:mine';

const store = new Map<string, Record<string, unknown>>();
const created: string[] = [];

overrideCacheCoordinatorProvider({
  getCacheCoordinator: () => ({
    get: (iri: string) => store.get(iri) ?? null,
    list: (type: string) => [...store.values()].filter(entity => entity['@type'] === type),
    create: async (_type: string, entity: Record<string, unknown>) => {
      created.push(String(entity.$id));
      return entity;
    },
    update: async () => null,
  }),
  getEntityRepositories: () => ({}),
});

function requestFor(modes: LibraryMode[]): FastifyRequest {
  const context: AuthContext = {
    subject: 'urn:sqlib:principal:user:caller',
    principals: ['urn:sqlib:principal:user:caller'],
    issuer: 'https://issuer.test/',
    tokenType: 'user',
    grants: { admin: false, backends: new Map(), libraries: new Map([[MINE, new Set(modes)]]) },
    claims: {},
    fullAccess: false,
    mode: 'required',
  };
  return {
    id: 'req-1', method: 'POST', url: '/rule-sets',
    log: { warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn() },
    authContext: context,
  } as unknown as FastifyRequest;
}

function pinnable(type: 'Rule' | 'DataBlock', id: string, library: string): string {
  store.set(id, { $id: id, '@type': type, isPartOf: [library] });
  const versionId = `${id}:v1`;
  store.set(versionId, { $id: versionId, '@type': `${type}Version`, isPartOf: id, version: 1 });
  return versionId;
}

beforeEach(() => {
  store.clear();
  created.length = 0;
  store.set(MINE, { $id: MINE, '@type': 'Library' });
  store.set(THEIRS, { $id: THEIRS, '@type': 'Library' });
  store.set(MY_SET, { $id: MY_SET, '@type': 'RuleSet', isPartOf: [MINE] });
});

describe('createRuleSetVersion under a caller', () => {
  const caller = () => ({ request: requestFor(['read', 'write', 'execute']) });

  it('refuses a rule version from a library the caller cannot execute, naming it, and writes nothing', async () => {
    const theirRule = pinnable('Rule', 'urn:sqlib:rule:theirs', THEIRS);

    const attempt = createRuleSetVersion(MY_SET, { hasRule: [theirRule] }, caller());

    await expect(attempt).rejects.toBeInstanceOf(AuthorizationError);
    await expect(attempt).rejects.toThrow(theirRule);
    expect(created).toEqual([]);
  });

  it('refuses a data block version the same way', async () => {
    const theirBlock = pinnable('DataBlock', 'urn:sqlib:data-block:theirs', THEIRS);

    await expect(createRuleSetVersion(MY_SET, { hasDataBlock: [theirBlock] }, caller()))
      .rejects.toBeInstanceOf(AuthorizationError);
    expect(created).toEqual([]);
  });
});
