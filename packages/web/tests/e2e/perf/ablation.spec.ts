/**
 * Causal test for the overlay's dropped frames.
 *
 * Each variant injects a CSS override before measuring, so the only thing that
 * changes between runs is the property under test. If removing
 * `backdrop-filter` collapses `jankyFrames`, the blur is the cost — not the
 * CodeMirror mount, which `processing` already showed to be a few ms.
 */
import { test } from '@playwright/test';
import { mockSidebarCollections } from '../fixtures/collections';
import { measureOpen, summarise, type Sample } from './measure';

const BASE = process.env.PERF_BASE ?? 'http://localhost:3002';
const CPU_THROTTLE = Number(process.env.PERF_CPU ?? 4);
const REPEATS = Number(process.env.PERF_REPEATS ?? 7);

const VARIANTS: Array<{ name: string; css: string }> = [
  { name: 'baseline (as shipped)', css: '' },
  {
    name: 'no backdrop-filter',
    css: `.focus-overlay { backdrop-filter: none !important; }`,
  },
  {
    name: 'faster animations (0.15s/0.12s)',
    css: `.focus-overlay { animation-duration: 0.12s !important; }
          .focus-container { animation-duration: 0.15s !important; }`,
  },
  {
    name: 'no blur + faster animations',
    css: `.focus-overlay { backdrop-filter: none !important; animation-duration: 0.12s !important; }
          .focus-container { animation-duration: 0.15s !important; }`,
  },
  {
    name: 'no animation at all',
    css: `.focus-overlay, .focus-container { animation: none !important; }`,
  },
];

test('@perf overlay open: CSS ablation', async ({ page }) => {
  test.setTimeout(600_000);
  await mockSidebarCollections(page);

  const cdp = await page.context().newCDPSession(page);
  const rows: string[] = [];

  for (const variant of VARIANTS) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await page.goto(BASE, { waitUntil: 'networkidle' });
    if (variant.css) await page.addStyleTag({ content: variant.css });
    await page.locator('button[title="Focus Mode"]').first().waitFor();
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });

    const samples: Sample[] = [];
    for (let i = 0; i < REPEATS; i++) {
      samples.push(
        await measureOpen(page, {
          trigger: 'button[title="Focus Mode"]',
          appears: '.focus-overlay .cm-editor',
          settleRoot: '.focus-overlay',
        })
      );
      await page.locator('.focus-overlay button[title="Close Focus Mode"]').click();
      await page.locator('.focus-overlay').waitFor({ state: 'detached' });
    }

    const warm = summarise(samples.slice(1));
    const f = (n: number, w = 5) => n.toFixed(0).padStart(w);
    rows.push(
      `${variant.name.padEnd(32)} settled=${f(warm.timeToSettled)}ms  ` +
        `janky=${f(warm.jankyFrames, 3)}  worstGap=${f(warm.worstFrameGap)}ms  ` +
        `frames=${f(warm.frames, 3)}  processing=${f(warm.processing)}ms`
    );
  }

  console.log(`\n=== overlay CSS ablation, cpu=${CPU_THROTTLE}x, warm median ===\n${rows.join('\n')}\n`);
});
