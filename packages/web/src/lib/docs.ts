/**
 * Links into the project's own documentation.
 *
 * The web package ships separately from the docs, so the app links the copy on
 * the default branch rather than bundling it. One place to change when the docs
 * move, and one place that knows an anchor is a heading in `docs/concepts.md`.
 */
export const REPO_URL = 'https://github.com/recalcitrantsupplant/sqlib';

/** The docs tree on the default branch, which is where the docs live. */
export const DOCS_URL = `${REPO_URL}/tree/main/docs`;

const DOCS_ROOT = `${REPO_URL}/blob/main/docs`;
const CONCEPTS_URL = `${DOCS_ROOT}/concepts.md`;

/** `anchor` is a GitHub heading anchor within `docs/concepts.md`, without the `#`. */
export function conceptsDocUrl(anchor: string): string {
  return `${CONCEPTS_URL}#${anchor}`;
}

/** `path` is a file under `docs/`, such as `guides/mcp-app.md`. */
export function docUrl(path: string): string {
  return `${DOCS_ROOT}/${path}`;
}
