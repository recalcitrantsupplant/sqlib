/**
 * Regression guard: opening a panel must stay fast AND smooth.
 *
 *   pnpm --filter @sparql-query-lib/web test:perf
 *
 * Budgets are asserted on the median of the warm repeats, never a single
 * sample, and the first (cold) open is discarded — it carries one-off costs
 * (lazy chunk fetch, first paint of a font) that are not what this guards.
 *
 * Two numbers are gated, because they fail independently:
 *
 *   timeToSettled  how long until the panel has stopped moving. Catches
 *                  someone lengthening an animation or adding an await to the
 *                  open path.
 *   jankyFrames    frames >32ms during that window. Catches expensive paint
 *                  work that keeps total duration the same but makes it
 *                  stutter — which is what `backdrop-filter: blur()` on these
 *                  overlays did (9 dropped frames vs 1 without it).
 *
 * Run at PERF_CPU=4 by default. Numbers scale with machine speed, so the
 * budgets carry roughly 2x headroom over measured values; they are tripwires
 * for "someone made this much worse", not precise targets.
 */
import { test, expect } from '@playwright/test';
import { mockSidebarCollections } from '../fixtures/collections';
import { measureOpen, summarise, type Sample } from './measure';
import { INTERACTIONS } from './interactions';

const BASE = process.env.PERF_BASE ?? 'http://localhost:3001';
const CPU_THROTTLE = Number(process.env.PERF_CPU ?? 4);
const REPEATS = Number(process.env.PERF_REPEATS ?? 7);

for (const interaction of INTERACTIONS) {
  test(`@perf ${interaction.name} opens within budget`, async ({ page }) => {
    test.skip(Boolean(interaction.skip), interaction.skip ?? '');
    test.setTimeout(180_000);
    await mockSidebarCollections(page);

    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

    await page.goto(BASE + (interaction.url ?? ''), { waitUntil: 'networkidle' });
    // Setup runs before the trigger is awaited: an interaction on a fixture page
    // may have to switch tabs before its trigger is the thing being measured.
    await interaction.setup(page);
    await page.locator(interaction.trigger).first().waitFor();

    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });

    const samples: Sample[] = [];
    for (let i = 0; i < REPEATS; i++) {
      samples.push(await measureOpen(page, interaction));
      await interaction.reset(page);
    }

    const warm = summarise(samples.slice(1));

    // Logged unconditionally so a failure shows the trend, not just the breach.
    console.log(
      `${interaction.name}: settled=${warm.timeToSettled.toFixed(0)}ms ` +
        `janky=${warm.jankyFrames} processing=${warm.processing.toFixed(0)}ms ` +
        `each=[${samples.map((s) => s.timeToSettled.toFixed(0)).join(', ')}]`
    );

    expect(warm.timeToSettled, 'time until the panel stops animating').toBeLessThan(
      interaction.budget.timeToSettled
    );
    expect(warm.jankyFrames, 'frames over 32ms during the open').toBeLessThanOrEqual(
      interaction.budget.jankyFrames
    );
    expect(warm.processing, 'main-thread work inside the click handler').toBeLessThan(
      interaction.budget.processing
    );
  });
}
