import { createEntityUtilsWithFields } from './EntityUtils.js';
import { EnvironmentSchema, type PersistedEnvironment } from '../schemas/EnvironmentSchema.js';

const EnvironmentUtils = createEntityUtilsWithFields<PersistedEnvironment>(
  EnvironmentSchema,
  'Environment'
);

export const Environments = EnvironmentUtils.Repository;
