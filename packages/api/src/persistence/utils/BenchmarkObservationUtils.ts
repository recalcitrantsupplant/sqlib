import { createEntityUtilsWithFields } from './EntityUtils.js';
import { BenchmarkObservationSchema, type BenchmarkObservationEntity } from '../schemas/BenchmarkObservationSchema.js';

const BenchmarkObservationUtils = createEntityUtilsWithFields<BenchmarkObservationEntity>(
  BenchmarkObservationSchema,
  'BenchmarkObservation'
);

export const BenchmarkObservations = BenchmarkObservationUtils.Repository;
export const createBenchmarkObservation = BenchmarkObservationUtils.create;
export const updateBenchmarkObservation = BenchmarkObservationUtils.update;
export const deleteBenchmarkObservation = BenchmarkObservationUtils.delete;
export const findAllBenchmarkObservations = BenchmarkObservationUtils.findAll;
export const findBenchmarkObservationById = BenchmarkObservationUtils.findById;
