/*
 * The API origin the e2e build talks to, shared by the Playwright config and
 * every spec that mocks a route by URL.
 *
 * No API server runs in e2e — Playwright answers at the network layer — but a
 * request a spec forgot to mock still goes to this address. At :3000 it landed
 * on whatever dev API was running on the same machine (the self-hosted runner
 * shares one with local development, which uses 3000–3015), and a live
 * `/events` stream held open there timed out every spec waiting on
 * `networkidle`. So e2e builds point at a port nobody reaches for by hand,
 * where nothing answers; see scripts/ci/e2e.sh for the web port's twin.
 */
export const API_BASE_URL = process.env.NUXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3702';
export const API_ORIGIN = new URL(API_BASE_URL).origin;
/** `host:port`, for the glob route patterns specs write against the API. */
export const API_HOST = new URL(API_BASE_URL).host;
