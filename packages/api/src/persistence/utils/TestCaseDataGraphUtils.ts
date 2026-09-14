import { createEntityUtilsWithFields } from './EntityUtils.js';
import { TestCaseDataGraphSchema, type LdkitTestCaseDataGraph } from '../schemas/TestCaseDataGraphSchema.js';

const TestCaseDataGraphUtils = createEntityUtilsWithFields<LdkitTestCaseDataGraph>(
  TestCaseDataGraphSchema,
  'TestCaseDataGraph',
);

export const TestCaseDataGraphs = TestCaseDataGraphUtils.Repository;
export const createTestCaseDataGraph = TestCaseDataGraphUtils.create;
export const updateTestCaseDataGraph = TestCaseDataGraphUtils.update;
export const deleteTestCaseDataGraph = TestCaseDataGraphUtils.delete;
export const findAllTestCaseDataGraphs = TestCaseDataGraphUtils.findAll;
export const findTestCaseDataGraphById = TestCaseDataGraphUtils.findById;

// Reading a case's graphs in order lives in `lib/testCases.ts`, beside the
// version's cases, for the reason recorded there: the writer and the runner
// have to agree on the order, and a second way to ask is how those two answers
// drift apart.
