/**
 * Guard: no handler re-validates a request fastify/ajv has already validated.
 *
 * Phase C1 (issue #65) removed seventeen such sites. Each was a zod `.parse()`
 * run *after* ajv had validated the same payload against the route schema —
 * usually `produceJsonSchema()` of the very zod schema being re-run. Thirteen
 * were proven no-ops and deleted outright; four were not, and each turned out to
 * be a constraint zod carried that the round-trip had dropped, so the handler's
 * throw was the only thing enforcing it — a 500 on a request the published
 * contract called valid. Those four became schema constraints, and their status
 * codes are pinned by route-level tests.
 *
 * SITES is empty and should stay that way. The coverage test below fails if a
 * `Schema.parse(request.…)` reappears in a route, which is the pattern that
 * produced the whole class. Populate SITES and prove the new site is a no-op
 * before shipping it.
 *
 * The original mechanism, kept because it is what a new entry would need:
 *
 * For every site this runs the same payload through
 *
 *     ajv.validate(x)                    // what production does first
 *     zod.safeParse(x)                   // what the handler then does
 *
 * and compares. Three outcomes matter:
 *
 *   NO-OP        ajv accepts, zod accepts, and the value is unchanged.
 *                Safe to delete the `.parse()`.
 *   REJECT-DRIFT ajv accepts and zod REJECTS. The handler throws on a body the
 *                route contract declared valid — a 500 where the schema promises
 *                400. Deleting the parse *fixes* this; it must be recorded so the
 *                behaviour change is deliberate.
 *   TRANSFORM    ajv accepts, zod accepts, but the value differs. Deleting the
 *                parse changes what the handler sees; the difference has to
 *                become explicit code first.
 *
 * The KNOWN_DIVERGENCES list below is the point of the exercise: every entry is
 * a behaviour change C1 is making on purpose. A new divergence fails the suite.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createValidatorAjv } from '../../src/lib/validator-setup.js';

type ZodLike = { safeParse(value: unknown): { success: boolean; data?: unknown; error?: unknown } };

interface Site {
  /** `file:line` of the `.parse()` this proves out. */
  id: string;
  /** The schema fastify registers for the part being parsed. */
  ajv: unknown;
  /** The zod schema the handler re-parses with. */
  zod: ZodLike;
  samples: Record<string, unknown>[];
}

// GET handlers parse `request.query`, whose values fastify hands over as
// strings — hence string-valued samples on every querystring site.
const SITES: Site[] = [];

/**
 * Divergences C1 is knowingly changing. Anything not listed here must be a
 * clean no-op, or the suite fails and the site needs a decision before its
 * `.parse()` comes out.
 *
 * All four are the same root cause: a constraint that lives in zod and cannot
 * survive `produceJsonSchema()`, so ajv never learns about it and the handler's
 * zod parse is the only thing enforcing it — by throwing, which fastify turns
 * into a 500 on a request the published contract says is valid.
 *
 * Each is fixed by expressing the constraint in the JSON Schema, which turns
 * the 500 into the 400 the contract already promises AND makes the parse a
 * provable no-op. Entries come off this list as that happens.
 */
const KNOWN_DIVERGENCES: string[] = [
];

type Finding = { site: string; sample: string; kind: 'REJECT-DRIFT' | 'TRANSFORM'; detail: string };

/** Stable stringify: sorts object keys at every depth, preserves array order. */
function canonical(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .map(k => [k, walk((v as Record<string, unknown>)[k])])
      );
    }
    return v;
  };
  return JSON.stringify(walk(value));
}

function analyse(): Finding[] {
  const ajv = createValidatorAjv();
  const findings: Finding[] = [];

  for (const site of SITES) {
    if (!site.ajv) throw new Error(`no ajv schema resolved for ${site.id}`);
    // $id would collide across compiles of the same schema object.
    const { $id, $schema, ...clean } = site.ajv as Record<string, unknown>;
    const validate = ajv.compile(clean);

    for (const sample of site.samples) {
      const afterAjv = structuredClone(sample);
      if (!validate(afterAjv)) continue; // rejected at the gate; the handler never runs

      const result = site.zod.safeParse(structuredClone(afterAjv));
      const key = JSON.stringify(sample);

      if (!result.success) {
        findings.push({
          site: site.id,
          sample: key,
          kind: 'REJECT-DRIFT',
          detail: 'ajv accepted, zod rejected — handler throws (500) on a body the route contract declares valid',
        });
        continue;
      }
      // Order-insensitive: zod rebuilds objects in schema-declaration order, so a
      // plain JSON.stringify comparison reports every parse as a transform. Key
      // order is not a semantic change to a request body — nothing downstream
      // reads a body positionally — so it is normalised away rather than listed.
      if (canonical(result.data) !== canonical(afterAjv)) {
        findings.push({
          site: site.id,
          sample: key,
          kind: 'TRANSFORM',
          detail: `zod changed the value: ${canonical(afterAjv)} -> ${canonical(result.data)}`,
        });
      }
    }
  }
  return findings;
}

describe('Phase C1: the handler-side zod parses are no-ops over ajv', () => {
  it('every site is a no-op except the divergences C1 records deliberately', () => {
    const findings = analyse();
    const unexpected = findings.filter(f => !KNOWN_DIVERGENCES.includes(`${f.site} | ${f.sample}`));

    if (unexpected.length) {
      const report = unexpected
        .map(f => `  [${f.kind}] ${f.site}\n      sample: ${f.sample}\n      ${f.detail}`)
        .join('\n');
      throw new Error(
        `${unexpected.length} unproven site(s). Each must become explicit code or a KNOWN_DIVERGENCES entry ` +
          `before its .parse() is deleted:\n${report}`
      );
    }
    expect(unexpected).toEqual([]);
  });

  it('covers every request-path parse site still in packages/api', () => {
    // Derived from source rather than hardcoded: C1 deletes these sites module
    // by module, and a stale constant here would let a site slip through
    // unproven. `\w+Schema.(safe)?Parse(request.` matches request-path parses
    // exactly — response-path shaping (`.parse(normalized)`) is out of scope.
    const dir = fileURLToPath(new URL('../../src/routes/', import.meta.url));
    const remaining = readdirSync(dir)
      .filter(f => f.endsWith('.ts'))
      .flatMap(f => readFileSync(join(dir, f), 'utf8').match(/\w+Schema\.(?:safeParse|parse)\(request\./g) ?? []);

    expect(SITES).toHaveLength(remaining.length);
  });
});
