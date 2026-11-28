/**
 * Demo mode (`config/demoMode.ts`): what starts, who a request acts as, and
 * what a visitor cannot do with the header.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { AuthStore, setAuthStore, inMemoryPersistence } from '../../src/auth/AuthStore.js';
import { resetAuthConfig } from '../../src/auth/config.js';
import { registerAuthPlugin } from '../../src/auth/plugin.js';
import { authOf } from '../../src/auth/enforce.js';
import { callerIdentityOf } from '../../src/auth/caller.js';
import { principalIri } from '../../src/auth/principals.js';
import { demoAdminPrincipals, recordDemoPeople } from '../../src/auth/demoPeople.js';
import { PRINCIPAL_ANONYMOUS, PRINCIPAL_AUTHENTICATED } from '../../src/auth/types.js';
import { DEMO_ISSUER, isOneVisitorDemo, parseDemoPeople, resetDemoMode, resolveDemoConfig } from '../../src/config/demoMode.js';

const PEOPLE = {
  people: [
    { id: 'alice', name: 'Alice', groups: ['analysts'] },
    { id: 'dana', name: 'Dana', groups: ['admins'], admin: true },
  ],
};

function peopleFile(content: unknown = PEOPLE): string {
  const dir = mkdtempSync(join(tmpdir(), 'sqlib-demo-'));
  const path = join(dir, 'people.json');
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content));
  return path;
}

function demoEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    SQLIB_DEMO: 'true',
    SQLIB_READ_ONLY: 'true',
    SQLIB_AUTH_MODE: 'anonymous',
    SQLIB_DEMO_PEOPLE: peopleFile(),
    ...extra,
  } as NodeJS.ProcessEnv;
}

const BACKEND = 'urn:sqlib:backend:demo';
const alice = principalIri('user', DEMO_ISSUER, 'alice');
const analysts = principalIri('group', DEMO_ISSUER, 'analysts');
const dana = principalIri('user', DEMO_ISSUER, 'dana');

let store: AuthStore;

beforeEach(async () => {
  store = new AuthStore(inMemoryPersistence());
  await store.load();
  setAuthStore(store);
});

afterEach(() => {
  setAuthStore(null);
  resetDemoMode({} as NodeJS.ProcessEnv);
});

async function buildApp(env: NodeJS.ProcessEnv = demoEnv()): Promise<FastifyInstance> {
  resetAuthConfig({ SQLIB_AUTH_MODE: 'anonymous' } as NodeJS.ProcessEnv);
  resetDemoMode(env);
  store.setBootstrapAdmins(demoAdminPrincipals());
  const app = Fastify({ logger: false });
  await registerAuthPlugin(app);
  app.get('/whoami', async request => {
    const context = authOf(request);
    return {
      subject: context.subject,
      principals: context.principals,
      admin: context.grants.admin,
      fullAccess: context.fullAccess,
      mode: context.mode,
      caller: callerIdentityOf(context),
      backends: Object.fromEntries([...context.grants.backends].map(([iri, modes]) => [iri, [...modes].sort()])),
    };
  });
  await app.ready();
  return app;
}

describe('starting in demo mode', () => {
  it('is off unless SQLIB_DEMO=true', () => {
    expect(resolveDemoConfig({ SQLIB_READ_ONLY: 'true' } as NodeJS.ProcessEnv)).toEqual({ enabled: false, people: [] });
  });

  it('refuses to start on a writable deployment', () => {
    expect(() => resolveDemoConfig(demoEnv({ SQLIB_READ_ONLY: 'false' }))).toThrow(/SQLIB_READ_ONLY=true/);
  });

  it('starts writable when SQLIB_DEMO_WRITABLE=true says it serves one visitor', () => {
    const config = resolveDemoConfig(demoEnv({ SQLIB_READ_ONLY: 'false', SQLIB_DEMO_WRITABLE: 'true' }));
    expect(config.enabled).toBe(true);
    expect(config.writable).toBe(true);
  });

  it('is a one-visitor demo only when writable', () => {
    resetDemoMode(demoEnv({ SQLIB_READ_ONLY: 'false', SQLIB_DEMO_WRITABLE: 'true' }));
    expect(isOneVisitorDemo()).toBe(true);
    resetDemoMode(demoEnv({ SQLIB_DEMO_WRITABLE: 'true' }));
    expect(isOneVisitorDemo()).toBe(false);
    resetDemoMode({} as NodeJS.ProcessEnv);
  });

  it('refuses to start in any auth mode other than anonymous', () => {
    for (const mode of ['disabled', 'required', 'dry-run', '']) {
      expect(() => resolveDemoConfig(demoEnv({ SQLIB_AUTH_MODE: mode }))).toThrow(/SQLIB_AUTH_MODE=anonymous/);
    }
  });

  it('refuses a people file it cannot read or parse', () => {
    expect(() => resolveDemoConfig(demoEnv({ SQLIB_DEMO_PEOPLE: '/no/such/file.json' }))).toThrow(/cannot read/);
    expect(() => resolveDemoConfig(demoEnv({ SQLIB_DEMO_PEOPLE: peopleFile('{') }))).toThrow(/not JSON/);
  });

  it('starts with no people when no file is named', () => {
    expect(resolveDemoConfig(demoEnv({ SQLIB_DEMO_PEOPLE: '' }))).toEqual({ enabled: true, people: [] });
  });

  it('checks each person', () => {
    expect(() => parseDemoPeople('{"people":[{"id":"Alice","name":"A"}]}')).toThrow(/lower-case/);
    expect(() => parseDemoPeople('{"people":[{"id":"a","name":" "}]}')).toThrow(/"name" is empty/);
    expect(() => parseDemoPeople('{"people":[{"id":"a","name":"A"},{"id":"a","name":"B"}]}')).toThrow(/used twice/);
    expect(() => parseDemoPeople('{"people":[{"id":"a","name":"A","groups":"x"}]}')).toThrow(/"groups"/);
    expect(() => parseDemoPeople('{"people":[{"id":"a","name":"A","admin":"yes"}]}')).toThrow(/"admin"/);
    expect(parseDemoPeople('{"people":[{"id":"a","name":"A"}]}')).toEqual([{ id: 'a', name: 'A', groups: [], admin: false }]);
  });
});

describe('a request in demo mode', () => {
  it('is a guest without the header', async () => {
    const app = await buildApp();
    const body = (await app.inject({ method: 'GET', url: '/whoami' })).json();
    expect(body).toMatchObject({ subject: PRINCIPAL_ANONYMOUS, principals: [PRINCIPAL_ANONYMOUS], caller: null });
    await app.close();
  });

  it('acts as the named person, their groups, the anonymous principal and the authenticated sentinel', async () => {
    const app = await buildApp();
    const body = (await app.inject({ method: 'GET', url: '/whoami', headers: { 'x-sqlib-demo-person': 'alice' } })).json();
    expect(body).toMatchObject({
      subject: alice,
      principals: [alice, analysts, PRINCIPAL_ANONYMOUS, PRINCIPAL_AUTHENTICATED],
      fullAccess: false,
      admin: false,
      mode: 'anonymous',
      caller: { user: alice, groups: [analysts] },
    });
    await app.close();
  });

  it('keeps what a guest holds and adds what the person holds', async () => {
    await store.createGrant({ principal: PRINCIPAL_ANONYMOUS, resourceKind: 'backend', resource: BACKEND, modes: ['query:saved'] });
    await store.createGrant({ principal: analysts, resourceKind: 'backend', resource: BACKEND, modes: ['query:adhoc'] });
    const app = await buildApp();
    const guest = (await app.inject({ method: 'GET', url: '/whoami' })).json();
    const asAlice = (await app.inject({ method: 'GET', url: '/whoami', headers: { 'x-sqlib-demo-person': 'alice' } })).json();
    expect(guest.backends).toEqual({ [BACKEND]: ['query:saved'] });
    expect(asAlice.backends[BACKEND]).toEqual(expect.arrayContaining(['query:saved', 'query:adhoc']));
    await app.close();
  });

  it('makes a person marked admin an administrator', async () => {
    const app = await buildApp();
    const body = (await app.inject({ method: 'GET', url: '/whoami', headers: { 'x-sqlib-demo-person': 'dana' } })).json();
    expect(body).toMatchObject({ subject: dana, admin: true, fullAccess: false });
    await app.close();
  });

  it('refuses a person the file does not list, rather than serving a guest', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/whoami', headers: { 'x-sqlib-demo-person': 'mallory' } });
    expect(response.statusCode).toBe(401);
    expect(response.json().error).toMatch(/No demo person "mallory"/);
    await app.close();
  });

  it('ignores the header outside demo mode', async () => {
    const app = await buildApp({} as NodeJS.ProcessEnv);
    const body = (await app.inject({ method: 'GET', url: '/whoami', headers: { 'x-sqlib-demo-person': 'alice' } })).json();
    expect(body).toMatchObject({ subject: PRINCIPAL_ANONYMOUS, caller: null });
    await app.close();
  });
});

describe('recording the demo people', () => {
  it('records each person with their name, and each group with its name', async () => {
    resetDemoMode(demoEnv());
    await recordDemoPeople(store);
    expect(store.principalRecord(alice)).toMatchObject({ displayName: 'Alice', label: 'Alice', kind: 'user' });
    expect(store.principalRecord(analysts)).toMatchObject({ rawClaim: 'analysts', kind: 'group' });
  });
});
