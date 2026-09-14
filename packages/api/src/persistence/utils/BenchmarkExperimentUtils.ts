import { createEntityUtilsWithFields } from './EntityUtils.js';
import { BenchmarkExperimentSchema, type LdkitBenchmarkExperiment } from '../schemas/BenchmarkExperimentSchema.js';

const BenchmarkExperimentUtils = createEntityUtilsWithFields<LdkitBenchmarkExperiment>(
  BenchmarkExperimentSchema,
  'BenchmarkExperiment'
);

export const BenchmarkExperiments = BenchmarkExperimentUtils.Repository;
export const createBenchmarkExperiment = BenchmarkExperimentUtils.create;
export const updateBenchmarkExperiment = BenchmarkExperimentUtils.update;
export const deleteBenchmarkExperiment = BenchmarkExperimentUtils.delete;
export const findAllBenchmarkExperiments = BenchmarkExperimentUtils.findAll;
export const findBenchmarkExperimentById = BenchmarkExperimentUtils.findById;
