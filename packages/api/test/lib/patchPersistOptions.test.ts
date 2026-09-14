/**
 * Every option `persist` accepts reaches the record it writes.
 *
 * The defect this guards against was one line long and silent for as long as
 * the field existed: `PersistOptions` declared `dateApplied`, three of the four
 * writers passed it, and `persist`'s `Patch.create` call did not name it. An
 * optional property nobody reads is not a type error, the callers all
 * type-checked, and the field simply never appeared on a stored patch.
 *
 * A behavioural test catches one instance of that; this catches the shape. The
 * class was audited across `packages/api/src` and `packages/rdf-delta/src` when
 * it was found, and `dateApplied` was the only live one — the other candidates
 * are shapes consumed in another file, or a flag whose own comment says it is
 * ignored deliberately (`RuleSetVersionWriter`'s `immutable`).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SOURCE = fileURLToPath(new URL('../../src/lib/patchService.ts', import.meta.url));

/** The interface body, comments and all. */
function persistOptionsBody(source: string): string {
  const match = /interface PersistOptions \{([\s\S]*?)\n\}/.exec(source);
  expect(match, 'PersistOptions is no longer declared as an interface in patchService.ts').toBeTruthy();
  return match![1]!;
}

/** The body of `persist`, from its signature to the closing brace of the file's next declaration. */
function persistBody(source: string): string {
  const start = source.indexOf('async function persist(');
  expect(start, 'persist() is no longer declared in patchService.ts').toBeGreaterThan(-1);
  const end = source.indexOf('\n}', start);
  return source.slice(start, end);
}

describe('patchService.persist', () => {
  const source = readFileSync(SOURCE, 'utf8');

  it('reads every option it declares', () => {
    // Property lines only: a docblock line cannot match, because `*` is not a
    // word character and the key has to be followed by `?:` or `:`.
    const declared = [...persistOptionsBody(source).matchAll(/^\s{2}(\w+)\??:/gm)].map((match) => match[1]!);
    expect(declared).toContain('dateApplied');

    const body = persistBody(source);
    const unread = declared.filter((key) => !new RegExp(`options\\.${key}\\b`).test(body));

    expect(unread, `PersistOptions fields never read by persist(): ${unread.join(', ')}`).toEqual([]);
  });
});
