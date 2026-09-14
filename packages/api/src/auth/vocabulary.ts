/**
 * Auth vocabulary (design §4.2).
 *
 * Modeled on W3C WAC (`acl:`) but with the modes this system needs: WAC folds
 * delete into Write and has no Execute, and the r/w/x/d split is the point.
 */
import type { BackendMode, LibraryMode } from './types.js';

export const AUTH_NS = 'https://sparql-query-lib/auth#';

/** The named graph holding all authorization data. Never readable by callers. */
export const AUTH_GRAPH_IRI = 'urn:sqlib:auth';

export const auth = {
  Grant: `${AUTH_NS}Grant`,
  Principal: `${AUTH_NS}Principal`,
  Everything: `${AUTH_NS}Everything`,

  principal: `${AUTH_NS}principal`,
  onLibrary: `${AUTH_NS}onLibrary`,
  onBackend: `${AUTH_NS}onBackend`,
  onEverything: `${AUTH_NS}onEverything`,
  mode: `${AUTH_NS}mode`,
  grantedBy: `${AUTH_NS}grantedBy`,
  grantedAt: `${AUTH_NS}grantedAt`,

  rawClaim: `${AUTH_NS}rawClaim`,
  principalKind: `${AUTH_NS}principalKind`,
  seenAt: `${AUTH_NS}seenAt`,
} as const;

export const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
export const XSD_DATETIME = 'http://www.w3.org/2001/XMLSchema#dateTime';

/** Library modes as IRIs. Capitalized per WAC convention (`acl:Read`). */
export const LIBRARY_MODE_IRIS: Record<LibraryMode, string> = {
  read: `${AUTH_NS}Read`,
  write: `${AUTH_NS}Write`,
  execute: `${AUTH_NS}Execute`,
  delete: `${AUTH_NS}Delete`,
  control: `${AUTH_NS}Control`,
};

export const BACKEND_MODE_IRIS: Record<BackendMode, string> = {
  use: `${AUTH_NS}Use`,
  write: `${AUTH_NS}Write`,
};

const LIBRARY_MODE_BY_IRI = new Map<string, LibraryMode>(
  Object.entries(LIBRARY_MODE_IRIS).map(([mode, iri]) => [iri, mode as LibraryMode])
);

const BACKEND_MODE_BY_IRI = new Map<string, BackendMode>(
  Object.entries(BACKEND_MODE_IRIS).map(([mode, iri]) => [iri, mode as BackendMode])
);

export function libraryModeFromIri(iri: string): LibraryMode | undefined {
  return LIBRARY_MODE_BY_IRI.get(iri);
}

export function backendModeFromIri(iri: string): BackendMode | undefined {
  return BACKEND_MODE_BY_IRI.get(iri);
}
