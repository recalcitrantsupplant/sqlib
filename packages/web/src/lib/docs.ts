/**
 * Links into the project's own documentation.
 *
 * The web package ships separately from the docs, so the app links the copy on
 * the default branch rather than bundling it. One place to change when the docs
 * move, and one place that knows an anchor is a heading in `docs/concepts.md`.
 */
const CONCEPTS_URL = 'https://github.com/recalcitrantsupplant/sqlib/blob/main/docs/concepts.md';

/** `anchor` is a GitHub heading anchor within `docs/concepts.md`, without the `#`. */
export function conceptsDocUrl(anchor: string): string {
  return `${CONCEPTS_URL}#${anchor}`;
}
