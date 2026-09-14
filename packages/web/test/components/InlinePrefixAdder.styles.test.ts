import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse, compileStyle } from 'vue/compiler-sfc';

/*
 * The trigger is invisible until the row is hovered, which makes it exactly the
 * kind of control whose CSS can break without a single test noticing: it
 * renders, it has the right classes, every DOM assertion passes, and a user
 * still cannot see or click it.
 *
 * It broke that way once. The reveal was written as
 * `:global(tr:hover) .prefix-trigger` inside `<style scoped>`, and the SFC
 * compiler rewrote it to a bare `tr:hover` — dropping the descendant, applying
 * opacity to the row instead of the button. So these assert against the
 * compiled stylesheet rather than the source: what the compiler emits is what
 * the browser gets, and the source read as correct the whole time.
 */

const COMPONENT = resolve(
  import.meta.dirname,
  '../../src/components/shared/InlinePrefixAdder.vue',
);

function compiledCss(): string {
  const { descriptor } = parse(readFileSync(COMPONENT, 'utf8'));
  return descriptor.styles
    .map(
      (style) =>
        compileStyle({
          source: style.content,
          filename: 'InlinePrefixAdder.vue',
          id: 'data-v-test',
          scoped: !!style.scoped,
        }).code,
    )
    .join('\n');
}

/** The selectors of every rule whose body sets `opacity: 1`. */
function revealSelectors(css: string): string[] {
  const selectors: string[] = [];
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = rule.exec(css)) !== null) {
    if (/opacity:\s*1\b/.test(match[2])) {
      selectors.push(...match[1].split(',').map((s) => s.trim()).filter(Boolean));
    }
  }
  return selectors;
}

describe('InlinePrefixAdder styles', () => {
  it('hides the trigger by default', () => {
    expect(compiledCss()).toMatch(/\.prefix-trigger\[data-v-test\][^{]*\{[^}]*opacity:\s*0/);
  });

  it('reveals the trigger on row hover, targeting the button and not the row', () => {
    const rowHover = revealSelectors(compiledCss()).filter((s) => s.includes('tr:hover'));

    expect(rowHover.length).toBeGreaterThan(0);
    // The regression: `tr:hover` alone sets opacity on the row, which does
    // nothing, and leaves the button at opacity 0 with no way to reach it.
    for (const selector of rowHover) {
      expect(selector, `"${selector}" must target the trigger, not the row`).toMatch(
        /tr:hover\s+.*\.prefix-trigger/,
      );
    }
  });

  it('keeps the trigger reachable without a hovering pointer', () => {
    const css = compiledCss();
    const selectors = revealSelectors(css);

    // Keyboard: focus reveals it.
    expect(selectors.some((s) => s.includes(':focus-visible'))).toBe(true);
    // Touch: nothing to hover with, so it is simply present.
    expect(css).toMatch(/@media\s*\(hover:\s*none\)[^}]*\{[^}]*\.prefix-trigger/);
  });
});
