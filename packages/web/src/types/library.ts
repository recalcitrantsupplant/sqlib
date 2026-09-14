import type { Library } from '@sparql-query-lib/contracts';

export type LibraryFormInput = Pick<Library, 'name' | 'description' | 'defaultBackend'> & { id?: Library['id'] };
