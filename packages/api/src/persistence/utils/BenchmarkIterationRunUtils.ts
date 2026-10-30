import { createEntityUtilsWithFields } from './EntityUtils.js';
import { BenchmarkIterationRunSchema, type PersistedBenchmarkIterationRun } from '../schemas/BenchmarkIterationRunSchema.js';

const BenchmarkIterationRunUtils = createEntityUtilsWithFields<PersistedBenchmarkIterationRun>(
  BenchmarkIterationRunSchema,
  'BenchmarkIterationRun'
);

export const BenchmarkIterationRuns = BenchmarkIterationRunUtils.Repository;
export const createBenchmarkIterationRun = BenchmarkIterationRunUtils.create;
export const updateBenchmarkIterationRun = BenchmarkIterationRunUtils.update;
export const deleteBenchmarkIterationRun = BenchmarkIterationRunUtils.delete;
export const findAllBenchmarkIterationRuns = BenchmarkIterationRunUtils.findAll;
export const findBenchmarkIterationRunById = BenchmarkIterationRunUtils.findById;
