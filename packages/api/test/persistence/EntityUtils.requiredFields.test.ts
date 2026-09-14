/**
 * The create-time required-field check derives from the entity schema.
 *
 * `createEntityUtils` reads `@optional` off the schema rather than being handed
 * a list, so these assert that the derivation matches what each schema declares
 * — a property losing or gaining `@optional` should show up here, and so should
 * a regression in the derivation itself.
 */

import { describe, it, expect, vi } from 'vitest';

// The required-field check runs before any store access, but the modules under
// test build a repository lens at import time.
vi.mock('../../src/persistence/utils/entityRepository', () => ({
  createRepositoryLens: () => ({
    insert: async () => undefined,
    findByIri: async () => null,
    find: async () => [],
    update: async () => undefined,
    delete: async () => undefined,
  }),
}));

describe('required fields derived from the entity schema', () => {
  it('requires Library.name, the only non-optional property in LibrarySchema', async () => {
    const { createLibrary } = await import('../../src/persistence/utils/LibraryUtils.js');

    await expect(createLibrary({ $id: 'urn:test:library' } as any))
      .rejects.toThrow('Library requires name');

    await expect(createLibrary({ $id: 'urn:test:library', name: 'Fine' } as any))
      .resolves.toBeUndefined();
  });

  it('requires both non-optional properties of RuleSetVersionSchema', async () => {
    const { createRuleSetVersion } = await import('../../src/persistence/utils/RuleSetVersionUtils.js');

    await expect(createRuleSetVersion({ $id: 'urn:test:rsv', version: '1' } as any))
      .rejects.toThrow('RuleSetVersion requires isPartOf and version');

    await expect(
      createRuleSetVersion({ $id: 'urn:test:rsv', isPartOf: 'urn:test:rs', version: '1' } as any)
    ).resolves.toBeUndefined();
  });

  it('lets Backend follow the schema, endpoint included', async () => {
    const { createBackend } = await import('../../src/persistence/utils/BackendUtils.js');

    // This used to reject: BackendUtils carried an explicit list requiring an
    // `endpoint` of every backend. `endpoint` is `@optional` in BackendSchema
    // because an oxigraphEphemeral backend has none, and the route contract
    // requires one only when `backendType` is `http` — so the override was the
    // one statement of three that disagreed with the other two (issue #65).
    // `createBackend` translates a backendType *key* to its IRI and stores the
    // IRI, so the payload carries the stored form.
    const { BackendTypeIri } = await import('../../src/persistence/schemas/BackendSchema.js');
    const base = { $id: 'urn:test:backend', name: 'B' } as Parameters<typeof createBackend>[0];

    await expect(
      createBackend({ ...base, backendType: BackendTypeIri.http })
    ).resolves.toBeUndefined();

    // `createBackend` narrows `backendType` before it builds the payload, and
    // does so synchronously — so this throw never becomes a rejected promise.
    expect(() => createBackend(base)).toThrow('Backend requires name and backendType');
  });
});
