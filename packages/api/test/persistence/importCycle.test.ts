/**
 * The persistence import graph, held to what lets `EntityStore` import
 * `ExecutorFactory` statically.
 *
 * `EntityStore` -> `ExecutorFactory` -> the cache -> `adapterRegistry` ->
 * `SelfHostedAdapter` -> `EntityStore` is a cycle, and it is only safe while no
 * module on it reads an imported binding as it evaluates. These pin the two
 * ways that broke before: a registry module that pulled every repository in at
 * load, and an adapter registry that copied the adapter at load.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

describe('persistence import graph', () => {
  it('EntityRegistry imports nothing at runtime', () => {
    const source = readFileSync(fileURLToPath(new URL('../../src/lib/EntityRegistry.ts', import.meta.url)), 'utf8');
    const imports = source.split('\n').filter((line) => /^import\s/.test(line));

    expect(imports.length).toBeGreaterThan(0);
    expect(imports.filter((line) => !/^import type\s/.test(line))).toEqual([]);
  });

  it.each([
    ['SelfHostedAdapter', '../../src/persistence/SelfHostedAdapter.js'],
    ['EntityStore', '../../src/persistence/EntityStore.js'],
    ['ExecutorFactory', '../../src/lib/orchestration/ExecutorFactory.js'],
    ['CacheCoordinator', '../../src/lib/CacheCoordinator.js'],
  ])('loads with %s as the entry point', async (_name, entry) => {
    vi.resetModules();
    await import(entry);
    const { getPersistenceAdapter } = await import('../../src/persistence/adapterRegistry.js');
    const { selfHostedAdapter } = await import('../../src/persistence/SelfHostedAdapter.js');

    expect(getPersistenceAdapter()).toBe(selfHostedAdapter);
  });
});
