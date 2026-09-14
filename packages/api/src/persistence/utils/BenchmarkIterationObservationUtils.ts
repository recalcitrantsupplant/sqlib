import { createEntityUtilsWithFields } from './EntityUtils.js';
import { BenchmarkIterationObservationSchema, type LdkitBenchmarkIterationObservation } from '../schemas/BenchmarkIterationObservationSchema.js';

const BenchmarkIterationObservationUtils = createEntityUtilsWithFields<LdkitBenchmarkIterationObservation>(
  BenchmarkIterationObservationSchema,
  'BenchmarkIterationObservation'
);

export const BenchmarkIterationObservations = BenchmarkIterationObservationUtils.Repository;
export const createBenchmarkIterationObservation = BenchmarkIterationObservationUtils.create;
export const updateBenchmarkIterationObservation = BenchmarkIterationObservationUtils.update;
export const deleteBenchmarkIterationObservation = BenchmarkIterationObservationUtils.delete;
export const findAllBenchmarkIterationObservations = BenchmarkIterationObservationUtils.findAll;
export const findBenchmarkIterationObservationById = BenchmarkIterationObservationUtils.findById;
