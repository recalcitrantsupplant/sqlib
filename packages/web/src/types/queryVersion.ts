import type {
  QueryVersionExpanded,
  QueryVersionExpandedWithIriMap,
} from '@sparql-query-lib/contracts';
import type { QueryTypeValue } from '@sparql-query-lib/types';

export type QueryVersionFormInput = {
  queryString: string;
  comment: string | null;
  queryType: QueryTypeValue | null;
  defaultBackend: string | null;
};

export type QueryVersionDetail = QueryVersionExpanded;
export type QueryVersionCreateResult = QueryVersionExpandedWithIriMap;
