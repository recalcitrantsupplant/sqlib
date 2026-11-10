# Interaction performance

These specs measure how long a panel takes to open, and if it opens
*smoothly*. The build fails when either gets worse. `layout-shift.spec.ts`
measures what a screen does with no click.

```bash
pnpm --filter @sparql-query-lib/web test:perf          # assert budgets
pnpm --filter @sparql-query-lib/web test:perf:report   # print numbers, assert nothing
```

Perf specs have the tag `@perf`. `test:e2e` and `test:e2e:ci` do not run them,
because they are slow and their numbers change with machine speed.

## Why click duration was the wrong metric

The first metric was the time from click to element on screen. It said that
the editor overlay opened in 35ms. The overlay felt slower than the sidebar
dialogs. The metric stopped too early: an element gets a layout box at the
*start* of its 300ms slide-in animation, before the part that the user sees.

Two metrics together showed the problem immediately:

- `timeToSettled`: the time from the click until each CSS animation in the
  subtree is finished;
- `jankyFrames`: the frames over 32ms in that time.

| interaction | settled | janky frames |
| --- | --- | --- |
| sidebar Add Library dialog | 240ms | 1 |
| editor focus overlay (before) | 353ms | 9 |

The durations are of the same order. The overlay rendered 14 frames in that
time, and 23 with the blur removed. It animated at about half the frame rate.
That stutter was the problem, and a metric of duration only cannot find it.

## Metrics

`measure.ts` records these for each click:

| field | meaning |
| --- | --- |
| `inputDelay` / `processing` / `presentation` | Event Timing breakdown: the INP value for the click |
| `timeToVisible` | click to the target having a layout box |
| `timeToSettled` | click to all animations in the subtree finishing |
| `frames` / `worstFrameGap` / `jankyFrames` | frame health during the open |
| `blockingTime` / `longestTask` | main-thread long tasks in the window |

Read them together to find the cause:

- High `processing`: too much synchronous work in the handler.
- Low `processing` and high `timeToSettled`: animation or async work.
- Low `processing` and high `jankyFrames`: expensive paint or compositing. The
  overlay had this, from `backdrop-filter`.

Event Timing records **trusted** events only. Each measurement therefore uses
a real Playwright click. `el.click()` from `page.evaluate` gives no entry, and
no error.

## Method

- The specs discard the first (cold) open. Budgets assert the **median** of
  the warm repeats. One sample has too much noise for a gate.
- Setup runs with no throttle. Only the measured click runs at `PERF_CPU`
  (default 4x), so the cost of the page load is not in the measurement.
- Each budget is about 2x the measured value. A budget detects a large
  regression. It is not a precise target.

## Environment variables

| var | default | purpose |
| --- | --- | --- |
| `PERF_BASE` | `http://localhost:3001` | server to measure |
| `PERF_CPU` | `4` | CDP CPU throttle multiplier |
| `PERF_REPEATS` | `7` | opens per interaction |

## Specs

- `budget.spec.ts`: the gate for clicks. It asserts `timeToSettled`,
  `jankyFrames` and `processing` for each interaction in `interactions.ts`.
- `layout-shift.spec.ts`: the gate for loads. It asserts a CLS budget for each
  screen, and that nothing moves after 2s. See [Layout shift](#layout-shift).
- `diagnose.spec.ts`: prints cold and warm values for each interaction.
- `ablation.spec.ts`: measures the overlay again with CSS overrides, to find
  the property that causes a cost.
- `loaded.spec.ts`: increases the result rows and the query size, to test if
  the cost increases with content.

## Adding an interaction

Add it to `interactions.ts`:

- `reset` must put the app back in the state before the click, so the open can
  repeat.
- `settleRoot` must be the outermost element that animates. The backdrop and
  the container animate separately, with different durations.

## The dev server is not the cause

Vite compiles dynamic imports on demand, and this makes the first open slower.
We measured the dev server and the production build first. The values were the
same, within noise. The cost was in the application.

## Layout shift

`layout-shift.spec.ts` loads each screen, does nothing, and watches. It asserts
two things for each screen:

- **CLS for the load**, against a budget for the screen. This measures content
  that arrives and pushes other content away. Each screen is far below 0.1, the
  limit for "good". The budgets keep it there, each at about 2x the measured
  value.
- **Nothing moves after 2s.** A screen that still changes its layout after two
  seconds is in a loop. A total metric does not show this. One large shift at
  load and a small shift that repeats can give the same total.

The second assertion found a real fault. The Build screen measured CLS 0.14,
with a new shift each second while the tab was open:

1. The change feed connected again each second, because the server ended the
   stream immediately.
2. Each connection loaded the callable list again.
3. `loading` replaced the whole table with a one-line message, and then put
   the table back.

No other test in the suite found it.

A failure prints each element that moved, with its rectangles before and
after. These come from the `sources` of each `layout-shift` entry. They are
usually enough to find the cause with no manual reproduction.

The spec does not click. A shift within 500ms of a real interaction is part of
the interaction, and the browser does not count it in CLS. The spec also runs
with no throttle. A shift is a change of geometry, so a slow CPU is not
necessary to show it.
