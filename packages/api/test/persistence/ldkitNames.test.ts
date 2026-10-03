/**
 * LDKit is gone; its name stays only where changing it would be a data
 * migration — the `ldkit:IRI` vocabulary term (see docs/reference/entity-model.md).
 * Type and function names are code, so they say what the thing is now.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../../src', import.meta.url));

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('LDKit-era identifiers', () => {
  it('no source names a type or helper after LDKit', () => {
    const offenders = sources(SRC).flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .map((line, index) => ({ line, at: `${file.slice(SRC.length + 1)}:${index + 1}` }))
        .filter(({ line }) => /\bLdkit[A-Z]\w*|\btoLdkit\b|\bLDKitEntity\b/.test(line))
        .map(({ at }) => at),
    );

    expect(offenders).toEqual([]);
  });
});
