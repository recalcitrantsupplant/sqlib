/**
 * Where does `abbreviateIri`'s cost actually go?
 *
 * The shipped version is ~15x slower than the same algorithm written plainly,
 * and it is not the algorithm. `prefixCache` is a deep `ref`, so
 * `sortedNamespaces` is a reactive array of reactive objects: a scan pays a
 * proxy trap per element and per property read, ~40 namespaces deep, on every
 * miss. `shallowRef` would keep the same invalidation (both watchers replace
 * `.value` wholesale) without proxying the contents.
 *
 * Every case gets its own memo so no case is timed against another's cache.
 */
import { describe, it, expect } from 'vitest';
import { ref, shallowRef } from 'vue';
import { DEFAULT_PREFIXES } from '@/lib/defaultPrefixes';

const KNOWN = ['http://xmlns.com/foaf/0.1/', 'http://purl.org/dc/terms/'];
const UNKNOWN = 'http://example.org/no-prefix-for-this/';
const OPS = 20_000;

const iris = Array.from({ length: OPS }, (_, i) =>
  i % 3 === 2 ? `${UNKNOWN}t${i}` : `${KNOWN[i % 2]!}t${i}`,
);

type Ns = { namespace: string; prefix: string };
const sortedPlain: Ns[] = DEFAULT_PREFIXES.filter((m) => m.enabled !== false)
  .map((m) => ({ namespace: m.namespace, prefix: m.prefix }))
  .sort((a, b) => b.namespace.length - a.namespace.length);

function scan(list: Ns[], iri: string) {
  for (const { namespace, prefix } of list) {
    if (iri.startsWith(namespace)) {
      const local = iri.slice(namespace.length);
      if (local.length === 0 || !/^[0-9\-.]/.test(local)) return `${prefix}:${local}`;
    }
  }
  return iri;
}

function time(label: string, fn: (iri: string) => unknown) {
  for (let i = 0; i < 200; i++) fn(iris[i]!);
  const start = performance.now();
  for (const iri of iris) fn(iri);
  const perOp = ((performance.now() - start) * 1000) / iris.length;
  console.log(`  ${label.padEnd(40)} ${perOp.toFixed(3).padStart(8)} µs/op`);
  return perOp;
}

describe('where the cost goes', () => {
  it('isolates the deep-reactive namespace list', () => {
    // Each case owns its memo, and the input is all-distinct, so nothing here
    // is measuring a cache hit.
    const deepRef = ref<{ list: Ns[] }>({ list: sortedPlain });
    const shallow = shallowRef<{ list: Ns[] }>({ list: sortedPlain });
    const reactiveMemo = ref(new Map<string, string>());
    const plainMemo = new Map<string, string>();

    console.log(`\n  scanning ${sortedPlain.length} namespaces, all-distinct input:`);
    const bare = time('plain array', (iri) => scan(sortedPlain, iri));
    const deep = time('ref() deep-reactive array', (iri) => scan(deepRef.value.list, iri));
    const shal = time('shallowRef() array', (iri) => scan(shallow.value.list, iri));
    const memoPlain = time('plain array + plain Map memo', (iri) => {
      const hit = plainMemo.get(iri);
      if (hit !== undefined) return hit;
      const out = scan(sortedPlain, iri);
      plainMemo.set(iri, out);
      return out;
    });
    const memoReactive = time('plain array + ref(Map) memo', (iri) => {
      const hit = reactiveMemo.value.get(iri);
      if (hit !== undefined) return hit;
      const out = scan(sortedPlain, iri);
      reactiveMemo.value.set(iri, out);
      return out;
    });

    console.log(
      `\n  deep ref costs:     ${(deep / bare).toFixed(1)}x over a plain array` +
        `\n  shallowRef costs:   ${(shal / bare).toFixed(1)}x` +
        `\n  reactive Map memo:  ${(memoReactive / memoPlain).toFixed(1)}x over a plain Map\n`,
    );
    expect(bare).toBeGreaterThan(0);
  });
});
