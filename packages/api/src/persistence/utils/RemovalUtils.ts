import { createEntityUtilsWithFields } from './EntityUtils.js';
import { RemovalSchema, type PersistedRemoval } from '../schemas/RemovalSchema.js';

const RemovalUtils = createEntityUtilsWithFields<PersistedRemoval>(RemovalSchema, 'Removal');

export const Removals = RemovalUtils.Repository;
