import { ref, watch, type Ref } from 'vue';
import { useDebounceFn } from '@vueuse/core';
import type { DetectInputsResponse } from '@sparql-query-lib/contracts';

export type ValidationState = 'idle' | 'validating' | 'valid' | 'error';

// Shape of the error objects surfaced by the API client (ofetch-style).
type ApiErrorLike = {
  data?: { error?: string };
  statusMessage?: string;
  message?: string;
};

type ApiClientLike = {
  validateQuery: (query: string) => Promise<unknown>;
  detectInputs: (query: string) => Promise<DetectInputsResponse>;
  detectOutputs: (query: string) => Promise<string[]>;
};

export interface UseQueryValidationDeps {
  apiClient: ApiClientLike;
  queryCode: Ref<string>;
}

export function useQueryValidation(deps: UseQueryValidationDeps) {
  const validationState = ref<ValidationState>('idle');
  const validationError = ref<string | null>(null);
  const detectedInputs = ref<DetectInputsResponse | null>(null);
  const detectedOutputs = ref<string[]>([]);

  // Preserve last successful detections so UI doesn't flicker on transient errors
  const lastValidInputs = ref<DetectInputsResponse | null>(null);
  const lastValidOutputs = ref<string[]>([]);

  const validateSparqlQuery = async (query: string) => {
    if (!query || query.trim().length === 0) {
      validationState.value = 'idle';
      validationError.value = null;
      detectedInputs.value = null;
      detectedOutputs.value = [];
      lastValidInputs.value = null;
      lastValidOutputs.value = [];
      return;
    }

    validationState.value = 'validating';
    validationError.value = null;

    try {
      await deps.apiClient.validateQuery(query);
    } catch (error: unknown) {
      console.error('[useQueryValidation] SPARQL validation failed:', error);
      const err = error as ApiErrorLike | null | undefined;
      const message =
        err?.data?.error ||
        err?.statusMessage ||
        err?.message ||
        'Invalid SPARQL query';
      validationState.value = 'error';
      validationError.value = message;
      // Keep last known inputs/outputs so UI can still render them
      return;
    }

    try {
      const inputsResult = await deps.apiClient.detectInputs(query);
      detectedInputs.value = inputsResult;
      lastValidInputs.value = inputsResult;
    } catch (inputsError: unknown) {
      console.error('[useQueryValidation] detect-inputs failed:', inputsError);
      detectedInputs.value = lastValidInputs.value;
    }

    try {
      const outputsResult = await deps.apiClient.detectOutputs(query);
      detectedOutputs.value = outputsResult;
      lastValidOutputs.value = outputsResult;
    } catch (outputsError: unknown) {
      console.error('[useQueryValidation] detect-outputs failed:', outputsError);
      detectedOutputs.value = lastValidOutputs.value;
    }

    validationState.value = 'valid';
    validationError.value = null;
  };

  const debouncedValidation = useDebounceFn(validateSparqlQuery, 500);

  watch(deps.queryCode, (newQuery) => {
    debouncedValidation(newQuery);
  });

  return {
    validationState,
    validationError,
    detectedInputs,
    detectedOutputs,
    validateSparqlQuery,
    debouncedValidation,
  };
}
