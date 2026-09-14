import { createEntityUtilsWithFields } from './EntityUtils.js';
import { TestCaseSchema, type LdkitTestCase } from '../schemas/TestCaseSchema.js';

const TestCaseUtils = createEntityUtilsWithFields<LdkitTestCase>(TestCaseSchema, 'TestCase');

export const TestCases = TestCaseUtils.Repository;
export const createTestCase = TestCaseUtils.create;
export const updateTestCase = TestCaseUtils.update;
export const deleteTestCase = TestCaseUtils.delete;
export const findAllTestCases = TestCaseUtils.findAll;
export const findTestCaseById = TestCaseUtils.findById;

// Reading a version's cases lives in `lib/testCases.ts`, not here: the writer
// and the runner have to agree on the order and on what "no cases" means, and a
// second way to ask is how those two answers drift apart.
