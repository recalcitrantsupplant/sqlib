import { describe, it, beforeEach, expect, vi } from 'vitest';
import { Readable } from 'node:stream';
import { QueryTypeIri } from '../../../src/constants/queryTypes.js';
import { SystemQueryRunner } from '../../../src/lib/system-queries/SystemQueryRunner.js';

const catalogMock = vi.hoisted(() => ({
  getDefinition: vi.fn(),
}));

const parserInstance = vi.hoisted(() => ({
  applyArguments: vi.fn(),
  applyLimitOffsetParameters: vi.fn(),
}));

const executorFactoryInstance = vi.hoisted(() => ({
  getExecutorForNode: vi.fn(),
}));

vi.mock('../../../src/lib/system-queries/SystemQueryCatalog.js', () => ({
  SystemQueryCatalog: catalogMock,
}));

vi.mock('../../../src/lib/parser.js', () => ({
  SparqlQueryParser: vi.fn(function () {
    return parserInstance;
  }),
}));

vi.mock('../../../src/lib/orchestration/ExecutorFactory.js', () => ({
  ExecutorFactory: vi.fn(function () {
    return executorFactoryInstance;
  }),
}));

const cacheCoordinatorMock = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock('../../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => ({
    get: cacheCoordinatorMock.get,
  }),
}));

describe('SystemQueryRunner', () => {
  let runner: SystemQueryRunner;

  beforeEach(() => {
    runner = new SystemQueryRunner();
    catalogMock.getDefinition.mockReset();
    parserInstance.applyArguments.mockReset();
    parserInstance.applyLimitOffsetParameters.mockImplementation((_query) => _query);
    executorFactoryInstance.getExecutorForNode.mockReset();
    (cacheCoordinatorMock.get as any).mockReset();
  });

  it('streams graph queries using executor', async () => {
    const queryEntity = { $id: 'urn:query', currentVersion: 'urn:version' };
    const versionEntity = { $id: 'urn:version', queryString: 'CONSTRUCT {}', queryType: QueryTypeIri.construct };

    catalogMock.getDefinition.mockReturnValue({
      key: 'libraryDescribe',
      queryId: 'urn:query',
      versionId: 'urn:version',
      name: 'System Query',
      description: 'desc',
    });
    (cacheCoordinatorMock.get as any).mockImplementation((id: string) => {
      if (id === 'urn:query') return queryEntity;
      if (id === 'urn:version') return versionEntity;
      return null;
    });
    parserInstance.applyArguments.mockReturnValue('CONSTRUCT {}');

    const streamResponse = {
      statusCode: 200,
      headers: { 'content-type': 'text/turtle' },
      body: Readable.from(['<rdf>']),
    };
    const executor = {
      constructQueryStream: vi.fn().mockResolvedValue(streamResponse),
    };
    executorFactoryInstance.getExecutorForNode.mockResolvedValue(executor);

    const result = await runner.execute('libraryDescribe', {
      acceptHeader: 'text/turtle',
      parameterBindings: [
        {
          vars: ['library'],
          bindings: [{ library: { type: 'uri', value: 'urn:lib' } }],
        },
      ],
    });

    expect(parserInstance.applyArguments).toHaveBeenCalledWith(
      'CONSTRUCT {}',
      expect.arrayContaining([
        expect.objectContaining({
          head: { vars: ['library'] },
        }),
      ])
    );
    expect(executor.constructQueryStream).toHaveBeenCalledWith('CONSTRUCT {}', { acceptHeader: 'text/turtle' });
    expect(result.mode).toBe('stream');
    expect(result.stream).toBe(streamResponse);
  });

  it('throws when query definition not loaded', async () => {
    catalogMock.getDefinition.mockReturnValue({
      key: 'libraryCollection',
      queryId: 'urn:missing',
      versionId: 'urn:version',
      name: 'Missing',
      description: 'desc',
    });
    (cacheCoordinatorMock.get as any).mockReturnValue(null);

    await expect(runner.execute('libraryCollection')).rejects.toThrow('System query not loaded in cache');
  });
});
