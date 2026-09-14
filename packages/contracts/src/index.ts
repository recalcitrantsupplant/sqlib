export * from './generated/backend.js';
export * from './generated/library.js';
export * from './generated/query.js';
export * from './generated/querygroup.js';
export * from './generated/rule.js';
export * from './generated/ruleset.js';
export * from './generated/datablock.js';
export * from './generated/datagraph.js';
export * from './generated/tupleset.js';
export * from './generated/test.js';
export * from './generated/tag.js';
export * from './generated/query-version.js';
export * from './generated/query-group-version.js';
export * from './generated/ruleset-version.js';
export * from './generated/benchmark.js';
export * from './generated/detection.js';
export * from './generated/execution.js';
export * from './generated/sparql.js';
export * from './generated/playground.js';

// Backward compatibility aliases for old naming convention
export type {
  LibraryCreate as LibraryCreateInput,
  LibraryUpdate as LibraryUpdateInput
} from './generated/library.js';

export type {
  QueryCreate as QueryCreateInput,
  QueryUpdate as QueryUpdateInput
} from './generated/query.js';

export type {
  QueryGroupCreate as QueryGroupCreateInput,
  QueryGroupUpdate as QueryGroupUpdateInput
} from './generated/querygroup.js';

export type {
  RuleCreate as RuleCreateInput,
  RuleUpdate as RuleUpdateInput
} from './generated/rule.js';

export type {
  RuleSetCreate as RuleSetCreateInput,
  RuleSetUpdate as RuleSetUpdateInput
} from './generated/ruleset.js';

export type {
  DataBlockCreate as DataBlockCreateInput,
  DataBlockUpdate as DataBlockUpdateInput
} from './generated/datablock.js';

export type {
  DataGraphCreate as DataGraphCreateInput,
  DataGraphUpdate as DataGraphUpdateInput
} from './generated/datagraph.js';

export type {
  TupleSetCreate as TupleSetCreateInput,
  TupleSetUpdate as TupleSetUpdateInput
} from './generated/tupleset.js';

export type {
  TestCreate as TestCreateInput,
  TestUpdate as TestUpdateInput
} from './generated/test.js';

export type {
  TagCreate as TagCreateInput,
  TagUpdate as TagUpdateInput
} from './generated/tag.js';
