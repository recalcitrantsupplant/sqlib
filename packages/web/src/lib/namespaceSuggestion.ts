/**
 * What a table cell can offer to register as a prefix, and what to call it.
 *
 * The prefix manager takes a namespace and a prefix; a result table has an
 * IRI. This is the step between: it decides where an unabbreviated IRI would
 * split, and proposes a name for the namespace half so that adding a prefix
 * from a row is one click and an Enter, not a trip to the manager with a
 * copy-paste.
 *
 * The split is deliberately the same one every RDF serialiser makes — last
 * '#', else last '/' — and the local half is then checked against the same
 * grammar `shrink` uses. A namespace whose remainder would not parse as a
 * prefixed name is worse than useless: registering it abbreviates nothing,
 * because `shrink` will decline the very IRI the user clicked on.
 */

import { isValidLocalName } from '@/lib/curie';

/** The prefix grammar the prefix manager enforces on what it stores. */
const PREFIX_NAME = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;

/** Longest prefix we propose unprompted; the field stays editable. */
const MAX_SUGGESTED_LENGTH = 24;

export interface IriSplit {
  /** The namespace, including its trailing '#' or '/'. */
  namespace: string;
  /** The remainder, guaranteed non-empty and a legal prefixed-name local part. */
  localName: string;
}

export function isValidPrefixName(prefix: string): boolean {
  return PREFIX_NAME.test(prefix);
}

/**
 * Where `iri` would split into namespace and local name, or null when it would
 * not usefully split at all.
 *
 * Null covers a non-IRI, an IRI with nothing after its last delimiter
 * (`…/def/` — the namespace is already the whole thing), and one whose local
 * part is not a legal PN_LOCAL (`…/a b`, `…?q=1`). In every case there is no
 * prefix worth offering, so the caller shows no affordance.
 */
export function splitIri(iri: string): IriSplit | null {
  if (typeof iri !== 'string') return null;
  const value = iri.trim();
  if (!/^(?:https?|urn|tag):/.test(value)) return null;

  const hash = value.lastIndexOf('#');
  const cut = hash >= 0 ? hash : value.lastIndexOf('/');
  if (cut < 0) return null;

  const namespace = value.slice(0, cut + 1);
  const localName = value.slice(cut + 1);
  if (localName.length === 0) return null;
  if (!isValidLocalName(localName)) return null;

  // '://' is a scheme separator, not a namespace boundary: the split must not
  // hand back a bare authority as the namespace.
  if (/^[a-z][a-z0-9+.-]*:\/{0,2}$/i.test(namespace)) return null;

  return { namespace, localName };
}

/**
 * A prefix name for `namespace` that is legal, memorable, and not already
 * taken.
 *
 * The last path segment is what people call these namespaces
 * ('geoscience-commodities-wa/' -> 'geoscience-commodities-wa'), so that is
 * the starting point; it is then reduced to the prefix grammar and, if still
 * taken, numbered. Host labels are the fallback for namespaces whose last
 * segment carries no letters, e.g. a bare version number.
 */
export function suggestPrefix(namespace: string, taken: Iterable<string> = []): string {
  const used = new Set(taken);
  const base = segmentPrefix(namespace) || sanitizePrefix(hostLabel(namespace)) || 'ns';

  if (!used.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}${n}`;
    if (!used.has(candidate)) return candidate;
  }
  return base;
}

/**
 * The rightmost path segment that survives sanitising, or ''.
 *
 * Not simply the last one: versioned namespaces end in a segment that is all
 * digits and punctuation, and `http://xmlns.com/foaf/0.1/` should propose
 * 'foaf' rather than falling through to the host and proposing 'xmlns'.
 */
function segmentPrefix(namespace: string): string {
  const path = namespace.replace(/^[a-z][a-z0-9+.-]*:(?:\/\/[^/]*)?/i, '');
  const segments = path.split(/[#/]/).filter((segment) => segment.length > 0);

  for (let i = segments.length - 1; i >= 0; i--) {
    const candidate = sanitizePrefix(segments[i]);
    if (candidate) return candidate;
  }
  return '';
}

function hostLabel(namespace: string): string {
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/]+)/i.exec(namespace);
  if (!match) return '';
  // 'linked.data.gov.au' -> 'linked'; a bare host is more recognisable by its
  // first label than by its TLD.
  return match[1].split(':')[0].split('.')[0] ?? '';
}

/**
 * Reduce arbitrary text to something `isValidPrefixName` accepts, or '' when
 * nothing survives. Length is capped at a hyphen boundary where there is one,
 * so a truncated prefix still reads as words.
 */
function sanitizePrefix(raw: string): string {
  let value = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[^a-z_]+/, '')
    .replace(/[-_]+$/, '');

  if (value.length > MAX_SUGGESTED_LENGTH) {
    const truncated = value.slice(0, MAX_SUGGESTED_LENGTH);
    const boundary = truncated.lastIndexOf('-');
    value = (boundary > 0 ? truncated.slice(0, boundary) : truncated).replace(/[-_]+$/, '');
  }

  return isValidPrefixName(value) ? value : '';
}
