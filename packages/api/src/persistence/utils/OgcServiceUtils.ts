import { createEntityUtilsWithFields } from './EntityUtils.js';
import { OgcServiceSchema, type PersistedOgcService } from '../schemas/OgcServiceSchema.js';
import { OgcServiceVersionSchema, type PersistedOgcServiceVersion } from '../schemas/OgcServiceVersionSchema.js';

const OgcServiceUtils = createEntityUtilsWithFields<PersistedOgcService>(
  OgcServiceSchema,
  'OgcService'
);

export const OgcServices = OgcServiceUtils.Repository;

const OgcServiceVersionUtils = createEntityUtilsWithFields<PersistedOgcServiceVersion>(
  OgcServiceVersionSchema,
  'OgcServiceVersion'
);

export const OgcServiceVersions = OgcServiceVersionUtils.Repository;
