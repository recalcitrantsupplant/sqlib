import { createEntityUtilsWithFields } from './EntityUtils.js';
import { TestRunSchema, type LdkitTestRun } from '../schemas/TestRunSchema.js';

const TestRunUtils = createEntityUtilsWithFields<LdkitTestRun>(
  TestRunSchema,
  'TestRun'
);

export const TestRuns = TestRunUtils.Repository;
export const deleteTestRun = TestRunUtils.delete;
export const findAllTestRuns = TestRunUtils.findAll;
export const findTestRunById = TestRunUtils.findById;
