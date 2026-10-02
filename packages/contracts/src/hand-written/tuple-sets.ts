/**
 * Tuple set wire contracts: the source-format and column-type vocabularies,
 * and the preview and detection responses.
 *
 * The two vocabularies were declared three times — on the persistence schema,
 * in the API's tuple parser, and in the web — each with a comment saying it
 * mirrored another. They are declared here, once, and the others import them.
 */
import { z } from 'zod';

/**
 * Where a version's rows came from. Provenance only: it records which dialect
 * was parsed at import, never how stored content is read back.
 */
export const TUPLE_SOURCE_FORMATS = [
  'csv',
  'tsv',
  'sparql-results-tsv',
  'sparql-results-json',
  'query-results',
  'etl-results',
] as const;

export type TupleSourceFormat = (typeof TUPLE_SOURCE_FORMATS)[number];

/** A column-level type an untyped column can be promoted to at import. */
export const SUGGESTED_COLUMN_TYPES = ['xsd:integer', 'xsd:date', 'uri'] as const;

export type SuggestedColumnType = (typeof SUGGESTED_COLUMN_TYPES)[number];

export const detectTupleFormatResponseSchema = z.object({
  suggested: z.enum(TUPLE_SOURCE_FORMATS),
});

export const columnTypeSuggestionSchema = z.object({
  column: z.string(),
  suggested: z.enum(SUGGESTED_COLUMN_TYPES),
});

/**
 * What content *would* become, without storing it. Mirrors what a version
 * carries, because it is the same parse.
 */
export const previewTupleContentResponseSchema = z.object({
  contentString: z.string(),
  tupleColumns: z.array(z.string()),
  rowCount: z.number(),
  byteSize: z.number(),
  columnTypeSuggestions: z.array(columnTypeSuggestionSchema),
});

export type PreviewTupleContentResponse = z.infer<typeof previewTupleContentResponseSchema>;
