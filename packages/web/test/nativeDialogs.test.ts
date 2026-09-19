/**
 * No `alert`, `confirm` or `prompt`.
 *
 * A browser stops showing them once someone ticks "prevent this page from
 * creating additional dialogs", and it never says so: `prompt` then answers
 * null and `confirm` answers false, so the feature behind them does nothing,
 * silently, for the rest of that page's life. That is not a hypothetical — it
 * is how renaming an argument set was reported as "doesn't work", and the same
 * two panels used `confirm` to guard a delete, where a suppressed dialog
 * refuses every delete instead.
 *
 * They are also untestable in the app's own suite, unstyleable, and outside the
 * focus trap the rest of the UI is built on. The app has `AlertDialog` for a
 * question and `toast` for a message; both are in the DOM, so both can be
 * asserted on.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';

const SRC = resolve(import.meta.dirname, '../src');

/** `window.confirm(`, `confirm(`, `globalThis.alert(` — the call, not the word. */
const CALL = /(?:^|[^.\w$])(?:(?:window|globalThis)\s*\.\s*)?(alert|confirm|prompt)\s*\(/;

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return files(path);
    return /\.(vue|ts)$/.test(entry.name) ? [path] : [];
  });

describe('native browser dialogs', () => {
  it('are not used anywhere in the app', () => {
    const offenders: string[] = [];
    for (const path of files(SRC)) {
      const name = relative(SRC, path).split(/[\\/]/).join('/');
      readFileSync(path, 'utf8').split('\n').forEach((line, index) => {
        // Comments explain why they are gone; they are not uses.
        const code = line.replace(/\/\/.*$/, '').replace(/\*.*$/, '');
        if (CALL.test(code)) offenders.push(`${name}:${index + 1} ${line.trim()}`);
      });
    }
    expect(offenders, 'use AlertDialog for a question and toast for a message').toEqual([]);
  });
});
