import { createEntityUtilsWithFields } from './EntityUtils.js';
import { TestSchema, type TestEntity } from '../schemas/TestSchema.js';
import { TestVersionSchema, type TestVersionEntity } from '../schemas/TestVersionSchema.js';
import { assertMutableEntity } from '../../lib/immutability.js';

const TestEntityUtils = createEntityUtilsWithFields<TestEntity>(TestSchema, 'Test');

export const Tests = TestEntityUtils.Repository;
export const createTest = TestEntityUtils.create;
export const updateTest = TestEntityUtils.update;
export const deleteTest = TestEntityUtils.delete;
export const findAllTests = TestEntityUtils.findAll;
export const findTestById = TestEntityUtils.findById;

const TestVersionUtils = createEntityUtilsWithFields<TestVersionEntity>(
  TestVersionSchema,
  'TestVersion'
);

export const TestVersions = TestVersionUtils.Repository;
export const createTestVersion = TestVersionUtils.create;
export async function updateTestVersion(id: string, updates: Partial<TestVersionEntity>): Promise<void> {
  const existing = await findTestVersionById(id);
  assertMutableEntity('TestVersion', existing as Record<string, unknown> | null, updates as Record<string, unknown>);
  return TestVersionUtils.update(id, updates);
}
export const deleteTestVersion = TestVersionUtils.delete;
export const findAllTestVersions = TestVersionUtils.findAll;
export const findTestVersionById = TestVersionUtils.findById;

export async function listVersionsForTest(testId: string): Promise<TestVersionEntity[]> {
  const all = await TestVersionUtils.findAll();
  return all
    .filter(v => v.isPartOf === testId)
    .sort((a, b) => (a.version ?? 0) - (b.version ?? 0));
}
