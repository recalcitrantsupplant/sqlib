/**
 * Bundle `editor/editor.js` — CodeMirror and the RDF grammars — into one IIFE
 * the Views inline as `<!--@kit:editor-->`.
 *
 * Written into `src/kit` so `renderView` finds it from source under tsx exactly
 * as it does from `dist`, and gitignored there: it is a build output, a few
 * hundred kilobytes of other people's code, and regenerated on every build.
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

await build({
  entryPoints: [`${root}editor/editor.js`],
  outfile: `${root}src/kit/editor.bundle.js`,
  bundle: true,
  format: 'iife',
  minify: true,
  target: 'es2020',
  legalComments: 'none',
  // Inlined into a `<script>` element, where a literal `</script>` in any
  // bundled string would end the element early.
  banner: { js: '/* CodeMirror 6 (MIT), @kurrawongai/codemirror-lang-* — bundled for sqlib Views */' },
  logLevel: 'warning',
});
