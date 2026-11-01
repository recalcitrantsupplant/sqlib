import { createEntityUtilsWithFields } from './EntityUtils.js';
import { NotebookSchema, type PersistedNotebook } from '../schemas/NotebookSchema.js';
import { NotebookVersionSchema, type PersistedNotebookVersion } from '../schemas/NotebookVersionSchema.js';

const NotebookUtils = createEntityUtilsWithFields<PersistedNotebook>(
  NotebookSchema,
  'Notebook'
);

export const Notebooks = NotebookUtils.Repository;

const NotebookVersionUtils = createEntityUtilsWithFields<PersistedNotebookVersion>(
  NotebookVersionSchema,
  'NotebookVersion'
);

export const NotebookVersions = NotebookVersionUtils.Repository;
