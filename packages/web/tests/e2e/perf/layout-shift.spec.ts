/**
 * Regression guard: screens must not move under the reader.
 *
 *   pnpm --filter @sparql-query-lib/web test:perf
 *
 * The sibling `budget.spec.ts` measures what a *click* costs. This one
 * measures what happens with no click at all — the layout shifts a screen
 * makes while it loads, and any it goes on making afterwards.
 *
 * Two assertions per screen, because they catch different faults:
 *
 *   cls          the browser's Cumulative Layout Shift for the load. Content
 *                arriving and pushing what is already on screen out of the
 *                way. Budgets are per screen and carry headroom over the
 *                measured value; the whole set is far under the 0.1 that
 *                counts as "good", and the point is to keep it that way.
 *   late shifts  anything moving after SETTLE_MS. A screen that is still
 *                relaying itself out two seconds in is not loading, it is
 *                looping — the Build screen used to blank its table and put it
 *                back once a second, forever, because every reconnect of the
 *                change feed set `loading` and the table is what `loading`
 *                replaces. Nothing catches that but a clock.
 *
 * Shift sources are reported on failure. `layout-shift` entries name the nodes
 * that moved and their before/after rectangles, which is usually enough to see
 * what did it without reproducing by hand.
 *
 * Tagged @perf: excluded from `test:e2e` / `test:e2e:ci` like the rest of this
 * directory. Unlike the interaction budgets these numbers barely depend on
 * machine speed — a shift is geometry, not timing — but the screens are slow
 * to load, so they stay out of the fast suite.
 */
import { test, expect, type Page } from '@playwright/test';
import { mockEntityApi } from '../fixtures/entities';

/** How long after load a shift stops being "loading" and starts being a loop. */
const SETTLE_MS = 2_000;

/** Below this a shift is a sub-pixel rounding artefact, not a moved element. */
const NOISE = 0.0005;

type Shift = { value: number; time: number; sources: string[] };

/**
 * Records every layout shift from the first paint, with the elements that
 * moved. Installed as an init script so the observer exists before the app
 * does — `buffered: true` alone would miss shifts that predate the evaluate.
 */
async function observeShifts(page: Page) {
  await page.addInitScript(() => {
    const shifts: Shift[] = [];
    (window as unknown as { __shifts: Shift[] }).__shifts = shifts;

    /** `tag.class > tag.class > tag.class` for the moved node, for the report. */
    const describe = (node: Node | null): string => {
      let element = node instanceof Element ? node : (node?.parentElement ?? null);
      const parts: string[] = [];
      for (let depth = 0; depth < 3 && element; depth += 1) {
        const classes = (element.getAttribute('class') ?? '')
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .join('.');
        parts.unshift(element.tagName.toLowerCase() + (classes ? `.${classes}` : ''));
        element = element.parentElement;
      }
      return parts.join(' > ') || '(detached)';
    };

    const box = (rect: DOMRectReadOnly) =>
      `${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.width)}x${Math.round(rect.height)}`;

    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as Array<
        PerformanceEntry & {
          value: number;
          hadRecentInput: boolean;
          sources?: Array<{ node: Node | null; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }>;
        }
      >) {
        // Shifts within 500ms of a real interaction are the interaction, not a
        // fault; the browser excludes them from CLS and so does this.
        if (entry.hadRecentInput) continue;
        shifts.push({
          value: entry.value,
          time: Math.round(entry.startTime),
          sources: (entry.sources ?? []).map(
            (source) => `${describe(source.node)} [${box(source.previousRect)} -> ${box(source.currentRect)}]`
          ),
        });
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
}

function report(shifts: Shift[]): string {
  return shifts
    .map((shift) => `  ${shift.value.toFixed(4)} at ${shift.time}ms\n${shift.sources.map((s) => `    ${s}`).join('\n')}`)
    .join('\n');
}

interface Screen {
  name: string;
  url: string;
  /** Rendered before the measurement window opens. */
  ready: string;
  /**
   * Total CLS allowed for the load. Roughly double what the screen measures,
   * so this fails on a regression rather than on noise.
   */
  cls: number;
}

const SCREENS: Screen[] = [
  { name: 'splash', url: '/', ready: '[data-testid="app-splash"]', cls: 0.01 },
  { name: 'queries section', url: '/?section=queries', ready: '[data-testid="entity-list-sidebar"]', cls: 0.02 },
  { name: 'rules section', url: '/?section=rules', ready: '[data-testid="entity-list-sidebar"]', cls: 0.02 },
  { name: 'benchmarks section', url: '/?section=benchmarks', ready: '[data-testid="entity-list-sidebar"]', cls: 0.02 },
  { name: 'notebook', url: '/notebook', ready: '.page-header', cls: 0.02 },
  /*
   * Higher than the rest, and honestly so: the callable table renders its rows
   * after two requests per callable, and the config sections below it move
   * down when they arrive. That is one shift on first load, not a loop, and
   * the late-shift assertion is what holds the line on the loop.
   */
  { name: 'connect', url: '/connect', ready: '.page-measure', cls: 0.05 },
  { name: 'tools', url: '/tools', ready: '.page .card', cls: 0.01 },
];

for (const screen of SCREENS) {
  test(`@perf ${screen.name} loads without moving`, async ({ page }) => {
    test.setTimeout(60_000);
    await mockEntityApi(page);
    await observeShifts(page);
    // Wide enough that the sidebars and a work area all have room; a narrow
    // viewport wraps rows and shifts for reasons the layout is not to blame for.
    await page.setViewportSize({ width: 1600, height: 950 });

    await page.goto(screen.url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(screen.ready);
    await page.waitForTimeout(SETTLE_MS + 1_500);

    const shifts = (await page.evaluate(() => (window as unknown as { __shifts: Shift[] }).__shifts))
      .filter((shift) => shift.value > NOISE);
    const cls = shifts.reduce((total, shift) => total + shift.value, 0);
    const late = shifts.filter((shift) => shift.time > SETTLE_MS);

    console.log(`${screen.name}: cls=${cls.toFixed(4)} shifts=${shifts.length} late=${late.length}`);

    expect(late, `nothing may move after ${SETTLE_MS}ms:\n${report(late)}`).toHaveLength(0);
    expect(cls, `layout shift during load:\n${report(shifts)}`).toBeLessThan(screen.cls);
  });
}
