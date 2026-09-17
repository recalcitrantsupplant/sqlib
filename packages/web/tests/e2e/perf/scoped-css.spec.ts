/**
 * Scoped styles that cannot reach what they name.
 *
 * Vue scopes a component's CSS by stamping `[data-v-…]` on the elements it
 * renders and appending the same attribute to every selector. An element
 * rendered by a third-party primitive does not always get the attribute — reka
 * drops it on some of its inner elements — and the rule then matches nothing
 * while looking, in the source and to every static check, exactly like a rule
 * that works.
 *
 * It is not theoretical: `SearchSelect` lost its menu `max-height` that way, so
 * a library with forty data graphs drew all forty off the bottom of the window,
 * and lost `min-width: 0` on the combobox root in the same breath. Both looked
 * fine in the file. The only thing that can tell is a browser, so this walks
 * the loaded stylesheets, finds the rules that need a scope attribute, and
 * checks whether the elements wearing those classes actually carry it.
 *
 * A class is only reported when exactly one component claims it and nothing
 * unscoped styles it — an unambiguous owner whose rule cannot land. The fix is
 * `:deep(...)`, which reaches in deliberately and is what this cannot flag.
 *
 * Tagged @perf only to keep it out of the fast suite's budget; it is a
 * correctness check, not a measurement.
 */
import { test, expect } from '@playwright/test';
import { mockEntityApi } from '../fixtures/entities';

/** Elements carrying a class that only a scoped rule styles, without the scope attribute. */
async function audit(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const scopedByClass = new Map<string, Set<string>>();
    const unscopedClasses = new Set<string>();
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try { rules = sheet.cssRules; } catch { continue; }
      const walk = (list: CSSRuleList) => {
        for (const rule of Array.from(list)) {
          if ((rule as CSSGroupingRule).cssRules) walk((rule as CSSGroupingRule).cssRules);
          const selector = (rule as CSSStyleRule).selectorText;
          if (!selector) continue;
          for (const part of selector.split(',')) {
            // Only the compound the attribute is attached to counts: Vue puts
            // it on the element a scoped rule targets, while `:deep(...)` puts
            // it on an ancestor and the class after it is reached deliberately.
            const classes = Array.from(part.matchAll(/\.([a-zA-Z][\w-]*)((?:\[[^\]]*\])*)/g));
            for (const match of classes) {
              const cls = match[1];
              const scope = match[2].match(/\[data-v-([a-f0-9]+)\]/);
              if (scope) {
                if (!scopedByClass.has(cls)) scopedByClass.set(cls, new Set());
                scopedByClass.get(cls)!.add(scope[1]);
              } else {
                unscopedClasses.add(cls);
              }
            }
          }
        }
      };
      walk(rules);
    }

    const offenders: Array<{ cls: string; tag: string; scopes: string[] }> = [];
    for (const el of Array.from(document.querySelectorAll('*'))) {
      const attrs = Array.from(el.attributes).map((a) => a.name);
      if (attrs.some((name) => name.startsWith('data-v-'))) continue;
      for (const cls of Array.from(el.classList)) {
        const scopes = scopedByClass.get(cls);
        // Only when exactly one component claims the class and nothing
        // unscoped also styles it: an unambiguous owner whose rule cannot land.
        if (!scopes || scopes.size !== 1 || unscopedClasses.has(cls)) continue;
        offenders.push({ cls, tag: el.tagName.toLowerCase(), scopes: Array.from(scopes) });
      }
    }
    const seen = new Set<string>();
    return offenders.filter((o) => (seen.has(o.cls) ? false : seen.add(o.cls)));
  });
}

test('@perf no scoped rule names an element that cannot wear its scope', async ({ page }) => {
  await mockEntityApi(page);
  const found: Record<string, unknown> = {};

  await page.goto('/?section=queries', { waitUntil: 'networkidle' });
  await page.locator('.entity-name').first().click().catch(() => {});
  await page.waitForTimeout(800);
  found['queries'] = await audit(page);

  await page.goto('/?section=tests&new=test', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.locator('[data-testid="test-subject"]').click().catch(() => {});
  await page.waitForTimeout(500);
  found['tests+menu'] = await audit(page);

  await page.goto('/?section=rules', { waitUntil: 'networkidle' });
  await page.locator('.entity-name').first().click().catch(() => {});
  await page.waitForTimeout(800);
  found['rules'] = await audit(page);

  console.log('SCOPED AUDIT:', JSON.stringify(found));

  for (const [screen, offenders] of Object.entries(found)) {
    expect(offenders, `${screen}: reach these with :deep(...) or move the rule`).toEqual([]);
  }
});
