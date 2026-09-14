import type { QueryGroup } from '@sparql-query-lib/contracts';

export type QueryGroupFormInput = {
  name: string;
  description: string | null;
  isPartOf: string;
};
