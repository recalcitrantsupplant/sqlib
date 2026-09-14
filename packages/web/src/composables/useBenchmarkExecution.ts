import { ref } from 'vue';
import type { BenchmarkRunResponse } from '@sparql-query-lib/contracts';
import { useApiClient } from './useApiClient.js';
import { toast } from 'vue-sonner';

export function useBenchmarkExecution() {
  const apiClient = useApiClient();

  const isExecuting = ref(false);
  const executionProgress = ref<{ total: number; completed: number } | null>(null);
  const latestRun = ref<BenchmarkRunResponse | null>(null);

  const executeRun = async (experimentId: string, version: number) => {
    isExecuting.value = true;
    executionProgress.value = null;
    latestRun.value = null;

    try {
      const response = await apiClient.executeBenchmarkRun(experimentId, version);
      latestRun.value = response;

      // Extract progress from response
      if (response.run) {
        executionProgress.value = {
          total: response.run.tasksTotal,
          completed: response.run.tasksCompleted,
        };
      }

      toast.success(`Benchmark run started: ${response.run.runStatus}`);
      return response;
    } catch (error: any) {
      console.error('[useBenchmarkExecution] Failed to execute benchmark run:', error);
      toast.error(error?.message ?? 'Failed to execute benchmark run');
      throw error;
    } finally {
      isExecuting.value = false;
    }
  };

  return {
    isExecuting,
    executionProgress,
    latestRun,
    executeRun,
  };
}
