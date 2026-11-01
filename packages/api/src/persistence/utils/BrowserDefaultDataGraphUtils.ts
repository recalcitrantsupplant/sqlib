import { createEntityUtilsWithFields } from './EntityUtils.js';
import { BrowserDefaultDataGraphSchema, type PersistedBrowserDefaultDataGraph } from '../schemas/BrowserDefaultDataGraphSchema.js';

const BrowserDefaultDataGraphUtils = createEntityUtilsWithFields<PersistedBrowserDefaultDataGraph>(
  BrowserDefaultDataGraphSchema,
  'BrowserDefaultDataGraph',
);

export const BrowserDefaultDataGraphs = BrowserDefaultDataGraphUtils.Repository;
