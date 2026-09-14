import { createEntityUtilsWithFields } from './EntityUtils.js';
import { BenchmarkRunSchema, type LdkitBenchmarkRun } from '../schemas/BenchmarkRunSchema.js';

const BenchmarkRunUtils = createEntityUtilsWithFields<LdkitBenchmarkRun>(
  BenchmarkRunSchema,
  'BenchmarkRun'
);

export const BenchmarkRuns = BenchmarkRunUtils.Repository;
export const createBenchmarkRun = BenchmarkRunUtils.create;
export const updateBenchmarkRun = BenchmarkRunUtils.update;
export const deleteBenchmarkRun = BenchmarkRunUtils.delete;
export const findAllBenchmarkRuns = BenchmarkRunUtils.findAll;
export const findBenchmarkRunById = BenchmarkRunUtils.findById;
