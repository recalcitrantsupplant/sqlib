import { createEntityUtilsWithFields } from './EntityUtils.js';
import { TestRunCaseSchema, type TestRunCaseEntity } from '../schemas/TestRunCaseSchema.js';

const TestRunCaseUtils = createEntityUtilsWithFields<TestRunCaseEntity>(
  TestRunCaseSchema,
  'TestRunCase'
);

export const TestRunCases = TestRunCaseUtils.Repository;
export const deleteTestRunCase = TestRunCaseUtils.delete;
export const findAllTestRunCases = TestRunCaseUtils.findAll;
