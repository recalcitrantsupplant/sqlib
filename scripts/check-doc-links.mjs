#!/usr/bin/env node
/**
 * Every relative markdown link resolves to a file that exists.
 *
 * The documentation was consolidated from a dated journal whose pages linked to
 * each other by filename. Renaming and merging those pages breaks links
 * silently: a reader finds out, CI does not. This is the cheapest check that
 * would have caught it, and it runs in the lint step.
 *
 * Scope: markdown files tracked in the repository, minus node_modules and build
 * output. Absolute URLs, mailto:, and in-page anchors are not this script's
 * business. A link to a heading inside another file (`page.md#section`) is
 * checked as far as the file.
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO_ROOT = resolve(import.meta.dirname, '..');

/** Markdown links: [text](target), excluding image embeds and reference defs. */
const LINK = /(?<!!)\[[^\]]*\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g;

const files = execFileSync('git', ['ls-files', '*.md'], { cwd: REPO_ROOT, encoding: 'utf8' })
  .split('\n')
  .filter((line) => line && !line.includes('node_modules/'));

let broken = 0;
let checked = 0;

for (const file of files) {
  const abs = join(REPO_ROOT, file);
  if (!existsSync(abs)) continue;
  const text = readFileSync(abs, 'utf8');
  for (const match of text.matchAll(LINK)) {
    const target = match[1];
    // Not ours to resolve: absolute URLs, protocol-relative, mail, anchors.
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    if (target.startsWith('//') || target.startsWith('#')) continue;
    const [path] = target.split('#');
    if (!path) continue;
    checked += 1;
    const resolved = path.startsWith('/')
      ? join(REPO_ROOT, path.slice(1))
      : resolve(dirname(abs), path);
    if (!existsSync(resolved)) {
      console.error(`${file}: broken link -> ${target}`);
      broken += 1;
      continue;
    }
    // A link to a directory is only good if something will render there.
    if (statSync(resolved).isDirectory() && !existsSync(join(resolved, 'README.md'))) {
      console.error(`${file}: link to a directory with no README.md -> ${target}`);
      broken += 1;
    }
  }
}

if (checked === 0) {
  // Same rule the other guards follow: a check that measured nothing has not
  // passed, it has failed to run.
  console.error('check-doc-links: no relative links found in any markdown file');
  console.error('that is not plausible for this repository — the check is broken');
  process.exit(1);
}

if (broken > 0) {
  console.error(`\ncheck-doc-links: ${broken} broken link(s) across ${files.length} files`);
  process.exit(1);
}

console.log(`check-doc-links: ${checked} relative links across ${files.length} markdown files all resolve`);
