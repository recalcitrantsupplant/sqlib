import { createEntityUtilsWithFields } from './EntityUtils.js';
import { BenchmarkNodeObservationSchema, type LdkitBenchmarkNodeObservation } from '../schemas/BenchmarkNodeObservationSchema.js';

const BenchmarkNodeObservationUtils = createEntityUtilsWithFields<LdkitBenchmarkNodeObservation>(
  BenchmarkNodeObservationSchema,
  'BenchmarkNodeObservation'
);

export const BenchmarkNodeObservations = BenchmarkNodeObservationUtils.Repository;
export const createBenchmarkNodeObservation = BenchmarkNodeObservationUtils.create;
export const updateBenchmarkNodeObservation = BenchmarkNodeObservationUtils.update;
export const deleteBenchmarkNodeObservation = BenchmarkNodeObservationUtils.delete;
export const findAllBenchmarkNodeObservations = BenchmarkNodeObservationUtils.findAll;
export const findBenchmarkNodeObservationById = BenchmarkNodeObservationUtils.findById;
