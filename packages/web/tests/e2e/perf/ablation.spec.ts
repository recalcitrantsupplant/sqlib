/**
 * Causal test for the dropped frames when the editor opens over the page.
 *
 * Each variant injects a CSS override before measuring, so the only thing that
 * changes between runs is the property under test. The original run was
 * against the query focus overlay, which dimmed with `backdrop-filter` and
 * animated in: removing the blur collapsed `jankyFrames`, while `processing`
 * had already shown the CodeMirror mount to be a few ms.
 *
 * That overlay is gone — the editor pop-out (`ExpandableEditor`) replaced it,
 * and it dims with a flat colour and does not animate. So the variants run the
 * experiment the other way round: they put the blur and the animation back on
 * the pop-out, which is what a future change would be doing.
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
    name: 'blurred dim',
    css: `.expand-region.expanded::before { backdrop-filter: blur(4px) !important; }`,
  },
  {
    name: 'animated in (0.15s)',
    css: `@keyframes ablation-in { from { opacity: 0; transform: translateY(20px); } }
          .expand-region.expanded { animation: ablation-in 0.15s ease-out !important; }`,
  },
  {
    name: 'blurred dim + animated in',
    css: `.expand-region.expanded::before { backdrop-filter: blur(4px) !important; }
          @keyframes ablation-in { from { opacity: 0; transform: translateY(20px); } }
          .expand-region.expanded { animation: ablation-in 0.15s ease-out !important; }`,
  },
];

test('@perf pop-out open: CSS ablation', async ({ page }) => {
  test.setTimeout(600_000);
  await mockSidebarCollections(page);

  const cdp = await page.context().newCDPSession(page);
  const rows: string[] = [];

  for (const variant of VARIANTS) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await page.goto(BASE, { waitUntil: 'networkidle' });
    if (variant.css) await page.addStyleTag({ content: variant.css });
    await page.locator('[data-testid="sparql-editor-expand"]').first().waitFor();
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });

    const samples: Sample[] = [];
    for (let i = 0; i < REPEATS; i++) {
      samples.push(
        await measureOpen(page, {
          trigger: '[data-testid="sparql-editor-expand"]',
          appears: '.expand-region.expanded .cm-editor',
          settleRoot: '.expand-region.expanded',
        })
      );
      await page.locator('[data-testid="query-editor-expand-close"]').click();
      await page.locator('.expand-region.expanded').waitFor({ state: 'detached' });
    }

    const warm = summarise(samples.slice(1));
    const f = (n: number, w = 5) => n.toFixed(0).padStart(w);
    rows.push(
      `${variant.name.padEnd(32)} settled=${f(warm.timeToSettled)}ms  ` +
        `janky=${f(warm.jankyFrames, 3)}  worstGap=${f(warm.worstFrameGap)}ms  ` +
        `frames=${f(warm.frames, 3)}  processing=${f(warm.processing)}ms`
    );
  }

  console.log(`\n=== pop-out CSS ablation, cpu=${CPU_THROTTLE}x, warm median ===\n${rows.join('\n')}\n`);
});
