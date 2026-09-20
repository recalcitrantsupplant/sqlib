/**
 * `tsc` emits the JavaScript; the Views are not JavaScript.
 *
 * `renderView` resolves `./views/*.html` and `./kit/*` relative to its own
 * module URL, so the same code works from `src` under tsx and from `dist` in a
 * container — provided the assets sit beside the built module, which is what
 * this copies.
 */
import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

await mkdir(`${root}dist`, { recursive: true });
for (const directory of ['views', 'kit']) {
  await cp(`${root}src/${directory}`, `${root}dist/${directory}`, { recursive: true });
}
