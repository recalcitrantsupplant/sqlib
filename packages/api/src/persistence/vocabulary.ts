/**
 * Strongly typed vocabulary containers.
 *
 * Local replacement for LDKit's `createNamespace` (plan §3 Phase 5). The runtime
 * behaviour is identical — terms concatenate onto the namespace IRI — so every
 * vocabulary in `namespaces.ts` keeps producing the exact IRIs already stored in
 * the data.
 *
 * One deliberate difference: LDKit typed a term as `` `${prefix}${term}` ``, so
 * `xsd.dateTime` had the *type* `"xsd:dateTime"` while its *value* was the full
 * IRI. Nothing depended on that (the schemas are compared by value, and
 * `schemaIntrospection.ts` matches on IRIs), and a type that disagrees with its
 * own value is not worth carrying forward, so terms are typed as what they are.
 */

export type Namespace = {
  iri: string;
  prefix: string;
  terms: readonly string[];
};

/** Every term as a full IRI, plus the namespace's own `$iri` / `$prefix`. */
export type NamespaceInterface<N extends Namespace> = {
  [Term in N['terms'][number]]: `${N['iri']}${Term}`;
} & {
  $prefix: N['prefix'];
  $iri: N['iri'];
};

/**
 * Builds a vocabulary from its specification. Pass the spec `as const` so the
 * term names survive as literal types.
 */
export function createNamespace<N extends Namespace>(spec: N): NamespaceInterface<N> {
  const terms: Record<string, string> = {};
  for (const term of spec.terms) {
    terms[term] = `${spec.iri}${term}`;
  }
  return Object.assign(terms, { $prefix: spec.prefix, $iri: spec.iri }) as NamespaceInterface<N>;
}
