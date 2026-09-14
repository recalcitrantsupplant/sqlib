import type { Query } from '@sparql-query-lib/contracts';

export type QueryFormInput = {
  name: string;
  description: string | null;
  isPartOf: string;
  defaultBackend: string | null;
};
