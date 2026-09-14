/**
 * Interaction-latency measurement for "how long until the thing I clicked is
 * actually on screen".
 *
 * Two independent clocks are recorded because they answer different questions:
 *
 *  - Event Timing (`inputDelay` / `processing` / `presentation`) is the INP
 *    breakdown for the click itself. It tells you whether the main thread was
 *    already busy when the click landed, and how long the handler ran. Chrome
 *    only reports these for TRUSTED events, which is why every measurement
 *    must go through a real Playwright click, never `el.click()` in-page.
 *
 *  - `timeToVisible` is click timestamp -> the first animation frame on which
 *    the target element has a non-zero box. This is the number a user feels,
 *    and it keeps counting through async work (dynamic imports, a second
 *    `await`, a deferred mount) that Event Timing stops measuring as soon as
 *    the handler returns.
 *
 * A slow interaction with a small `processing` but a large `timeToVisible` is
 * waiting on something async. A large `processing` is doing too much work
 * synchronously in the handler. The gap between the two is the diagnosis.
 */
import type { Page } from '@playwright/test';

export type Sample = {
  /** Event Timing: click -> handler start. High = main thread was busy. */
  inputDelay: number;
  /** Event Timing: handler duration. */
  processing: number;
  /** Event Timing: handler end -> next paint. */
  presentation: number;
  /** Event Timing total (`duration`), i.e. the INP value for this click. */
  eventTotal: number;
  /**
   * Click -> first frame the target element is actually laid out.
   *
   * NEGATIVE when the target was already on screen before the click, which is
   * the normal case for a `settleWhen` interaction that re-renders something
   * already mounted (a toggle over a loaded table). Nothing gates on this
   * field; `timeToSettled` is the number that means anything there.
   */
  timeToVisible: number;
  /** Sum of (longtask - 50ms) between click and visible. */
  blockingTime: number;
  /** Longest single main-thread task in that window. */
  longestTask: number;
  /**
   * Click -> every CSS animation in the opened subtree has finished. This is
   * the number that tracks perception: `timeToVisible` fires when the element
   * gets a layout box, which is the START of a 300ms slide-in, not the end.
   */
  timeToSettled: number;
  /** Frames rendered between click and settled. */
  frames: number;
  /** Longest gap between consecutive frames during the transition. */
  worstFrameGap: number;
  /** Frames that took >32ms (i.e. dropped at least one 60Hz frame). */
  jankyFrames: number;
};

declare global {
  interface Window {
    __perf: {
      clickAt: number | null;
      visibleAt: number | null;
      settledAt: number | null;
      frameTimes: number[];
      longtasks: Array<{ start: number; duration: number }>;
      events: Array<{
        startTime: number;
        processingStart: number;
        processingEnd: number;
        duration: number;
      }>;
      watch: (selector: string, settleRoot: string, settleWhen?: string) => void;
    };
  }
}

/**
 * Installs the observers once per page load. Safe to call repeatedly.
 */
export async function installPerfProbe(page: Page) {
  await page.evaluate(() => {
    if (window.__perf) return;

    const perf: Window['__perf'] = {
      clickAt: null,
      visibleAt: null,
      settledAt: null,
      frameTimes: [],
      longtasks: [],
      events: [],
      watch: () => {},
    };

    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        perf.longtasks.push({ start: e.startTime, duration: e.duration });
      }
    }).observe({ type: 'longtask', buffered: true });

    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as PerformanceEventTiming[]) {
        if (e.name !== 'click') continue;
        perf.events.push({
          startTime: e.startTime,
          processingStart: e.processingStart,
          processingEnd: e.processingEnd,
          duration: e.duration,
        });
      }
      // `durationThreshold: 0` still floors at 16ms in some Chrome versions;
      // that only truncates the cheap end, which we do not gate on.
    }).observe({ type: 'event', durationThreshold: 0, buffered: true } as PerformanceObserverInit);

    perf.watch = (selector: string, settleRoot: string, settleWhen?: string) => {
      perf.clickAt = performance.now();
      perf.visibleAt = null;
      perf.settledAt = null;
      perf.frameTimes.length = 0;
      perf.longtasks.length = 0;
      perf.events.length = 0;

      let settleStarted = false;

      const tick = () => {
        perf.frameTimes.push(performance.now());

        const el = document.querySelector(selector) as HTMLElement | null;
        if (perf.visibleAt === null && el && el.getBoundingClientRect().height > 0) {
          perf.visibleAt = performance.now();
        }

        /*
         * A render-shaped interaction has no animation to wait for, and the
         * animation clock would settle it instantly: with no animations in the
         * subtree, `settledAt` collapses to `visibleAt`, which fires as soon as
         * the container has a box — i.e. after the FIRST row paints, not the
         * last. `settleWhen` names the DOM condition that means finished
         * instead, and is polled every frame until it holds.
         */
        if (settleWhen && perf.settledAt === null) {
          let done = false;
          try {
            done = Boolean(new Function(`return (${settleWhen})`)());
          } catch {
            // A predicate that throws on an intermediate DOM is not settled
            // yet; it is only a failure if it never stops throwing, which the
            // caller's timeout catches.
            done = false;
          }
          if (done) {
            perf.settledAt = performance.now();
            return;
          }
          requestAnimationFrame(tick);
          return;
        }

        if (perf.visibleAt !== null && !settleStarted) {
          settleStarted = true;
          const root = document.querySelector(settleRoot);
          // getAnimations({subtree}) covers the backdrop fade AND the container
          // slide, which are separate elements with different durations.
          const anims = (root ? (root as Element).getAnimations({ subtree: true }) : []).filter(
            (a) => {
              // Infinite animations (loading spinners) never resolve `finished`
              // and would hang the probe forever.
              const iterations = a.effect?.getTiming().iterations ?? 1;
              return Number.isFinite(iterations);
            }
          );
          if (anims.length === 0) {
            perf.settledAt = perf.visibleAt;
          } else {
            Promise.allSettled(anims.map((a) => a.finished)).then(() => {
              perf.settledAt = performance.now();
            });
          }
        }

        if (perf.settledAt !== null) return;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };

    window.__perf = perf;
  });
}

/**
 * Clicks `trigger` and measures how long until `appears` is on screen.
 *
 * `watch()` is armed in a separate round trip before the click so the rAF loop
 * is already running when the event lands; the extra CDP round trip happens
 * BEFORE the click timestamp is taken, so it does not inflate the result.
 */
export async function measureOpen(
  page: Page,
  opts: {
    trigger: string;
    appears: string;
    settleRoot?: string;
    settleWhen?: string;
    timeout?: number;
  }
): Promise<Sample> {
  await installPerfProbe(page);
  const settleRoot = opts.settleRoot ?? opts.appears;
  await page.evaluate(
    ([sel, root, when]) => window.__perf.watch(sel!, root!, when ?? undefined),
    [opts.appears, settleRoot, opts.settleWhen ?? null] as const
  );

  await page.locator(opts.trigger).first().click();

  await page.waitForFunction(
    () => window.__perf.settledAt !== null && window.__perf.events.length > 0,
    undefined,
    { timeout: opts.timeout ?? 15000 }
  );

  return page.evaluate(() => {
    const p = window.__perf;
    // The click that opened the panel is the last one recorded; earlier
    // entries would only exist if the harness double-fired.
    const ev = p.events[p.events.length - 1]!;
    const visibleAt = p.visibleAt!;
    const settledAt = p.settledAt!;
    const window_ = p.longtasks.filter(
      (t) => t.start + t.duration >= ev.startTime && t.start <= settledAt
    );

    const gaps = p.frameTimes
      .slice(1)
      .map((t, i) => t - p.frameTimes[i]!)
      .filter((g) => g > 0);

    return {
      inputDelay: ev.processingStart - ev.startTime,
      processing: ev.processingEnd - ev.processingStart,
      presentation: ev.startTime + ev.duration - ev.processingEnd,
      eventTotal: ev.duration,
      timeToVisible: visibleAt - ev.startTime,
      timeToSettled: settledAt - ev.startTime,
      frames: p.frameTimes.length,
      worstFrameGap: gaps.length ? Math.max(...gaps) : 0,
      jankyFrames: gaps.filter((g) => g > 32).length,
      blockingTime: window_.reduce((sum, t) => sum + Math.max(0, t.duration - 50), 0),
      longestTask: window_.reduce((max, t) => Math.max(max, t.duration), 0),
    };
  });
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function summarise(samples: Sample[]) {
  const key = (k: keyof Sample) => median(samples.map((s) => s[k]));
  return {
    inputDelay: key('inputDelay'),
    processing: key('processing'),
    presentation: key('presentation'),
    eventTotal: key('eventTotal'),
    timeToVisible: key('timeToVisible'),
    timeToSettled: key('timeToSettled'),
    frames: key('frames'),
    worstFrameGap: key('worstFrameGap'),
    jankyFrames: key('jankyFrames'),
    blockingTime: key('blockingTime'),
    longestTask: key('longestTask'),
  };
}
