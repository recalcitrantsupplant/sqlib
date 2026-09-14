import { createEntityUtilsWithFields } from './EntityUtils.js';
import { TestRunCaseSchema, type LdkitTestRunCase } from '../schemas/TestRunCaseSchema.js';

const TestRunCaseUtils = createEntityUtilsWithFields<LdkitTestRunCase>(
  TestRunCaseSchema,
  'TestRunCase'
);

export const TestRunCases = TestRunCaseUtils.Repository;
export const deleteTestRunCase = TestRunCaseUtils.delete;
export const findAllTestRunCases = TestRunCaseUtils.findAll;
