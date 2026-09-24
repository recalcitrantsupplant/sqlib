
import { findQueryInputVariableById, loadQueryInputVariablesByIds } from '../../src/persistence/utils/QueryInputVariableUtils.js';
import { overrideRepositoryLenses } from '../../src/persistence/utils/entityRepository.js';

// In-memory LDKit lens for this suite
const repositoryLens = (() => {
  const store = new Map<string, any>();
  const lens = {
    insert: async (obj: any) => { const id = obj.$id ?? obj['@id']; const norm = { ...obj, '@id': id, $id: id }; store.set(id, norm); return norm; },
    findByIri: async (id: string) => store.get(id) ?? null,
    find: async () => Array.from(store.values()),
    update: async (obj: any) => { const id = obj.$id ?? obj['@id']; const ex = store.get(id) ?? { $id: id, '@id': id }; const merged = { ...ex, ...obj, '@id': id, $id: id }; store.set(id, merged); return merged; },
    delete: async (id: string) => { store.delete(id); },
    _store: store,
  };
  return lens;
})();
overrideRepositoryLenses(() => repositoryLens);

describe('QueryInputUtils', () => {
  const testInputId1 = 'http://example.org/test-input-1';
  const testInputId2 = 'http://example.org/test-input-2';

  beforeEach(async () => {
    const { QueryInputVariables } = await import('../../src/persistence/utils/QueryInputVariableUtils.js');
    repositoryLens._store.clear();
  });

  it('should find a query input by ID', async () => {
    const { QueryInputVariables } = await import('../../src/persistence/utils/QueryInputVariableUtils.js');
    await QueryInputVariables.insert({ $id: testInputId1, variableName: 'test_input' });
    const found = await findQueryInputVariableById(testInputId1);
    expect(found).toBeDefined();
    expect(found!.variableName).toBe('test_input');
  });

  it('should load multiple query inputs by IDs', async () => {
    const { QueryInputVariables } = await import('../../src/persistence/utils/QueryInputVariableUtils.js');
    await QueryInputVariables.insert({ $id: testInputId1, variableName: 'test_input_1' });
    await QueryInputVariables.insert({ $id: testInputId2, variableName: 'test_input_2' });

    const inputs = await loadQueryInputVariablesByIds([testInputId1, testInputId2]);
    expect(inputs.length).toBe(2);
  });
});
