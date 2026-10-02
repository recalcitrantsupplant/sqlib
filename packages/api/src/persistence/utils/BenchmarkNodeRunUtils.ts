import { createEntityUtilsWithFields } from './EntityUtils.js';
import { BenchmarkNodeRunSchema, type BenchmarkNodeRunEntity } from '../schemas/BenchmarkNodeRunSchema.js';

const BenchmarkNodeRunUtils = createEntityUtilsWithFields<BenchmarkNodeRunEntity>(
  BenchmarkNodeRunSchema,
  'BenchmarkNodeRun'
);

export const BenchmarkNodeRuns = BenchmarkNodeRunUtils.Repository;
export const createBenchmarkNodeRun = BenchmarkNodeRunUtils.create;
export const updateBenchmarkNodeRun = BenchmarkNodeRunUtils.update;
export const deleteBenchmarkNodeRun = BenchmarkNodeRunUtils.delete;
export const findAllBenchmarkNodeRuns = BenchmarkNodeRunUtils.findAll;
export const findBenchmarkNodeRunById = BenchmarkNodeRunUtils.findById;
