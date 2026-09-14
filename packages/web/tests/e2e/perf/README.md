# Interaction performance

Measures how long a panel takes to open and whether it opens *smoothly*, and
fails the build when either regresses. `layout-shift.spec.ts` covers the other
half — what a screen does with no click at all.

```bash
pnpm --filter @sparql-query-lib/web test:perf          # assert budgets
pnpm --filter @sparql-query-lib/web test:perf:report   # print numbers, assert nothing
```

Perf specs are tagged `@perf` and excluded from `test:e2e` / `test:e2e:ci`,
because they are slow and their numbers depend on machine speed.

## Why "how long did the click take" was the wrong question

The obvious metric — click to element on screen — said the editor overlay
opened in 35ms, which contradicted it visibly feeling slower than the sidebar
dialogs. The metric was wrong: an element gets a layout box at the *start* of
its 300ms slide-in animation, so the measurement stopped before the part the
user was actually watching.

`timeToSettled` (click until every CSS animation in the subtree has finished)
plus `jankyFrames` (frames over 32ms in that window) reproduced the complaint
immediately:

| interaction | settled | janky frames |
| --- | --- | --- |
| sidebar Add Library dialog | 240ms | 1 |
| editor focus overlay (before) | 353ms | 9 |

Same order of magnitude in duration, but the overlay rendered 14 frames where
removing the blur rendered 23 over the same span — it was animating at roughly
half framerate. That stutter was the "clunk", and no duration-only metric
would have caught it.

## Metrics

Recorded per click by `measure.ts`:

| field | meaning |
| --- | --- |
| `inputDelay` / `processing` / `presentation` | Event Timing breakdown — the INP value for the click |
| `timeToVisible` | click to the target having a layout box |
| `timeToSettled` | click to all animations in the subtree finishing |
| `frames` / `worstFrameGap` / `jankyFrames` | frame health during the open |
| `blockingTime` / `longestTask` | main-thread long tasks in the window |

Reading them together is what localises a problem: high `processing` is too
much synchronous work in the handler; low `processing` with high
`timeToSettled` is animation or async work; low `processing` with high
`jankyFrames` is expensive paint/compositing, which is what
`backdrop-filter` was doing.

Event Timing only fires for **trusted** events, so every measurement goes
through a real Playwright click. `el.click()` from `page.evaluate` silently
produces no entry.

## Methodology

- The first (cold) open is always discarded; budgets assert the **median** of
  the warm repeats. Single samples are far too noisy to gate on.
- Setup runs unthrottled and only the measured click runs at `PERF_CPU`
  (default 4x), so page load cost never leaks into the measurement.
- Budgets carry roughly 2x headroom over measured values. They are tripwires
  for "someone made this much worse", not precise targets.

## Environment variables

| var | default | purpose |
| --- | --- | --- |
| `PERF_BASE` | `http://localhost:3001` | server to measure |
| `PERF_CPU` | `4` | CDP CPU throttle multiplier |
| `PERF_REPEATS` | `7` | opens per interaction |

## Specs

- `budget.spec.ts` — the guard. Asserts `timeToSettled`, `jankyFrames` and
  `processing` per interaction in `interactions.ts`.
- `layout-shift.spec.ts` — the other guard: per-screen CLS budgets for the
  load, plus "nothing may move after 2s". See below.
- `diagnose.spec.ts` — prints cold vs warm for every interaction.
- `ablation.spec.ts` — re-measures the overlay with CSS overrides injected, to
  attribute cost to a specific property.
- `loaded.spec.ts` — scales result rows and query size to test whether cost
  grows with content.

## Adding an interaction

Append to `interactions.ts`. `reset` must return the app to the pre-click
state so the open can be repeated, and `settleRoot` should be the outermost
animating element (the backdrop and the container animate separately with
different durations).

## Was it the dev server?

No — checked first, since Vite compiles dynamic imports on demand and that
inflates first-open timings. Dev and the production build measured within
noise of each other, so the cost was real application behaviour.

## Layout shift

`layout-shift.spec.ts` loads each screen, moves nothing, and watches. It
asserts two things per screen:

- **CLS for the load** against a per-screen budget. Content arriving and
  pushing what is on screen out of the way. Every screen is far below the 0.1
  that counts as "good"; the budgets are there to keep it that way, and each
  carries roughly 2x headroom over the measured value.
- **Nothing moves after 2s.** A screen still relaying itself out two seconds
  in is not loading, it is looping — and a total-only metric hides that, since
  one big first-load shift and a small one repeating forever can add up the
  same.

The late-shift assertion is the one that earns its keep. Build measured CLS
0.14 with shifts still arriving every second for as long as the tab stayed
open: the change feed reconnected once a second against a server that ended
the stream immediately, each reconnect reloaded the callable list, and
`loading` swapped the whole table for a one-line message and back. Nothing
else in the suite could see it.

Failures print the moved elements and their before/after rectangles, taken
from the `sources` of each `layout-shift` entry, which is usually enough to
identify the cause without reproducing by hand.

Two things it deliberately does not do: it never clicks (shifts within 500ms
of a real interaction are the interaction, not a fault, and the browser
excludes them from CLS anyway), and it runs unthrottled, because a shift is
geometry rather than timing and does not need a slow CPU to show up.
