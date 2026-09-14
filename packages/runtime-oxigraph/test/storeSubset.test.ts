import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `OxigraphStore` is a hand-written subset of somebody else's class, and
 * `loadOxigraph`'s return type makes `tsc` check it — but only against the
 * declarations the `oxigraph` package advertises as its `types`, which are the
 * **Node** build's. This package exists to run in a browser, where the file
 * that actually loads is `web.js`, and wasm-bindgen generates the two `.d.ts`
 * separately. Nothing in the type system compares them.
 *
 * So the check the compiler cannot make is made here: the two builds declare
 * the same `Store`, which is what lets one typecheck stand for both. And the
 * one place they legitimately differ — the browser build's default export, the
 * initialiser `loadOxigraph` feature-detects — is pinned rather than assumed,
 * because that asymmetry is the reason the feature detection exists.
 */

const require = createRequire(import.meta.url);
const oxigraphDir = path.dirname(require.resolve('oxigraph'));

function declarations(build: 'node' | 'web'): string {
  return readFileSync(path.join(oxigraphDir, `${build}.d.ts`), 'utf8');
}

/**
 * The `export class Store { … }` block, ended by the first `}` in the first
 * column. wasm-bindgen indents every member, so that brace is the class's own.
 */
function storeDeclaration(source: string): string {
  const start = source.indexOf('export class Store {');
  if (start === -1) throw new Error('no `export class Store` in these declarations');
  const end = source.indexOf('\n}', start);
  if (end === -1) throw new Error('unterminated `export class Store`');
  return source.slice(start, end + 2);
}

describe('the Store the type check is made against', () => {
  it('is declared identically by the Node build and the browser build', () => {
    const node = storeDeclaration(declarations('node'));
    const web = storeDeclaration(declarations('web'));

    // A parse that found nothing would make the comparison above pass on two
    // empty strings, so the extraction is asserted before it is trusted.
    expect(node).toContain('query(');
    expect(node).toContain('load(');
    expect(node).toContain('readonly size: number;');

    expect(web).toBe(node);
  });

  it('names the members OxigraphStore promises, which is what the type check reaches', () => {
    const node = storeDeclaration(declarations('node'));

    // Renaming any of these is the drift `loadOxigraph`'s return type catches;
    // this says which three lines that check is standing on.
    expect(node).toMatch(/^\s+query\(/m);
    expect(node).toMatch(/^\s+load\(/m);
    expect(node).toMatch(/^\s+readonly size: number;$/m);
  });
});

describe('the initialiser loadOxigraph feature-detects', () => {
  it('is exported by the browser build and by no other', () => {
    expect(declarations('web')).toMatch(/^export default function /m);
    expect(declarations('node')).not.toMatch(/^export default/m);
  });

  it('is the file the browser field points at, not one this test named itself', () => {
    const manifest = JSON.parse(
      readFileSync(path.join(oxigraphDir, 'package.json'), 'utf8'),
    ) as { main: string; types: string; browser: string };

    expect(manifest.types).toBe('node.d.ts');
    expect(manifest.main).toBe('node.js');
    expect(manifest.browser).toBe('web.js');
  });
});
