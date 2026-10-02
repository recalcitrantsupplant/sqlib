/**
 * Every `$id` in the contracts names one document, and every `$ref` a route
 * makes names a document that exists.
 *
 * The two ways a shared schema namespace goes wrong silently:
 *
 *   - Two documents under one `$id`. Fastify keeps whichever it registered
 *     first, so what every `$ref` to that id means depends on boot order. This
 *     is how `contract-routes.ts` and the entity model once both declared
 *     `backend` and four benchmark documents (see that file's header).
 *   - A `$ref` to an id nothing declares. Fastify only finds out when the route
 *     is compiled, which for a route behind a feature flag can be never.
 *
 * Scope is what `packages/contracts` exports: the hub barrel (`./schema` —
 * entity documents and the generated route schemas) and the hand-written route
 * entry point (`./schema/routes`). A route may repeat an `$id` it shares with
 * another route — the detection bodies do — as long as every copy is the same
 * document.
 */
import { describe, expect, it } from 'vitest';
import * as hub from '@sparql-query-lib/contracts/schema';
import * as handWrittenRoutes from '@sparql-query-lib/contracts/schema/routes';

interface Occurrence {
  where: string;
  document: unknown;
}

function collect(
  exports: Record<string, unknown>,
  origin: string,
): { ids: Map<string, Occurrence[]>; refs: Array<{ where: string; ref: string }> } {
  const ids = new Map<string, Occurrence[]>();
  const refs: Array<{ where: string; ref: string }> = [];

  const walk = (value: unknown, where: string) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${where}[${index}]`));
      return;
    }
    if (!value || typeof value !== 'object') return;
    const node = value as Record<string, unknown>;
    if (typeof node.$id === 'string') {
      const list = ids.get(node.$id) ?? [];
      list.push({ where, document: node });
      ids.set(node.$id, list);
    }
    if (typeof node.$ref === 'string') refs.push({ where, ref: node.$ref });
    for (const [key, child] of Object.entries(node)) {
      // `examples` hold payloads, not schemas; an example carrying an `$id` key
      // is data.
      if (key === 'examples' || key === 'example') continue;
      walk(child, `${where}.${key}`);
    }
  };

  for (const [name, value] of Object.entries(exports)) walk(value, `${origin}:${name}`);
  return { ids, refs };
}

/** The document id a `$ref` names: `backend#` → `backend`; `#/definitions/x` is local. */
function refTarget(ref: string): string | null {
  const hash = ref.indexOf('#');
  const target = hash === -1 ? ref : ref.slice(0, hash);
  return target === '' ? null : target;
}

/** The entity documents: the hub exports the API registers at boot (`index.ts`). */
const entityIds = new Set(
  Object.values(hub)
    .filter((value): value is { $id: string } =>
      Boolean(value) && typeof value === 'object' && typeof (value as { $id?: unknown }).$id === 'string')
    .map(value => value.$id),
);

const hubScan = collect(hub as Record<string, unknown>, 'schema');
const routesScan = collect(handWrittenRoutes as Record<string, unknown>, 'schema/routes');

const allIds = new Map<string, Occurrence[]>();
for (const scan of [hubScan, routesScan]) {
  for (const [id, occurrences] of scan.ids) {
    allIds.set(id, [...(allIds.get(id) ?? []), ...occurrences]);
  }
}

describe('contracts schema namespace', () => {
  it('finds the documents and references it is checking', () => {
    // A scan that finds nothing passes every assertion below.
    expect(entityIds.size).toBeGreaterThan(40);
    expect(entityIds.has('backend')).toBe(true);
    expect(routesScan.ids.size).toBeGreaterThan(10);
    expect(hubScan.refs.length + routesScan.refs.length).toBeGreaterThan(50);
  });

  it('names one document per $id', () => {
    const ambiguous = [...allIds]
      .filter(([, occurrences]) =>
        new Set(occurrences.map(occurrence => JSON.stringify(occurrence.document))).size > 1)
      .map(([id, occurrences]) => `${id}: ${occurrences.map(occurrence => occurrence.where).join(', ')}`);
    expect(ambiguous).toEqual([]);
  });

  it('never redeclares an entity document in a route schema', () => {
    const redeclared = [...routesScan.ids.keys()].filter(id => entityIds.has(id));
    expect(redeclared).toEqual([]);
  });

  it('resolves every route $ref to a declared document', () => {
    const unresolved = [...hubScan.refs, ...routesScan.refs]
      .filter(({ ref }) => {
        const target = refTarget(ref);
        return target !== null && !allIds.has(target);
      })
      .map(({ where, ref }) => `${where} → ${ref}`);
    expect(unresolved).toEqual([]);
  });
});
