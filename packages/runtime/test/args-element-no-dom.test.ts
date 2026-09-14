/**
 * The element module, loaded where there is no DOM.
 *
 * No `@vitest-environment` line, and that is the whole point: every other spec
 * that touches this module opts into happy-dom, so `HTMLElement` exists for all
 * of them and none can see what a host without one gets. Neither can anything
 * else in the repository — the Vue app is `ssr: false`, and the exported page is
 * a browser by definition.
 *
 * What a host without one used to get was `ReferenceError: HTMLElement is not
 * defined`, at *import*, because an `extends` clause is evaluated when the
 * module loads. Every server-rendering consumer — Nuxt, Next, Astro — imports
 * component modules on the server before it ever renders, so the failure landed
 * on the first such install and nowhere earlier.
 *
 * `defineArgsElement` has always tested for `customElements` so that a host
 * with no DOM could call it and get nothing. This spec is that intention
 * stated where it can fail: the import has to survive for the guard to run.
 * `scripts/check-installable.mjs` asks the same question of the packed tarball
 * in a real Node process; this asks it of the source, in the unit suite, where
 * the answer arrives in a second rather than after a build.
 */
import { describe, expect, it } from 'vitest';

describe('args-element with no DOM', () => {
  it('really has no DOM — otherwise everything below passes vacuously', () => {
    expect(typeof HTMLElement).toBe('undefined');
    expect(typeof customElements).toBe('undefined');
  });

  it('imports without throwing', async () => {
    const module = await import('../src/args-element.js');
    expect(typeof module.SqlibArgsElement).toBe('function');
    expect(module.ARGS_ELEMENT_STYLES).toContain('sqlib-args');
  });

  it('registers nothing, and says so by returning rather than throwing', async () => {
    const { defineArgsElement } = await import('../src/args-element.js');
    expect(() => defineArgsElement()).not.toThrow();
  });

  it('is reachable through the browser bundle too, which re-exports it', async () => {
    const module = await import('../src/browser.js');
    expect(typeof module.defineArgsElement).toBe('function');
    // A name from the other half of that entry point, so this is the whole
    // bundle loading rather than the element module alone.
    expect(typeof module.fromBundle).toBe('function');
  });
});
