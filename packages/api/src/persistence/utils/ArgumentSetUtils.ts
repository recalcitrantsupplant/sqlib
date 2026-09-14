import { ArgumentSetSchema, type LdkitArgumentSet } from '../schemas/ArgumentSetSchema.js';
import { ArgumentTupleBindingSchema, type LdkitArgumentTupleBinding } from '../schemas/ArgumentTupleBindingSchema.js';
import { ArgumentScalarBindingSchema, type LdkitArgumentScalarBinding } from '../schemas/ArgumentScalarBindingSchema.js';
import { ArgumentGraphBindingSchema, type LdkitArgumentGraphBinding } from '../schemas/ArgumentGraphBindingSchema.js';
import { ArgumentSetVersionSchema, type LdkitArgumentSetVersion } from '../schemas/ArgumentSetVersionSchema.js';
import { createRepositoryLens } from './entityRepository.js';

export const ArgumentSets = createRepositoryLens(ArgumentSetSchema);
export const ArgumentSetVersions = createRepositoryLens(ArgumentSetVersionSchema);
export const ArgumentTupleBindings = createRepositoryLens(ArgumentTupleBindingSchema);
export const ArgumentScalarBindings = createRepositoryLens(ArgumentScalarBindingSchema);
export const ArgumentGraphBindings = createRepositoryLens(ArgumentGraphBindingSchema);

export type {
  LdkitArgumentSet,
  LdkitArgumentSetVersion,
  LdkitArgumentTupleBinding,
  LdkitArgumentScalarBinding,
  LdkitArgumentGraphBinding,
};
