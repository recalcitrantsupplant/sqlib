import type { SrlDependencyReason, SrlTripleSummary } from '@/composables/useApiClient';

/**
 * How a dependency's triple patterns are written for a reader.
 *
 * The stratifier compares expanded IRIs, so the patterns it reports come back
 * as `<http://example/p>` — which is not how the author wrote them and not what
 * they will search the document for. Here they are put back in the document's
 * own prefixes.
 */

/** A local name that can follow `prefix:` without escaping. */
const PLAIN_LOCAL = /^[A-Za-z_][\w.-]*$|^$/;

/**
 * Namespaces a reader knows without being told. `rdf:` is how an RDF 1.2 term
 * like `<< :s :p :o >>` is explained (its reifier `rdf:reifies` the triple), and
 * spelling that IRI out in full hides the point in a wall of text. Only used
 * when the document does not declare the prefix itself.
 */
const WELL_KNOWN: Record<string, string> = {
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
};

/** One IRI as `prefix:local` when a prefix covers it, else as written. */
function compactIri(iri: string, prefixes: Record<string, string>): string {
  let best: string | null = null;
  const declared = new Set(Object.values(prefixes));
  const candidates = {
    ...Object.fromEntries(Object.entries(WELL_KNOWN).filter(([prefix, ns]) => !(prefix in prefixes) && !declared.has(ns))),
    ...prefixes,
  };
  for (const [prefix, namespace] of Object.entries(candidates)) {
    if (!namespace || !iri.startsWith(namespace)) continue;
    const local = iri.slice(namespace.length);
    if (!PLAIN_LOCAL.test(local) || local.endsWith('.')) continue;
    const candidate = `${prefix}:${local}`;
    if (best === null || candidate.length < best.length) best = candidate;
  }
  return best ?? `<${iri}>`;
}

/**
 * Every `<iri>` in a term as `prefix:local` when a prefix covers it. A term can
 * hold several, as a triple term `<<( <s> <p> <o> )>>` or a typed literal does;
 * text inside quotes is a literal's value and is left alone.
 */
export function compactTerm(term: string, prefixes: Record<string, string>): string {
  return term.replace(/"(?:[^"\\]|\\.)*"|<([^<>\s"]*)>/g, (match, iri: string | undefined) =>
    iri === undefined ? match : compactIri(iri, prefixes));
}

export function compactTriple(
  triple: SrlTripleSummary | undefined,
  prefixes: Record<string, string>,
): SrlTripleSummary | undefined {
  if (!triple) return triple;
  return {
    subject: triple.subject === undefined ? undefined : compactTerm(triple.subject, prefixes),
    predicate: triple.predicate === undefined ? undefined : compactTerm(triple.predicate, prefixes),
    object: triple.object === undefined ? undefined : compactTerm(triple.object, prefixes),
  };
}

export function compactReason(reason: SrlDependencyReason, prefixes: Record<string, string>): SrlDependencyReason {
  return { ...reason, body: compactTriple(reason.body, prefixes), head: compactTriple(reason.head, prefixes) };
}

export function formatTriple(triple?: SrlTripleSummary): string {
  return [triple?.subject, triple?.predicate, triple?.object].filter(Boolean).join(' ').trim();
}

/**
 * The body pattern as it reads in the rule: under `NOT` when it is negated,
 * because that `NOT` is the half of the pair that forces the ordering.
 */
export function formatBodyPattern(reason: SrlDependencyReason): string {
  const pattern = formatTriple(reason.body);
  return reason.label === 'negative' ? `NOT ${pattern}` : pattern;
}

/**
 * One line for an edge on a cycle: the pattern read and the head it matched.
 * Several reasons collapse to the first and a count — the inspector lists all.
 */
export function cycleEdgeLabel(reasons: SrlDependencyReason[] | undefined): string | null {
  const list = reasons ?? [];
  if (!list.length) return null;
  // The negated reason is the one that matters for the cycle, so lead with it.
  const first = list.find((reason) => reason.label === 'negative') ?? list[0];
  const more = list.length > 1 ? ` +${list.length - 1}` : '';
  return `${formatBodyPattern(first)} → ${formatTriple(first.head)}${more}`;
}
