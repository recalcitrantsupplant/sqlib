/*
 * The port the e2e preview server binds, shared by playwright.config.ts, the
 * `preview` npm script and any spec that asserts on the URL.
 *
 * It is configurable because CI runs on a self-hosted runner that shares a
 * machine with local development. A local `just run-frontend` on 3001 made the
 * runner's e2e job fail with "port 3001 is already used". CI therefore sets
 * WEB_PORT to a port nobody types by hand (see scripts/ci/e2e.sh); local runs
 * keep 3001 so nothing about the day-to-day workflow changes.
 */
export const WEB_PORT = Number(process.env.WEB_PORT ?? 3001);
export const WEB_BASE_URL = `http://localhost:${WEB_PORT}`;
