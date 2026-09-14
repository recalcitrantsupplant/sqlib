/*
 * The test subject kinds and their input rules, from the shared types package.
 *
 * Shared rather than API-owned because the tests screen has to decide which
 * input slots to *show* from the same table the writer refuses versions with.
 * Stated twice, the UI would offer a slot the server rejects — which is the
 * failure mode this whole file exists to prevent, one layer up.
 */
export {
  SUBJECT_KINDS,
  isSubjectKind,
  ENTITY_TYPE_FOR_SUBJECT_KIND,
  INPUTS_FOR_SUBJECT_KIND,
  checkSubjectKindInputs,
  type SubjectKind,
  type SubjectKindInputs,
  type SubjectKindCaseInputs,
  type SubjectKindVersionInputs,
} from '@sparql-query-lib/types';
