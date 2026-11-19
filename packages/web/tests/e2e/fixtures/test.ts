/**
 * The `test` every e2e spec imports. It is Playwright's `test` with one
 * automatic check: no popover leaves the window.
 *
 * A menu, list box or dialog that runs past the edge of the window hides its
 * rows and its controls (the argument set switcher, #197). The check watches
 * every such element while the test runs. Each time one opens or changes size,
 * the check compares its box with the window. After the test, any element that
 * ran past an edge fails the test, with its role, its first text and its box.
 *
 * Import `test` and `expect` from here, in place of `@playwright/test`.
 */
import { test as base, expect } from '@playwright/test';

export * from '@playwright/test';

interface Offscreen {
  what: string;
  box: { left: number; top: number; right: number; bottom: number };
  window: { width: number; height: number };
}

declare global {
  interface Window {
    __sqlibOffscreen?: Offscreen[];
  }
}

/** Runs in the page before any of its scripts. */
function watchPopovers(): void {
  const SELECTOR = '[role="menu"], [role="listbox"], [role="dialog"], [role="alertdialog"]';
  /** Sub-pixel rounding and borders. */
  const TOLERANCE = 1;
  const found: Offscreen[] = [];
  const seen = new Set<string>();
  window.__sqlibOffscreen = found;

  const check = (element: Element) => {
    if (!element.isConnected) return;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const style = getComputedStyle(element);
    if (style.visibility === 'hidden' || style.display === 'none') return;
    const width = document.documentElement.clientWidth;
    const height = document.documentElement.clientHeight;
    const out = rect.left < -TOLERANCE || rect.top < -TOLERANCE
      || rect.right > width + TOLERANCE || rect.bottom > height + TOLERANCE;
    if (!out) return;
    const role = element.getAttribute('role') ?? element.tagName.toLowerCase();
    const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
    const what = `${role}: ${text}`;
    if (seen.has(what)) return;
    seen.add(what);
    found.push({
      what,
      box: { left: Math.round(rect.left), top: Math.round(rect.top), right: Math.round(rect.right), bottom: Math.round(rect.bottom) },
      window: { width, height },
    });
  };

  const resizes = new ResizeObserver((entries) => {
    for (const entry of entries) check(entry.target);
  });
  const watched = new WeakSet<Element>();
  const watch = (element: Element) => {
    if (watched.has(element)) return;
    watched.add(element);
    resizes.observe(element);
    // After the open animation, which scales and slides the element in.
    setTimeout(() => check(element), 300);
  };

  const scan = (root: ParentNode) => {
    if (root instanceof Element && root.matches(SELECTOR)) watch(root);
    root.querySelectorAll(SELECTOR).forEach(watch);
  };

  const start = () => {
    scan(document);
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof Element) scan(node);
        });
        if (mutation.type === 'attributes' && mutation.target instanceof Element) scan(mutation.target);
      }
    }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['role'] });
  };

  if (document.documentElement) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
}

export const test = base.extend<{ popoversInWindow: void }>({
  popoversInWindow: [
    async ({ page }, use) => {
      await page.addInitScript(watchPopovers);
      await use();
      const offscreen = page.isClosed()
        ? []
        : await page.evaluate(() => window.__sqlibOffscreen ?? []).catch(() => []);
      expect(offscreen, 'A popover ran past the edge of the window').toEqual([]);
    },
    { auto: true },
  ],
});
