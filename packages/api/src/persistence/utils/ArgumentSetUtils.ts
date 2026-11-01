import { ArgumentSetSchema, type PersistedArgumentSet } from '../schemas/ArgumentSetSchema.js';
import { ArgumentTupleBindingSchema, type PersistedArgumentTupleBinding } from '../schemas/ArgumentTupleBindingSchema.js';
import { ArgumentScalarBindingSchema, type PersistedArgumentScalarBinding } from '../schemas/ArgumentScalarBindingSchema.js';
import { ArgumentSetVersionSchema, type PersistedArgumentSetVersion } from '../schemas/ArgumentSetVersionSchema.js';
import { createRepositoryLens } from './entityRepository.js';

export const ArgumentSets = createRepositoryLens(ArgumentSetSchema);
export const ArgumentSetVersions = createRepositoryLens(ArgumentSetVersionSchema);
export const ArgumentTupleBindings = createRepositoryLens(ArgumentTupleBindingSchema);
export const ArgumentScalarBindings = createRepositoryLens(ArgumentScalarBindingSchema);

export type {
  PersistedArgumentSet,
  PersistedArgumentSetVersion,
  PersistedArgumentTupleBinding,
  PersistedArgumentScalarBinding,
};
