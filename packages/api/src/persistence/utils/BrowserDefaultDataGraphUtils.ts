import { createEntityUtilsWithFields } from './EntityUtils.js';
import { BrowserDefaultDataGraphSchema, type LdkitBrowserDefaultDataGraph } from '../schemas/BrowserDefaultDataGraphSchema.js';

const BrowserDefaultDataGraphUtils = createEntityUtilsWithFields<LdkitBrowserDefaultDataGraph>(
  BrowserDefaultDataGraphSchema,
  'BrowserDefaultDataGraph',
);

export const BrowserDefaultDataGraphs = BrowserDefaultDataGraphUtils.Repository;
