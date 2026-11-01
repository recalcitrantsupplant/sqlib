import { createEntityUtilsWithFields } from './EntityUtils.js';
import { TestRunCaseSchema, type PersistedTestRunCase } from '../schemas/TestRunCaseSchema.js';

const TestRunCaseUtils = createEntityUtilsWithFields<PersistedTestRunCase>(
  TestRunCaseSchema,
  'TestRunCase'
);

export const TestRunCases = TestRunCaseUtils.Repository;
export const deleteTestRunCase = TestRunCaseUtils.delete;
export const findAllTestRunCases = TestRunCaseUtils.findAll;
