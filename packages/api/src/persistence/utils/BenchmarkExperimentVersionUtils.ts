import { createEntityUtilsWithFields } from './EntityUtils.js';
import { BenchmarkExperimentVersionSchema, type PersistedBenchmarkExperimentVersion } from '../schemas/BenchmarkExperimentVersionSchema.js';

const BenchmarkExperimentVersionUtils = createEntityUtilsWithFields<PersistedBenchmarkExperimentVersion>(
  BenchmarkExperimentVersionSchema,
  'BenchmarkExperimentVersion'
);

export const BenchmarkExperimentVersions = BenchmarkExperimentVersionUtils.Repository;
export const createBenchmarkExperimentVersion = BenchmarkExperimentVersionUtils.create;
export const updateBenchmarkExperimentVersion = BenchmarkExperimentVersionUtils.update;
export const deleteBenchmarkExperimentVersion = BenchmarkExperimentVersionUtils.delete;
export const findAllBenchmarkExperimentVersions = BenchmarkExperimentVersionUtils.findAll;
export const findBenchmarkExperimentVersionById = BenchmarkExperimentVersionUtils.findById;
