import type { Page } from '@playwright/test';

/**
 * The WCAG contrast ratio between an element's text and the background
 * actually painted behind it.
 *
 * "Actually painted" is the whole point: `background-color` on the element
 * alone is `rgba(0, 0, 0, 0)` for most text, and a translucent surface over a
 * translucent surface is neither of them. So the stack of ancestors is walked
 * until an opaque colour is found and then composited back down, which is what
 * the eye sees.
 */
export async function textContrast(page: Page, selector: string, nth = 0): Promise<number> {
  return page.evaluate(
    ({ selector, nth }) => {
      const parse = (value: string): [number, number, number, number] | null => {
        const match = value.match(/rgba?\(([^)]+)\)/);
        if (!match) return null;
        const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(Number);
        if (parts.length < 3 || parts.slice(0, 3).some((part) => Number.isNaN(part))) return null;
        const alpha = parts.length >= 4 ? parts[3] : 1;
        return [parts[0], parts[1], parts[2], alpha];
      };

      const over = (
        top: [number, number, number, number],
        bottom: [number, number, number, number],
      ): [number, number, number, number] => [
        top[3] * top[0] + (1 - top[3]) * bottom[0],
        top[3] * top[1] + (1 - top[3]) * bottom[1],
        top[3] * top[2] + (1 - top[3]) * bottom[2],
        1,
      ];

      const luminance = ([r, g, b]: [number, number, number, number]) => {
        const channel = (value: number) => {
          const srgb = value / 255;
          return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
      };

      const element = document.querySelectorAll(selector)[nth];
      if (!element) throw new Error(`No element for ${selector}[${nth}]`);

      const foreground = parse(getComputedStyle(element).color);
      if (!foreground) throw new Error(`No text colour for ${selector}[${nth}]`);

      // Every translucent layer between the text and the first opaque one.
      const layers: [number, number, number, number][] = [];
      let node: Element | null = element;
      while (node) {
        const parsed = parse(getComputedStyle(node).backgroundColor);
        if (parsed && parsed[3] > 0) {
          layers.push(parsed);
          if (parsed[3] === 1) break;
        }
        node = node.parentElement;
      }

      // The page itself is white below everything, as the browser paints it.
      let background: [number, number, number, number] = [255, 255, 255, 1];
      for (let i = layers.length - 1; i >= 0; i -= 1) background = over(layers[i], background);

      const a = luminance(over(foreground, background));
      const b = luminance(background);
      const [light, dark] = a > b ? [a, b] : [b, a];
      return (light + 0.05) / (dark + 0.05);
    },
    { selector, nth },
  );
}

/**
 * The relative luminance of the background painted behind an element — how
 * light or dark a panel actually is, which is what tells a light theme from a
 * dark one without pinning a hex.
 */
export async function backgroundLuminance(page: Page, selector: string): Promise<number> {
  return page.evaluate((selector) => {
    const parse = (value: string): [number, number, number, number] | null => {
      const match = value.match(/rgba?\(([^)]+)\)/);
      if (!match) return null;
      const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      if (parts.length < 3 || parts.slice(0, 3).some((part) => Number.isNaN(part))) return null;
      return [parts[0], parts[1], parts[2], parts.length >= 4 ? parts[3] : 1];
    };

    const element = document.querySelector(selector);
    if (!element) throw new Error(`No element for ${selector}`);

    let node: Element | null = element;
    let colour: [number, number, number, number] = [255, 255, 255, 1];
    while (node) {
      const parsed = parse(getComputedStyle(node).backgroundColor);
      if (parsed && parsed[3] === 1) {
        colour = parsed;
        break;
      }
      node = node.parentElement;
    }

    const channel = (value: number) => {
      const srgb = value / 255;
      return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(colour[0]) + 0.7152 * channel(colour[1]) + 0.0722 * channel(colour[2]);
  }, selector);
}
