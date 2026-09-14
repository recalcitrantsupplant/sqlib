/**
 * Normalising argument sets from the wire shape to the runtime shape.
 *
 * A row in a VALUES block is a *partial* binding: an absent key is UNDEF. Clients
 * that build rows from a table send `null` for the blank cells instead, and a whole
 * `null` row for a blank row, because that is what a JSON round-trip of a grid
 * produces. Dropping those nulls is the whole difference between the two shapes.
 *
 * Extracted from the API's `executionArguments.ts` so an exported bundle accepts
 * exactly the payload `POST /execute` accepts.
 */

import type { EmptyArgumentMode, TemplateArgumentSet } from './query-template.js';

/** An argument set as it arrives on the wire, before nulls are normalised away. */
export interface WireArgumentSet {
  head: { vars: string[] };
  arguments: { bindings: unknown[] };
  whenEmpty?: EmptyArgumentMode;
}

/** Drop the nulls a JSON round-trip leaves behind, yielding runtime argument sets. */
export function normalizeUndefBindings(
  argumentSets: readonly WireArgumentSet[] | undefined,
): TemplateArgumentSet[] | undefined {
  return argumentSets?.map((argumentSet) => ({
    ...argumentSet,
    arguments: {
      ...argumentSet.arguments,
      bindings: argumentSet.arguments.bindings.map((row: unknown) =>
        row === null || typeof row !== 'object'
          ? {}
          : Object.fromEntries(
              Object.entries(row as Record<string, unknown>).filter(([, value]) => value !== null),
            ),
      ),
    },
  })) as TemplateArgumentSet[];
}
