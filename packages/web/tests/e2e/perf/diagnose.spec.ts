/**
 * Diagnostic run — prints a table, asserts nothing.
 *
 *   PERF_BASE=http://localhost:3000 npx playwright test tests/e2e/perf/diagnose
 *
 * Reports cold (first open after page load) separately from warm (median of
 * the repeats). A large cold/warm gap on the dev server that disappears on the
 * production build is Vite compiling a dynamic import on demand, not an
 * application problem.
 */
import { test } from '@playwright/test';
import { mockSidebarCollections } from '../fixtures/collections';
import { measureOpen, summarise, type Sample } from './measure';
import { INTERACTIONS } from './interactions';

const BASE = process.env.PERF_BASE ?? 'http://localhost:3002';
const REPEATS = Number(process.env.PERF_REPEATS ?? 7);
/**
 * A headless run on an idle dev box is the best case a user never has. Real
 * machines are slower and busy, and main-thread cost scales with CPU speed,
 * so a 4x throttle is the honest default for reproducing "feels clunky".
 */
const CPU_THROTTLE = Number(process.env.PERF_CPU ?? 1);

test('@perf interaction latency report', async ({ page }) => {
  test.setTimeout(300_000);
  await mockSidebarCollections(page);

  if (CPU_THROTTLE > 1) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });
  }

  const rows: string[] = [];

  for (const interaction of INTERACTIONS) {
    /*
     * One broken entry must not cost the whole report. This is a diagnostic,
     * not a gate — budget.spec.ts is a test per interaction and still fails
     * loudly — and a report that aborts on the first stale selector hides the
     * numbers for everything after it, which is how the playground entry stayed
     * broken without anyone seeing it.
     */
    if (interaction.skip) {
      rows.push(`${interaction.name}\n    SKIPPED  ${interaction.skip}`);
      continue;
    }

    try {
      // Fresh page per interaction so "cold" means cold.
      await page.goto(BASE + (interaction.url ?? ''), { waitUntil: 'networkidle' });
      await interaction.setup(page);
      await page.locator(interaction.trigger).first().waitFor({ timeout: 15000 });

      const samples: Sample[] = [];
      for (let i = 0; i < REPEATS; i++) {
        samples.push(await measureOpen(page, interaction));
        await interaction.reset(page);
      }

      const cold = samples[0]!;
      const warm = summarise(samples.slice(1));
      const f = (n: number) => n.toFixed(0).padStart(6);

      rows.push(
        `${interaction.name}\n` +
          `    cold  visible=${f(cold.timeToVisible)}ms  settled=${f(cold.timeToSettled)}ms  processing=${f(cold.processing)}ms  janky=${f(cold.jankyFrames)}  worstGap=${f(cold.worstFrameGap)}ms\n` +
          `    warm  visible=${f(warm.timeToVisible)}ms  settled=${f(warm.timeToSettled)}ms  processing=${f(warm.processing)}ms  janky=${f(warm.jankyFrames)}  worstGap=${f(warm.worstFrameGap)}ms`
      );
    } catch (error) {
      rows.push(`${interaction.name}\n    SKIPPED  ${(error as Error).message.split('\n')[0]}`);
    }
  }

  console.log(
    `\n=== ${BASE}  cpu=${CPU_THROTTLE}x  (warm = median of ${REPEATS - 1}) ===\n${rows.join('\n')}\n`
  );
});
