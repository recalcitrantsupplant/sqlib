import { createEntityUtilsWithFields } from './EntityUtils.js';
import { BenchmarkRunSchema, type BenchmarkRunEntity } from '../schemas/BenchmarkRunSchema.js';

const BenchmarkRunUtils = createEntityUtilsWithFields<BenchmarkRunEntity>(
  BenchmarkRunSchema,
  'BenchmarkRun'
);

export const BenchmarkRuns = BenchmarkRunUtils.Repository;
export const createBenchmarkRun = BenchmarkRunUtils.create;
export const updateBenchmarkRun = BenchmarkRunUtils.update;
export const deleteBenchmarkRun = BenchmarkRunUtils.delete;
export const findAllBenchmarkRuns = BenchmarkRunUtils.findAll;
export const findBenchmarkRunById = BenchmarkRunUtils.findById;
