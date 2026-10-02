import { ArgumentSetSchema, type ArgumentSetEntity } from '../schemas/ArgumentSetSchema.js';
import { ArgumentTupleBindingSchema, type ArgumentTupleBindingEntity } from '../schemas/ArgumentTupleBindingSchema.js';
import { ArgumentScalarBindingSchema, type ArgumentScalarBindingEntity } from '../schemas/ArgumentScalarBindingSchema.js';
import { ArgumentGraphBindingSchema, type ArgumentGraphBindingEntity } from '../schemas/ArgumentGraphBindingSchema.js';
import { ArgumentSetVersionSchema, type ArgumentSetVersionEntity } from '../schemas/ArgumentSetVersionSchema.js';
import { createRepositoryLens } from './entityRepository.js';

export const ArgumentSets = createRepositoryLens(ArgumentSetSchema);
export const ArgumentSetVersions = createRepositoryLens(ArgumentSetVersionSchema);
export const ArgumentTupleBindings = createRepositoryLens(ArgumentTupleBindingSchema);
export const ArgumentScalarBindings = createRepositoryLens(ArgumentScalarBindingSchema);
export const ArgumentGraphBindings = createRepositoryLens(ArgumentGraphBindingSchema);

export type {
  ArgumentSetEntity,
  ArgumentSetVersionEntity,
  ArgumentTupleBindingEntity,
  ArgumentScalarBindingEntity,
  ArgumentGraphBindingEntity,
};
