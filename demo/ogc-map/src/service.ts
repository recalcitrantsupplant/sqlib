/**
 * Which OGC API Features service the page reads, and the URLs it asks for.
 * No DOM and no map here, so the tests run in Node.
 */

/** `config.json` beside the page. */
export interface MapConfig {
  /** The library slug whose service the page opens when no `url` is given. */
  service?: string;
}

/** `config.json` of the web app, one directory up. */
export interface AppConfig {
  /** A URL, or `browser` when the API runs in a Worker in the tab. */
  apiBaseUrl?: string;
}

export type ServiceSource =
  | { kind: 'url'; url: string }
  | { kind: 'api'; apiBaseUrl: string; url: string }
  | { kind: 'browser'; url: string };

/**
 * The service to open.
 *
 * 1. `?url=` names any landing page, on any server. A URL under `../api`
 *    uses the API in this tab when the app's API is `browser`.
 * 2. Else `service` from the page's config, under the app's API: a URL, or
 *    `browser` for the API in this tab, served under `../api`.
 */
export function resolveService(pageUrl: string, mapConfig: MapConfig | null, appConfig: AppConfig | null): ServiceSource | null {
  const page = new URL(pageUrl);
  const api = appConfig?.apiBaseUrl?.trim();
  const tabApi = new URL('../api', page).href;
  const explicit = page.searchParams.get('url')?.trim();
  if (explicit) {
    const url = new URL(explicit, page).href;
    if (api === 'browser' && (url === tabApi || url.startsWith(`${tabApi}/`))) return { kind: 'browser', url };
    return { kind: 'url', url };
  }
  const slug = page.searchParams.get('service')?.trim() || mapConfig?.service;
  if (!slug || !api) return null;
  if (api === 'browser') return { kind: 'browser', url: `${tabApi}/ogc/${encodeURIComponent(slug)}` };
  return { kind: 'api', apiBaseUrl: api, url: `${api.replace(/\/+$/, '')}/ogc/${encodeURIComponent(slug)}` };
}

export interface Link {
  rel: string;
  href: string;
  type?: string;
}

/** The href of the first link with this relation, resolved against the document's URL. */
export function linkHref(links: Link[] | undefined, rel: string, base: string): string | null {
  const link = links?.find(l => l.rel === rel);
  return link ? new URL(link.href, base).href : null;
}

/**
 * The items URL with the queryable values added. A blank value is left out.
 * Each value goes through `URLSearchParams`, so it is encoded once.
 */
export function withQueryables(itemsUrl: string, values: Record<string, string>): string {
  const url = new URL(itemsUrl);
  for (const [name, value] of Object.entries(values)) {
    const trimmed = value.trim();
    if (trimmed) url.searchParams.set(name, trimmed);
    else url.searchParams.delete(name);
  }
  return url.href;
}

/** The collection's SPARQL link with the query parameters of an items URL. */
export function sparqlUrl(sparqlHref: string, itemsUrl: string): string {
  const url = new URL(sparqlHref);
  url.search = new URL(itemsUrl).search;
  return url.href;
}

/** `first–last of total` for a page, or `first–last` when the total is not known. */
export function pageRange(offset: number, returned: number, matched: number | undefined): string {
  if (returned === 0) return matched === undefined ? '0' : `0 of ${matched}`;
  const range = `${offset + 1}–${offset + returned}`;
  return matched === undefined ? range : `${range} of ${matched}`;
}

/** The `offset` of an items URL, 0 when it has none. */
export function offsetOf(itemsUrl: string): number {
  const value = Number(new URL(itemsUrl).searchParams.get('offset') ?? 0);
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

/** A short label for a feature: its `name` or `title` property, else its id. */
export function featureLabel(feature: { id?: string | number; properties?: Record<string, unknown> | null }): string {
  const props = feature.properties ?? {};
  for (const key of ['name', 'title', 'label']) {
    const value = props[key];
    if (typeof value === 'string' && value) return value;
  }
  const id = String(feature.id ?? '');
  return id.replace(/^.*[/#]/, '') || id;
}

/**
 * A collection's bbox as `[minx, miny, maxx, maxy]`. It reads the standard
 * `extent.spatial.bbox[0]` of the collection document, and a flat array too.
 */
export function extentOf(info: { extent?: unknown }): [number, number, number, number] | null {
  const extent = info.extent as { spatial?: { bbox?: unknown[] } } | unknown[] | undefined;
  const box = Array.isArray(extent) ? extent : extent?.spatial?.bbox?.[0];
  if (!Array.isArray(box) || box.length < 4) return null;
  const numbers = box.length === 6 ? [box[0], box[1], box[3], box[4]] : box.slice(0, 4);
  return numbers.every(n => typeof n === 'number' && Number.isFinite(n)) ? (numbers as [number, number, number, number]) : null;
}
