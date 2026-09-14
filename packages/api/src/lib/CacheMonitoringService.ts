import { metrics } from '@opentelemetry/api';
import { getCacheCoordinator } from './CacheCoordinatorProvider.js';
import { oxigraphStoreManager } from './OxigraphStoreManager.js';

export class CacheMonitoringService {
  private meter = metrics.getMeter('sparql-query-lib-cache', '1.0.0');
  private monitoringInterval?: NodeJS.Timeout;

  // Metric instruments
  private totalEntitiesGauge = this.meter.createGauge('cache_total_entities', {
    description: 'Total number of entities in cache'
  });

  private memoryUsageGauge = this.meter.createGauge('cache_memory_bytes', {
    description: 'Estimated memory usage of cache in bytes'
  });

  private entityTypeGauge = this.meter.createGauge('cache_entities_by_type', {
    description: 'Number of entities by type in cache'
  });

  private entityTypeMemoryGauge = this.meter.createGauge('cache_memory_by_type_bytes', {
    description: 'Memory usage by entity type in bytes'
  });

  // Oxigraph store metrics
  private oxigraphStoreCountGauge = this.meter.createGauge('oxigraph_store_count', {
    description: 'Number of active Oxigraph stores'
  });

  private oxigraphMemoryGauge = this.meter.createGauge('oxigraph_memory_bytes', {
    description: 'Memory usage of Oxigraph stores in bytes'
  });

  private oxigraphTriplesGauge = this.meter.createGauge('oxigraph_triples', {
    description: 'Number of triples in Oxigraph stores'
  });

  /**
   * Start periodic cache monitoring
   * @param intervalMs Monitoring interval in milliseconds (default: 30 seconds)
   */
  start(intervalMs: number = 30_000): void {
    if (this.monitoringInterval) {
      console.log('Cache monitoring already running');
      return;
    }

    console.log(`Starting cache monitoring with ${intervalMs}ms interval`);

    // Initial collection
    this.collectMetrics();

    // Set up periodic collection
    this.monitoringInterval = setInterval(() => {
      this.collectMetrics();
    }, intervalMs);
  }

  /**
   * Stop periodic cache monitoring
   */
  stop(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
      console.log('Cache monitoring stopped');
    }
  }

  /**
   * Collect and record cache metrics
   */
  collectMetrics(): void {
    const cacheCoordinator = getCacheCoordinator();
    if (!cacheCoordinator.isReady()) {
      return;
    }

    const stats = cacheCoordinator.getStats();

    // Record total entities
    this.totalEntitiesGauge.record(stats.totalEntities);

    // Record total memory usage
    this.memoryUsageGauge.record(stats.estimatedMemoryBytes);

    // Record per-type metrics
    Object.entries(stats.entityTypes).forEach(([type, typeStats]) => {
      const typeAttributes = { entity_type: type };

      this.entityTypeGauge.record(typeStats.count, typeAttributes);
      this.entityTypeMemoryGauge.record(typeStats.memoryBytes, typeAttributes);
    });

    // Collect Oxigraph store metrics
    this.collectOxigraphMetrics();

    // Log summary for debugging
    const memoryMB = (stats.estimatedMemoryBytes / (1024 * 1024)).toFixed(2);
    console.log(`[Cache Metrics] ${stats.totalEntities} entities, ~${memoryMB}MB memory`);
  }

  /**
   * Collect Oxigraph store metrics
   */
  private collectOxigraphMetrics(): void {
    const allStoreStats = oxigraphStoreManager.getAllStoreStats();

    let totalStores = 0;
    let totalMemory = 0;
    let totalTriples = 0;

    allStoreStats.forEach((stats, storeId) => {
      totalStores++;
      totalMemory += stats.memoryUsage;
      totalTriples += stats.tripleCount;

      // Record per-store metrics with store ID as attribute
      const storeAttributes = { store_id: storeId };
      this.oxigraphMemoryGauge.record(stats.memoryUsage, storeAttributes);
      this.oxigraphTriplesGauge.record(stats.tripleCount, storeAttributes);
    });

    // Record aggregate metrics
    this.oxigraphStoreCountGauge.record(totalStores);

    // Log Oxigraph summary
    if (totalStores > 0) {
      const oxMemoryMB = (totalMemory / (1024 * 1024)).toFixed(2);
      console.log(`[Oxigraph Metrics] ${totalStores} stores, ${totalTriples} triples, ~${oxMemoryMB}MB memory`);
    }
  }

  /**
   * Get current cache statistics (synchronous)
   */
  getCurrentStats() {
    return {
      cache: getCacheCoordinator().getStats(),
      oxigraph: {
        stores: oxigraphStoreManager.getAllStoreStats(),
        summary: this.getOxigraphSummary()
      }
    };
  }

  /**
   * Get summary of Oxigraph store statistics
   */
  private getOxigraphSummary() {
    const allStoreStats = oxigraphStoreManager.getAllStoreStats();
    let totalMemory = 0;
    let totalTriples = 0;

    allStoreStats.forEach(stats => {
      totalMemory += stats.memoryUsage;
      totalTriples += stats.tripleCount;
    });

    return {
      totalStores: allStoreStats.size,
      totalMemoryBytes: totalMemory,
      totalTriples: totalTriples
    };
  }
}

// Singleton instance
export const cacheMonitoringService = new CacheMonitoringService();
