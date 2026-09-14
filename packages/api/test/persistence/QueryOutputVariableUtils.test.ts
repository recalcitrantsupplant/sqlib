
import { vi } from 'vitest';
import { findQueryOutputVariableById, loadQueryOutputVariablesByIds } from '../../src/persistence/utils/QueryOutputVariableUtils.js';

// In-memory LDKit lens for this suite
vi.mock('../../src/persistence/utils/entityRepository', () => {
  const store = new Map<string, any>();
  const lens = {
    insert: async (obj: any) => { const id = obj.$id ?? obj['@id']; const norm = { ...obj, '@id': id, $id: id }; store.set(id, norm); return norm; },
    findByIri: async (id: string) => store.get(id) ?? null,
    find: async () => Array.from(store.values()),
    update: async (obj: any) => { const id = obj.$id ?? obj['@id']; const ex = store.get(id) ?? { $id: id, '@id': id }; const merged = { ...ex, ...obj, '@id': id, $id: id }; store.set(id, merged); return merged; },
    delete: async (id: string) => { store.delete(id); },
    _store: store,
  };
  return { createRepositoryLens: () => lens };
});

describe('QueryOutputUtils', () => {
  const testOutputId1 = 'http://example.org/test-output-1';
  const testOutputId2 = 'http://example.org/test-output-2';

  beforeEach(async () => {
    const { QueryOutputVariables } = await import('../../src/persistence/utils/QueryOutputVariableUtils.js');
    (QueryOutputVariables as any)._store.clear();
  });

  it('should find a query output by ID', async () => {
    const { QueryOutputVariables } = await import('../../src/persistence/utils/QueryOutputVariableUtils.js');
    await QueryOutputVariables.insert({ $id: testOutputId1, variableName: 'test_output' });
    const found = await findQueryOutputVariableById(testOutputId1);
    expect(found).toBeDefined();
    expect(found!.variableName).toBe('test_output');
  });

  it('should load multiple query outputs by IDs', async () => {
    const { QueryOutputVariables } = await import('../../src/persistence/utils/QueryOutputVariableUtils.js');
    await QueryOutputVariables.insert({ $id: testOutputId1, variableName: 'test_output_1' });
    await QueryOutputVariables.insert({ $id: testOutputId2, variableName: 'test_output_2' });

    const outputs = await loadQueryOutputVariablesByIds([testOutputId1, testOutputId2]);
    expect(outputs.length).toBe(2);
  });
});
