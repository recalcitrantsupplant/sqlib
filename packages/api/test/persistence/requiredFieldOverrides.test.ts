/**
 * `requiredFields` — the sidecar that is now almost entirely derived.
 *
 * `createEntityUtilsWithFields` defaults to what the entity model says is
 * mandatory (every property without `@optional`). Forty-one of the forty-two
 * entities take that default. **One** overrides it, down from two.
 *
 * | entity  | model says     | override | direction |
 * |---------|----------------|----------|-----------|
 * | Query   | name, isPartOf | name     | narrower  |
 *
 * Dropping Query's would start rejecting internal creates that succeed today.
 * The route contract already requires a library, so the gap is only reachable
 * from callers that bypass it.
 *
 * **Backend's came off** (issue #65). It required an `endpoint` of every
 * backend, although `BackendSchema` marks it `@optional` because an
 * `oxigraphEphemeral` backend has none, and the route contract requires one
 * only when `backendType` is `http`. It was one statement of what turned out to
 * be four, and the only one that disagreed with the rest — the fourth being a
 * hand-written message inside `createBackend`, which now matches the derived
 * one. The conditional rule still lives in the contract's `superRefine`, which
 * is where a conditional can be expressed.
 *
 * So this file is a decision record for what is left. It fails when the model
 * moves underneath the one remaining override.
 */
import { describe, expect, it } from 'vitest';
import type { Property, Schema } from '../../src/persistence/schema.js';
import { BackendSchema } from '../../src/persistence/schemas/BackendSchema.js';
import { QuerySchema } from '../../src/persistence/schemas/QuerySchema.js';

/** What `EntityUtils.requiredFieldsFrom` derives, restated so drift is visible here. */
function derivedRequiredFields(schema: Schema): string[] {
  return Object.entries(schema)
    .filter(
      ([key, value]) =>
        key !== '@type' &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        !(value as Property)['@optional'],
    )
    .map(([key]) => key);
}

/** A copy of the one remaining override, from QueryUtils.ts. */
const QUERY_OVERRIDE = ['name'];

describe('requiredFields overrides', () => {
  it('Query drops isPartOf, which the model makes mandatory', () => {
    const derived = derivedRequiredFields(QuerySchema);

    expect(derived).toEqual(['name', 'isPartOf']);
    expect(derived).not.toEqual(QUERY_OVERRIDE);
    // Narrower, and only narrower: the override must not require something the
    // model does not, which would be a rule stated in one layer alone.
    expect(QUERY_OVERRIDE.filter(field => !derived.includes(field))).toEqual([]);
  });

  it('Backend has none, and follows the model', () => {
    const derived = derivedRequiredFields(BackendSchema);

    expect(derived).toEqual(['name', 'backendType']);
    // `endpoint` stays `@optional` precisely because an ephemeral backend has
    // none. Nothing narrows or widens that any more on this path.
    expect(BackendSchema.endpoint['@optional']).toBe(true);
  });
});
