import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CacheMonitoringService } from '../../src/lib/CacheMonitoringService.js';
import { getCacheCoordinator } from '../../src/lib/CacheCoordinatorProvider.js';
import { oxigraphStoreManager } from '../../src/lib/OxigraphStoreManager.js';
import { log } from '../../src/lib/log.js';

// Mock the dependencies
vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: vi.fn(),
}));

vi.mock('../../src/lib/OxigraphStoreManager.js', () => ({
  oxigraphStoreManager: {
    getPersistentStore: vi.fn(() => null),
    createPersistentStore: vi.fn(async () => ({ store: true })),
    getAllStoreStats: vi.fn(),
  }
}));

// Mock OpenTelemetry
vi.mock('@opentelemetry/api', () => ({
  metrics: {
    getMeter: vi.fn(() => ({
      createGauge: vi.fn(() => ({
        record: vi.fn(),
      })),
    })),
  },
}));

describe('CacheMonitoringService', () => {
  let monitoringService: CacheMonitoringService;
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let debugSpy: ReturnType<typeof vi.spyOn>;
  let cacheCoordinatorMock: { isReady: any; getStats: any };

  beforeEach(() => {
    monitoringService = new CacheMonitoringService();
    infoSpy = vi.spyOn(log, 'info');
    debugSpy = vi.spyOn(log, 'debug');
    vi.clearAllMocks();
    cacheCoordinatorMock = {
      isReady: vi.fn(),
      getStats: vi.fn(),
    };
    (getCacheCoordinator as any).mockReturnValue(cacheCoordinatorMock);
  });

  afterEach(() => {
    monitoringService.stop();
    infoSpy.mockRestore();
    debugSpy.mockRestore();
  });

  describe('start and stop', () => {
    it('should start monitoring service', () => {
      monitoringService.start(1000);
      expect(infoSpy).toHaveBeenCalledWith({ intervalMs: 1000 }, 'Starting cache monitoring');
    });

    it('should not start multiple intervals', () => {
      monitoringService.start(1000);
      monitoringService.start(1000);
      expect(debugSpy).toHaveBeenCalledWith('Cache monitoring already running');
    });

    it('should stop monitoring service', () => {
      monitoringService.start(1000);
      monitoringService.stop();
      expect(infoSpy).toHaveBeenCalledWith('Cache monitoring stopped');
    });

    it('should handle stop when not running', () => {
      monitoringService.stop();
      // Should not throw any errors
    });
  });

  describe('collectMetrics', () => {
    it('should skip collection when cache not ready', () => {
      cacheCoordinatorMock.isReady.mockReturnValue(false);

      monitoringService.collectMetrics();

      expect(cacheCoordinatorMock.getStats).not.toHaveBeenCalled();
    });

    it('should collect cache metrics when ready', () => {
      const mockStats = {
        totalEntities: 10,
        estimatedMemoryBytes: 1024,
        entityTypes: {
          Backend: { count: 5, memoryBytes: 512 },
          Query: { count: 5, memoryBytes: 512 },
        }
      };

      cacheCoordinatorMock.isReady.mockReturnValue(true);
      cacheCoordinatorMock.getStats.mockReturnValue(mockStats);
      (oxigraphStoreManager.getAllStoreStats as any).mockReturnValue(new Map());

      monitoringService.collectMetrics();

      expect(cacheCoordinatorMock.getStats).toHaveBeenCalled();
      expect(debugSpy).toHaveBeenCalledWith({ entities: 10, memoryMB: '0.00' }, 'Cache metrics');
    });

    it('should collect Oxigraph metrics', () => {
      const mockCacheStats = {
        totalEntities: 5,
        estimatedMemoryBytes: 512,
        entityTypes: {}
      };

      const mockStoreStats = new Map([
        ['store1', { tripleCount: 100, memoryUsage: 2048, createdAt: new Date(), lastAccessed: new Date() }],
        ['store2', { tripleCount: 200, memoryUsage: 4096, createdAt: new Date(), lastAccessed: new Date() }],
      ]);

      cacheCoordinatorMock.isReady.mockReturnValue(true);
      cacheCoordinatorMock.getStats.mockReturnValue(mockCacheStats);
      (oxigraphStoreManager.getAllStoreStats as any).mockReturnValue(mockStoreStats);

      monitoringService.collectMetrics();

      expect(oxigraphStoreManager.getAllStoreStats).toHaveBeenCalled();
      expect(debugSpy).toHaveBeenCalledWith({ stores: 2, triples: 300, memoryMB: '0.01' }, 'Oxigraph metrics');
    });
  });

  describe('getCurrentStats', () => {
    it('should return comprehensive stats', () => {
      const mockCacheStats = {
        totalEntities: 10,
        estimatedMemoryBytes: 1024,
        entityTypes: {
          Backend: { count: 5, memoryBytes: 512 }
        }
      };

      const mockStoreStats = new Map([
        ['store1', { tripleCount: 100, memoryUsage: 2048, createdAt: new Date(), lastAccessed: new Date() }],
      ]);

      cacheCoordinatorMock.getStats.mockReturnValue(mockCacheStats);
      (oxigraphStoreManager.getAllStoreStats as any).mockReturnValue(mockStoreStats);

      const stats = monitoringService.getCurrentStats();

      expect(stats).toEqual({
        cache: mockCacheStats,
        oxigraph: {
          stores: mockStoreStats,
          summary: {
            totalStores: 1,
            totalMemoryBytes: 2048,
            totalTriples: 100
          }
        }
      });
    });

    it('should handle empty Oxigraph stores', () => {
      const mockCacheStats = {
        totalEntities: 5,
        estimatedMemoryBytes: 512,
        entityTypes: {}
      };

      cacheCoordinatorMock.getStats.mockReturnValue(mockCacheStats);
      (oxigraphStoreManager.getAllStoreStats as any).mockReturnValue(new Map());

      const stats = monitoringService.getCurrentStats();

      expect(stats.oxigraph.summary).toEqual({
        totalStores: 0,
        totalMemoryBytes: 0,
        totalTriples: 0
      });
    });
  });

  describe('periodic monitoring', () => {
    it('should collect metrics periodically', async () => {
      const mockStats = {
        totalEntities: 5,
        estimatedMemoryBytes: 512,
        entityTypes: {}
      };

      cacheCoordinatorMock.isReady.mockReturnValue(true);
      cacheCoordinatorMock.getStats.mockReturnValue(mockStats);
      (oxigraphStoreManager.getAllStoreStats as any).mockReturnValue(new Map());

      monitoringService.start(50); // 50ms interval for quick test

      // Wait for at least 2 collection cycles
      await new Promise(resolve => setTimeout(resolve, 120));

      expect(cacheCoordinatorMock.getStats).toHaveBeenCalledTimes(3); // Initial + 2 periodic

      monitoringService.stop();
    });
  });
});
