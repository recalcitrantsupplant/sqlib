/**
 * Traces that do not ship.
 *
 * The app was written with `console.log`, which is how anyone writes a
 * composable, and the logs stayed. That is not a tidiness question: the calls
 * are unconditional, so they run in the built app on a stranger's machine —
 * `useApiClient` narrated every request and every response, with the payload,
 * and `buildVersionCreatePayload` printed the whole execution-node list on
 * every save of a query group. The cost is three things at once. The console
 * is where a *user* looks when something has gone wrong, and a page that
 * prints forty lines a minute has nothing legible left in it. The values
 * printed are the library's own — query text, argument terms, backend URLs,
 * concurrency tokens — and a console line is a thing screenshots and support
 * threads carry.
 *
 * So a trace goes through here instead, and here is silent unless the app is
 * being developed. Vite substitutes `process.env.NODE_ENV` at build time, so
 * `debugEnabled` compiles to `() => false` in the production bundle and the
 * console call below is a branch that is never taken. What it is not is
 * *gone*: the message and its detail are arguments, so they are still built at
 * the call site. That is why the trace is kept to what a caller already holds —
 * a URL, a status, an object it was passing anyway — and why a call that has to
 * compute something to say it does not belong here.
 *
 * `console.debug` rather than `console.log` is the second half of it: the
 * browser's own verbose level, which Chrome and Firefox hide by default, so
 * even in dev a trace is something you opt into seeing rather than something
 * that buries the error beside it.
 *
 * What still belongs at `console.warn` / `console.error` is unchanged and is
 * deliberately not routed through here: a warning names something the user's
 * own console should carry, and an error is the last record of a failure
 * whoever is looking has already been handed. Those are for the built app.
 * Only the running commentary is not.
 */

/**
 * Whether traces are live. Read at call time rather than captured at module
 * load, so a test can turn it on for the case that proves the channel speaks.
 *
 * `development` rather than `!== 'production'`, which is the narrower of the
 * two readings and the one that matters: under vitest `NODE_ENV` is `test`,
 * and a unit suite that prints its subject's commentary is a suite nobody
 * reads the failures of.
 */
export const debugEnabled = (): boolean => process.env.NODE_ENV === 'development';

/**
 * One trace. `scope` is the module speaking — the `[useApiClient]` the call
 * sites already wrote by hand — and `detail` is whatever it wants to show.
 *
 * The detail argument is passed to the console rather than interpolated, so
 * an object arrives as an inspectable object and, when traces are off, is
 * never serialised at all.
 */
export function debug(scope: string, message: string, detail?: unknown): void {
  if (!debugEnabled()) return;
  if (detail === undefined) {
    console.debug(`[${scope}] ${message}`);
  } else {
    console.debug(`[${scope}] ${message}`, detail);
  }
}
