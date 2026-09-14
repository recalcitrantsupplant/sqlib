/**
 * LDKit utility wrappers for ETL entities
 */

import { createRepositoryLens } from './entityRepository.js';
import { EtlJobSchema } from '../schemas/EtlJobSchema.js';
import { EtlJobVersionSchema } from '../schemas/EtlJobVersionSchema.js';
import { EtlColumnMappingSchema } from '../schemas/EtlColumnMappingSchema.js';
import { EtlColumnMappingVersionSchema } from '../schemas/EtlColumnMappingVersionSchema.js';
import { EtlExecutionSchema } from '../schemas/EtlExecutionSchema.js';
import { DuckDbEtlNodeSchema } from '../schemas/DuckDbEtlNodeSchema.js';

export const EtlJobs = createRepositoryLens(EtlJobSchema);
export const EtlJobVersions = createRepositoryLens(EtlJobVersionSchema);
export const EtlColumnMappings = createRepositoryLens(EtlColumnMappingSchema);
export const EtlColumnMappingVersions = createRepositoryLens(EtlColumnMappingVersionSchema);
export const EtlExecutions = createRepositoryLens(EtlExecutionSchema);
export const DuckDbEtlNodes = createRepositoryLens(DuckDbEtlNodeSchema);
