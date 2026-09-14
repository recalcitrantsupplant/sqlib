/**
 * Applying a plan: which side each action lands on, and what the baseline
 * records afterwards.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockLocalStorage: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: vi.fn((key: string) => mockLocalStorage[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { mockLocalStorage[key] = value; }),
  removeItem: vi.fn((key: string) => { delete mockLocalStorage[key]; }),
  clear: vi.fn(() => { for (const key in mockLocalStorage) delete mockLocalStorage[key]; }),
});

const getBackendPrefixes = vi.fn();
const pushBackendPrefixes = vi.fn();

vi.mock('@/composables/useApiClient', () => ({
  useApiClient: () => ({ getBackendPrefixes, pushBackendPrefixes }),
}));

const BACKEND = 'urn:sqlib:backend:store';

async function load() {
  const sync = await import('@/composables/usePrefixSync');
  const { usePrefixManager } = await import('@/composables/usePrefixManager');
  return { ...sync, usePrefixManager };
}

function seed(mappings: unknown[]) {
  localStorage.setItem(
    'sparqlQueryLib.prefixSettings',
    JSON.stringify({ duplicateResolution: 'longest', mappings, showTooltips: true }),
  );
}

const mapping = (prefix: string, namespace: string, overrides: Record<string, unknown> = {}) => ({
  id: `id-${prefix}`,
  prefix,
  namespace,
  enabled: true,
  isDefault: false,
  source: 'user-added',
  createdAt: 0,
  ...overrides,
});

describe('usePrefixSync', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    vi.clearAllMocks();
    getBackendPrefixes.mockResolvedValue({ mappings: [], source: 'jena-prefixes', readOnly: false, endpoint: 'x' });
    pushBackendPrefixes.mockResolvedValue({ results: [], applied: 0, failed: 0 });
  });

  describe('the baseline', () => {
    it('round-trips, and reads as absent when it is not there or is corrupt', async () => {
      const { readBaseline, writeBaseline, clearBaseline } = await load();

      expect(readBaseline(BACKEND)).toBeNull();

      writeBaseline(BACKEND, { ex: 'http://example.org/' });
      expect(readBaseline(BACKEND)?.pairs).toEqual({ ex: 'http://example.org/' });

      localStorage.setItem(`sparqlQueryLib.prefixSync.${BACKEND}`, 'not json');
      expect(readBaseline(BACKEND)).toBeNull();

      writeBaseline(BACKEND, {});
      clearBaseline(BACKEND);
      expect(readBaseline(BACKEND)).toBeNull();
    });

    it('is per backend, so two stores do not read each other\'s history', async () => {
      const { readBaseline, writeBaseline } = await load();

      writeBaseline('urn:a', { ex: 'http://a/' });
      writeBaseline('urn:b', { ex: 'http://b/' });

      expect(readBaseline('urn:a')?.pairs.ex).toBe('http://a/');
      expect(readBaseline('urn:b')?.pairs.ex).toBe('http://b/');
    });
  });

  describe('expand', () => {
    it('splits actions by the side they act on', async () => {
      const { expand } = await load();

      const split = expand(
        [
          { kind: 'pull-add', prefix: 'a', namespace: 'http://a/' },
          { kind: 'push-add', prefix: 'b', namespace: 'http://b/' },
        ],
        [],
      );

      expect(split.local).toHaveLength(1);
      expect(split.remote).toHaveLength(1);
      expect(split.renames).toEqual([]);
    });

    it('turns a resolved conflict into the actions it stands for', async () => {
      const { expand } = await load();

      const split = expand(
        [{ kind: 'conflict', prefix: 'ex', local: 'http://ours/', localId: 'id-ex', remote: 'http://theirs/', resolution: 'both' }],
        ['ex'],
      );

      expect(split.local).toEqual([{ kind: 'pull-add', prefix: 'ex', namespace: 'http://theirs/' }]);
      expect(split.renames).toEqual([{ id: 'id-ex', to: 'ex-1' }]);
    });

    it('drops an unresolved conflict rather than guessing at it', async () => {
      const { expand } = await load();

      const split = expand(
        [{ kind: 'conflict', prefix: 'ex', local: 'http://ours/', localId: 'id-ex', remote: 'http://theirs/', resolution: null }],
        [],
      );

      expect(split.local).toEqual([]);
      expect(split.remote).toEqual([]);
    });
  });

  describe('apply', () => {
    it('adds pulled mappings locally, marked with the backend they came from', async () => {
      seed([]);
      getBackendPrefixes.mockResolvedValue({
        mappings: [{ prefix: 'ex', namespace: 'http://example.org/' }],
        source: 'jena-prefixes',
        readOnly: false,
        endpoint: 'x',
      });
      const { usePrefixSync, usePrefixManager } = await load();
      const sync = usePrefixSync();
      const manager = usePrefixManager();

      await sync.loadRemote(BACKEND);
      sync.buildPlan(BACKEND, 'pull');
      const outcome = await sync.apply();

      expect(outcome).toMatchObject({ localAdded: 1, pushed: 0 });
      const added = manager.prefixSettings.value.mappings.find((entry) => entry.prefix === 'ex');
      expect(added).toMatchObject({ source: 'endpoint', syncedWith: BACKEND, namespace: 'http://example.org/' });
    });

    it('sends one batch for the push half and reports what was refused', async () => {
      seed([mapping('ours', 'http://ours/')]);
      pushBackendPrefixes.mockResolvedValue({
        results: [{ prefix: 'ours', action: 'upsert', status: 'failed', error: 'HTTP 400' }],
        applied: 0,
        failed: 1,
      });
      const { usePrefixSync } = await load();
      const sync = usePrefixSync();

      await sync.loadRemote(BACKEND);
      sync.buildPlan(BACKEND, 'push');
      const outcome = await sync.apply();

      expect(pushBackendPrefixes).toHaveBeenCalledTimes(1);
      expect(outcome).toMatchObject({ pushed: 0, pushFailed: 1 });
      expect(outcome?.failures).toEqual([{ prefix: 'ours', error: 'HTTP 400' }]);
    });

    it('records the store\'s post-sync state as the next baseline, not what we sent', async () => {
      seed([mapping('ours', 'http://ours/')]);
      getBackendPrefixes
        .mockResolvedValueOnce({ mappings: [], source: 'jena-prefixes', readOnly: false, endpoint: 'x' })
        // The push half-lands: the store ends up with only what it accepted.
        .mockResolvedValueOnce({
          mappings: [{ prefix: 'ours', namespace: 'http://ours/' }],
          source: 'jena-prefixes',
          readOnly: false,
          endpoint: 'x',
        });
      pushBackendPrefixes.mockResolvedValue({
        results: [{ prefix: 'ours', action: 'upsert', status: 'ok' }],
        applied: 1,
        failed: 0,
      });
      const { usePrefixSync, readBaseline } = await load();
      const sync = usePrefixSync();

      await sync.loadRemote(BACKEND);
      sync.buildPlan(BACKEND, 'push');
      await sync.apply();

      expect(getBackendPrefixes).toHaveBeenCalledTimes(2);
      expect(readBaseline(BACKEND)?.pairs).toEqual({ ours: 'http://ours/' });
    });

    it('refuses to run a plan with an unresolved conflict', async () => {
      seed([mapping('ex', 'http://ours/')]);
      getBackendPrefixes.mockResolvedValue({
        mappings: [{ prefix: 'ex', namespace: 'http://theirs/' }],
        source: 'jena-prefixes',
        readOnly: false,
        endpoint: 'x',
      });
      const { usePrefixSync } = await load();
      const sync = usePrefixSync();

      await sync.loadRemote(BACKEND);
      sync.buildPlan(BACKEND, 'bidirectional');

      expect(await sync.apply()).toBeNull();
      expect(pushBackendPrefixes).not.toHaveBeenCalled();

      sync.setResolution('ex', 'remote');
      expect(await sync.apply()).toMatchObject({ localUpdated: 1 });
    });

    it('surfaces a failed read rather than planning against nothing', async () => {
      getBackendPrefixes.mockRejectedValue(new Error('502: no prefix map'));
      const { usePrefixSync } = await load();
      const sync = usePrefixSync();

      expect(await sync.loadRemote(BACKEND)).toBeNull();
      expect(sync.error.value).toContain('502');
      expect(sync.buildPlan(BACKEND, 'pull')).toBeNull();
    });
  });
});
