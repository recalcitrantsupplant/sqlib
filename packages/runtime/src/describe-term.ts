/**
 * How a term reads — decided once, rendered anywhere.
 *
 * A SPARQL result cell is not just its `value`. An IRI may be abbreviated
 * against a prefix table; a literal's datatype is worth showing except when it
 * is `xsd:string`, which every plain literal has and none of them mean; a
 * language tag hangs off the end; an absent binding is a real state and not an
 * empty string. Those are *decisions*, and they should be the same decisions in
 * the app's result table and in an exported page — otherwise the same query run
 * two ways reads differently, which is exactly the class of divergence this
 * package exists to prevent.
 *
 * What this does not decide is *markup*. The app renders vnodes with a prefix
 * badge and an inline "add prefix" affordance; the export renders table cells.
 * Both start from the same description.
 *
 * Abbreviation is **injected** rather than owned. The app's prefix manager is
 * reactive and memoised, and its subscription behaviour is load-bearing — a
 * cell must touch the store during its own render or it will not re-render when
 * a prefix is toggled. Calling into that from here would break it, and
 * reimplementing it would be the duplication this module is against. So the
 * host passes the abbreviator it already has; a static {@link PrefixTable} is
 * enough for hosts that have no manager at all.
 */

import { serializeIri, type PrefixTable, type TermValue } from './sparql-terms.js';

/** `xsd:string` is the implicit datatype of every plain literal; showing it is noise. */
const XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string';

/** What an abbreviator returns, matching the app's prefix manager. */
export interface Abbreviation {
  abbreviated: string;
  wasAbbreviated: boolean;
  fullIri?: string | null;
}

export interface DescribeTermOptions {
  /**
   * Shorten an IRI. Pass the host's own abbreviator — the app's reactive one,
   * or {@link prefixTableAbbreviator} for a static table.
   */
  abbreviate?: (iri: string) => Abbreviation;
}

/** A term, reduced to what any renderer needs to show it. */
export interface TermDescription {
  /** Absent binding: the row has no value here at all. */
  kind: 'absent' | 'uri' | 'literal' | 'bnode' | 'unknown';
  /** Short human label for a type badge. */
  typeLabel: string;
  /** What to show. Abbreviated when abbreviation applied, else the raw value. */
  display: string;
  /** The unabbreviated IRI, only when `display` is an abbreviation of it. */
  fullIri: string | null;
  /** Datatype to show, already abbreviated; null when there is none worth showing. */
  datatype: string | null;
  /** Language tag, without the `@`. */
  language: string | null;
}

/** The description of a cell that has no binding. */
const ABSENT: TermDescription = {
  kind: 'absent',
  typeLabel: '',
  display: '—',
  fullIri: null,
  datatype: null,
  language: null,
};

/**
 * Build an abbreviator from a static prefix table.
 *
 * Delegates to {@link serializeIri}, so an exported page abbreviates exactly as
 * the substituted query does — the prefix a reader sees in the results is the
 * prefix they saw in the query.
 */
export function prefixTableAbbreviator(prefixes: PrefixTable): (iri: string) => Abbreviation {
  return (iri: string): Abbreviation => {
    try {
      const serialised = serializeIri(iri, prefixes);
      // `serializeIri` returns `<full>` when nothing matched, and `prefix:local`
      // when something did — the angle brackets are the tell.
      if (serialised.startsWith('<')) return { abbreviated: iri, wasAbbreviated: false };
      return { abbreviated: serialised, wasAbbreviated: true, fullIri: iri };
    } catch {
      // An IRI we would refuse to write is still an IRI we can display.
      return { abbreviated: iri, wasAbbreviated: false };
    }
  };
}

/** Describe one binding for display. */
export function describeTerm(
  term: TermValue | null | undefined,
  options: DescribeTermOptions = {},
): TermDescription {
  if (!term || typeof term !== 'object' || typeof term.value !== 'string') return ABSENT;

  const abbreviate = options.abbreviate;

  if (term.type === 'uri') {
    const result = abbreviate?.(term.value);
    return {
      kind: 'uri',
      typeLabel: 'IRI',
      display: result?.wasAbbreviated ? result.abbreviated : term.value,
      fullIri: result?.wasAbbreviated ? (result.fullIri ?? term.value) : null,
      datatype: null,
      language: null,
    };
  }

  if (term.type === 'bnode') {
    return { kind: 'bnode', typeLabel: 'BNode', display: term.value, fullIri: null, datatype: null, language: null };
  }

  if (term.type === 'literal') {
    const language = term['xml:lang'] ?? null;
    let datatype: string | null = null;
    // Datatype and language are mutually exclusive in RDF 1.1, and a
    // language-tagged literal's implicit datatype says nothing a reader wants.
    if (!language && term.datatype && term.datatype !== XSD_STRING) {
      const result = abbreviate?.(term.datatype);
      datatype = result?.wasAbbreviated ? result.abbreviated : term.datatype;
    }
    return {
      kind: 'literal',
      typeLabel: 'Literal',
      display: term.value,
      fullIri: null,
      datatype,
      language,
    };
  }

  return {
    kind: 'unknown',
    typeLabel: String(term.type ?? ''),
    display: term.value,
    fullIri: null,
    datatype: null,
    language: null,
  };
}
