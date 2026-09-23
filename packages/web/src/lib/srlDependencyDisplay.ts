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

/** `<iri>` as `prefix:local` when a declared prefix covers it; anything else unchanged. */
export function compactTerm(term: string, prefixes: Record<string, string>): string {
  const match = /^<([^>]*)>$/.exec(term);
  if (!match) {
    // A literal's datatype IRI is compacted the same way.
    const typed = /^(".*")\^\^(<[^>]*>)$/.exec(term);
    return typed ? `${typed[1]}^^${compactTerm(typed[2], prefixes)}` : term;
  }
  const iri = match[1];
  let best: string | null = null;
  for (const [prefix, namespace] of Object.entries(prefixes)) {
    if (!namespace || !iri.startsWith(namespace)) continue;
    const local = iri.slice(namespace.length);
    if (!PLAIN_LOCAL.test(local) || local.endsWith('.')) continue;
    const candidate = `${prefix}:${local}`;
    if (best === null || candidate.length < best.length) best = candidate;
  }
  return best ?? term;
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
