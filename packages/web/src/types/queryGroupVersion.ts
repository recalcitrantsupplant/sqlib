import type {
  QueryGroupVersionExpanded,
  QueryGroupVersionExpandedWithIriMap,
} from '@sparql-query-lib/contracts';

export type QueryGroupVersionFormInput = {
  comment: string | null;
  canvasData: string | null;
};

export type QueryGroupVersionDetail = QueryGroupVersionExpanded;
export type QueryGroupVersionCreateResult = QueryGroupVersionExpandedWithIriMap;
