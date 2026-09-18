/**
 * The section overviews and the documentation they point at.
 *
 * A section with nothing open shows what the section holds and links the
 * heading in `docs/concepts.md` that defines it. The link is written by hand,
 * in a file that ships separately from the docs, so this checks each anchor
 * against the headings that file actually has — a renamed heading is otherwise
 * a dead link nobody sees until they click it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LIST_SECTIONS, SECTION_DEFINITIONS } from '@/lib/sections';
import { conceptsDocUrl } from '@/lib/docs';

const CONCEPTS = resolve(import.meta.dirname, '../../../../docs/concepts.md');

/** GitHub's heading anchors: lower case, spaces to hyphens, punctuation dropped. */
function slug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-');
}

const anchors = new Set(
  readFileSync(CONCEPTS, 'utf8')
    .split('\n')
    .filter((line) => /^#{2,3} /.test(line))
    .map((line) => slug(line.replace(/^#+\s*/, ''))),
);

describe('section overviews', () => {
  it.each(LIST_SECTIONS)('%s says what it holds', (section) => {
    const definition = SECTION_DEFINITIONS[section];
    expect(definition.blurb.length).toBeGreaterThan(40);
    expect(definition.blurb.endsWith('.')).toBe(true);
  });

  it.each(LIST_SECTIONS)('%s links a heading that exists in docs/concepts.md', (section) => {
    expect(anchors).toContain(SECTION_DEFINITIONS[section].docsAnchor);
  });

  it('links the Parameters heading the arguments tab points at', () => {
    expect(anchors).toContain('parameters');
    expect(conceptsDocUrl('parameters')).toBe(
      'https://github.com/recalcitrantsupplant/sqlib/blob/main/docs/concepts.md#parameters',
    );
  });
});
