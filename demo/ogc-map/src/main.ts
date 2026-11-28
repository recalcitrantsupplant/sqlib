/**
 * A map page for an OGC API Features service. `@camptocamp/ogc-client` reads
 * the landing page, the collections and their queryables. The page fetches
 * each items page itself and follows the `next` and `prev` links. MapLibre
 * draws the features from GeoJSON objects.
 *
 * Every request goes through `fetch` on the main thread, so the browser-only
 * build answers it from the API Worker in this tab (see
 * `packages/web/src/lib/browserApi.ts`). MapLibre fetches only the basemap.
 */
import { OgcApiEndpoint, type OgcApiCollectionInfo } from '@camptocamp/ogc-client';
import { Map as MapLibreMap, Popup, LngLatBounds, setWorkerUrl, type GeoJSONSource, type MapGeoJSONFeature, type StyleSpecification } from 'maplibre-gl';
import { installBrowserApi } from '../../../packages/web/src/lib/browserApi';
import { initInspect, showInspect } from './inspect';
import { extentOf, featureLabel, linkHref, offsetOf, pageRange, resolveService, sparqlUrl, withFacets, withQueryables, facetsOf, type Facet, type AppConfig, type Link, type MapConfig } from './service';

type Geometry = { type: string; coordinates?: unknown; geometries?: Geometry[] };
type Feature = { type: 'Feature'; id?: string | number; geometry: Geometry | null; properties: Record<string, unknown> | null };
type ItemsPage = { type: 'FeatureCollection'; features: Feature[]; links?: Link[]; numberMatched?: number; numberReturned?: number };

interface CollectionState {
  info: OgcApiCollectionInfo;
  colour: string;
  visible: boolean;
  values: Record<string, string>;
  inView: boolean;
  pageUrl: string | null;
  page: ItemsPage | null;
  error: string | null;
  sparqlHref: string | null;
  /** The collection's JSON-LD context, when it has one. */
  jsonLdContext: unknown;
  sparql: string | null;
  /** The collection's query as stored, read once. */
  template: string | null;
  facets: Facet[];
  chosen: Record<string, Array<string | number | boolean>>;
}

const PAGE_SIZE = 10;
const COLOURS = ['#2563eb', '#dc2626', '#059669', '#d97706', '#7c3aed', '#0891b2'];
const BASEMAP = 'https://tiles.openfreemap.org/styles/positron';
const BLANK: StyleSpecification = { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#f4f4f2' } }] };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node: HTMLElementTagNameMap[K] = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

const collections = new Map<string, CollectionState>();
let selected: string | null = null;
let endpoint: OgcApiEndpoint;
let map: MapLibreMap;
/** The API runs in this tab, so its URLs do not open in a new tab. */
let inTab = false;

async function readJson<T>(url: string | URL): Promise<T | null> {
  try {
    const response = await fetch(url);
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}

async function start(): Promise<void> {
  const page = window.location.href;
  const [mapConfig, appConfig] = await Promise.all([
    readJson<MapConfig>(new URL('config.json', page)),
    readJson<AppConfig>(new URL('../config.json', page)),
  ]);
  const source = resolveService(page, mapConfig, appConfig);
  const urlInput = $<HTMLInputElement>('service-url');
  $<HTMLFormElement>('service-form').onsubmit = event => {
    event.preventDefault();
    const next = new URL(window.location.href);
    next.searchParams.set('url', urlInput.value.trim());
    window.location.assign(next.href);
  };
  if (!source) {
    showStatus('No service. Enter the URL of an OGC API Features landing page.');
    return;
  }
  urlInput.value = source.url;
  if (source.kind === 'browser') {
    inTab = true;
    const api = installBrowserApi(new URL('../sqlib-api/', page).href, new URL('../api', page).href);
    showStatus('Loading…');
    await api.ready;
  }

  setWorkerUrl(new URL('map-worker.js', page).href);
  const basemap = new URL(page).searchParams.get('basemap') === 'none' ? BLANK : BASEMAP;
  map = new MapLibreMap({ container: 'map', style: basemap, center: [134, -26], zoom: 3, attributionControl: { compact: true } });
  const mapReady = new Promise<void>(resolve => map.once('load', () => resolve()));

  endpoint = new OgcApiEndpoint(source.url);
  try {
    const [info, ids] = await Promise.all([endpoint.info, endpoint.featureCollections]);
    $('service-title').textContent = info.title || source.url;
    document.title = info.title ? `${info.title} · Map` : 'Map';
    const infos = await Promise.all(ids.map(id => endpoint.getCollectionInfo(id)));
    // ogc-client drops the collection's links, so read them from the document.
    const docs = await Promise.all(ids.map(id => readJson<{ links?: Link[] }>(`${source.url.replace(/\/+$/, '')}/collections/${encodeURIComponent(id)}`)));
    // ogc-client keeps only each queryable's name and type, so read the values from the document.
    // A collection with JSON-LD terms links its context; the Result tab can show the page as GeoJSON-LD.
    const contexts = await Promise.all(docs.map(doc => {
      const href = linkHref(doc?.links, 'http://www.w3.org/ns/json-ld#context', source.url);
      return href ? readJson<{ '@context'?: unknown }>(href).then(body => body?.['@context'] ?? null) : Promise.resolve(null);
    }));
    const queryableDocs = await Promise.all(docs.map(doc => {
      const href = linkHref(doc?.links, 'http://www.opengis.net/def/rel/ogc/1.0/queryables', source.url);
      return href ? readJson<Parameters<typeof facetsOf>[0]>(href) : Promise.resolve(null);
    }));
    infos.forEach((info, index) => {
      collections.set(info.id, {
        info,
        colour: COLOURS[index % COLOURS.length],
        visible: true,
        values: {},
        inView: false,
        pageUrl: null,
        page: null,
        error: null,
        sparqlHref: linkHref(docs[index]?.links, 'describedby', source.url),
        jsonLdContext: contexts[index] ?? null,
        sparql: null,
        template: null,
        facets: facetsOf(queryableDocs[index] ?? null),
        chosen: {},
      });
    });
  } catch (error) {
    showStatus(`The service at ${source.url} could not be read: ${(error as Error).message}. Check the URL.`);
    return;
  }
  if (collections.size === 0) {
    showStatus('This service has no feature collections.');
    return;
  }
  showStatus(null);
  await mapReady;
  for (const state of collections.values()) addLayers(state);
  map.on('moveend', () => {
    for (const state of collections.values()) if (state.inView) void loadFirstPage(state);
  });
  fitToExtents();
  initInspect([...collections.values()].some(state => state.sparqlHref !== null), () => map.resize());
  selected = collections.keys().next().value ?? null;
  renderList();
  await Promise.all([...collections.values()].map(state => loadFirstPage(state)));
}

function showStatus(text: string | null): void {
  const status = $('status');
  status.hidden = text === null;
  status.textContent = text ?? '';
}

function addLayers(state: CollectionState): void {
  const id = state.info.id;
  // A feature with a `colour` or `color` property is drawn in that colour.
  const colour = ['to-color', ['get', 'colour'], ['get', 'color'], state.colour] as unknown as string;
  map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: `${id}-fill`, type: 'fill', source: id, filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': colour, 'fill-opacity': 0.25 } });
  map.addLayer({ id: `${id}-line`, type: 'line', source: id, filter: ['in', ['geometry-type'], ['literal', ['LineString', 'Polygon']]], paint: { 'line-color': colour, 'line-width': 3 } });
  map.addLayer({
    id: `${id}-point`, type: 'circle', source: id, filter: ['==', ['geometry-type'], 'Point'],
    paint: { 'circle-color': colour, 'circle-radius': 6, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 },
  });
  for (const layer of [`${id}-fill`, `${id}-line`, `${id}-point`]) {
    map.on('click', layer, event => showPopup(state, event.features?.[0], event.lngLat));
    map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
  }
}

function setVisible(state: CollectionState, visible: boolean): void {
  state.visible = visible;
  for (const suffix of ['fill', 'line', 'point']) map.setLayoutProperty(`${state.info.id}-${suffix}`, 'visibility', visible ? 'visible' : 'none');
}

function fitToExtents(): void {
  const bounds = new LngLatBounds();
  for (const state of collections.values()) {
    const box = extentOf(state.info);
    if (box) bounds.extend([[box[0], box[1]], [box[2], box[3]]]);
  }
  if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 40, duration: 0 });
}

async function loadFirstPage(state: CollectionState): Promise<void> {
  const b = map.getBounds();
  const url = await endpoint.getCollectionItemsUrl(state.info.id, {
    asJson: true,
    limit: PAGE_SIZE,
    ...(state.inView ? { extent: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] as [number, number, number, number] } : {}),
  });
  await loadPage(state, withFacets(withQueryables(url, state.values), state.chosen));
}

async function loadPage(state: CollectionState, url: string): Promise<void> {
  state.pageUrl = url;
  state.error = null;
  try {
    const response = await fetch(url, { headers: { accept: 'application/geo+json, application/json' } });
    const body = await response.json();
    if (!response.ok) throw new Error(body?.description ?? body?.message ?? `${response.status} ${response.statusText}`);
    state.page = body as ItemsPage;
  } catch (error) {
    state.page = null;
    state.error = (error as Error).message;
  }
  state.sparql = state.sparqlHref ? await readText(sparqlUrl(state.sparqlHref, url)) : null;
  if (state.sparqlHref && state.template === null) state.template = await readText(`${new URL(state.sparqlHref, url).href.replace(/\/$/, '')}/template`);
  (map.getSource(state.info.id) as GeoJSONSource).setData({ type: 'FeatureCollection', features: (state.page?.features ?? []) as never });
  renderPage();
}

function facetLabel(value: string | number | boolean): string {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  return String(value);
}

async function readText(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { headers: { accept: 'application/sparql-query' } });
    return response.ok ? await response.text() : null;
  } catch {
    return null;
  }
}

function showPopup(state: CollectionState, feature: MapGeoJSONFeature | Feature | undefined, at: [number, number] | { lng: number; lat: number }): void {
  if (!feature) return;
  const rows = Object.entries(feature.properties ?? {}).map(([key, value]) => el('tr', {}, el('th', {}, key), el('td', {}, String(value))));
  const body = el('div', { className: 'popup' }, el('div', { className: 'popup-title' }, featureLabel(feature as Feature)), el('div', { className: 'popup-collection' }, state.info.title), el('table', {}, ...rows));
  new Popup({ maxWidth: '280px' }).setLngLat(at).setDOMContent(body).addTo(map);
}

/** A point to put a popup on and a box to fly to, for any geometry. */
function placeOf(geometry: Geometry | null): { at: [number, number]; bounds: LngLatBounds } | null {
  const bounds = new LngLatBounds();
  const visit = (value: unknown): void => {
    if (Array.isArray(value) && typeof value[0] === 'number') bounds.extend([value[0], value[1] as number]);
    else if (Array.isArray(value)) value.forEach(visit);
  };
  const walk = (g: Geometry | null): void => {
    if (!g) return;
    if (g.geometries) g.geometries.forEach(walk);
    else visit(g.coordinates);
  };
  walk(geometry);
  if (bounds.isEmpty()) return null;
  const c = bounds.getCenter();
  return { at: [c.lng, c.lat], bounds };
}

/** Everything in the left panel: on a new service, or another collection selected. */
function renderList(): void {
  renderCollections();
  renderQueryables();
  renderFeatures();
}

/** After a page loads: the counts and the features. The queryables keep their focus. */
function renderPage(): void {
  renderCollections();
  renderFeatures();
}

function select(id: string): void {
  if (selected === id) return;
  selected = id;
  renderList();
}

function current(): CollectionState | undefined {
  return selected === null ? undefined : collections.get(selected);
}

function renderCollections(): void {
  $('collections-section').hidden = collections.size === 0;
  $('collections').replaceChildren(...[...collections.values()].map(state => renderCollection(state)));
}

function renderCollection(state: CollectionState): HTMLElement {
  const isSelected = state.info.id === selected;
  const toggle = el('input', { type: 'checkbox', checked: state.visible, title: 'Show on the map' });
  toggle.setAttribute('aria-label', `Show ${state.info.title} on the map`);
  toggle.onchange = () => setVisible(state, toggle.checked);
  const swatch = el('span', { className: 'swatch' });
  swatch.style.background = state.colour;
  const count = el('span', { className: 'count' }, state.page ? pageRange(offsetOf(state.pageUrl ?? ''), state.page.features.length, state.page.numberMatched) : '');
  const head = el('button', { type: 'button', className: 'collection-head', title: state.info.description ?? '' }, swatch, el('span', { className: 'collection-title' }, state.info.title || state.info.id), count);
  head.setAttribute('aria-pressed', String(isSelected));
  head.onclick = () => select(state.info.id);
  return el('li', { className: `collection${isSelected ? ' selected' : ''}` }, el('div', { className: 'collection-row' }, toggle, head));
}

/** The selected collection's queryables. A change reloads the first page at once. */
function renderQueryables(): void {
  const state = current();
  const section = $('queryables-section');
  const body = $('queryables');
  const textQueryables = state ? state.info.queryables.filter(q => !state.facets.some(f => f.name === q.name) && ['string', 'number', 'integer', 'date'].includes(q.type)) : [];
  section.hidden = !state;
  if (!state) return body.replaceChildren();
  $('queryables-of').textContent = state.info.title || state.info.id;

  const reload = () => void loadFirstPage(state);
  const groups: HTMLElement[] = [];
  for (const queryable of textQueryables) {
    const input = el('input', {
      name: queryable.name,
      type: queryable.type === 'date' ? 'date' : queryable.type === 'string' ? 'search' : 'number',
      value: state.values[queryable.name] ?? '',
    });
    let timer = 0;
    input.oninput = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        state.values = { ...state.values, [queryable.name]: input.value };
        reload();
      }, 300);
    };
    input.onkeydown = event => {
      if (event.key !== 'Enter') return;
      window.clearTimeout(timer);
      state.values = { ...state.values, [queryable.name]: input.value };
      reload();
    };
    groups.push(el('label', { className: 'field' }, el('span', {}, queryable.title ?? queryable.name), input));
  }
  for (const facet of state.facets) {
    const group = el('fieldset', { className: 'facet' }, el('legend', {}, facet.title));
    for (const value of facet.values) {
      const box = el('input', { type: 'checkbox', checked: (state.chosen[facet.name] ?? []).includes(value) });
      box.onchange = () => {
        const others = (state.chosen[facet.name] ?? []).filter(v => v !== value);
        state.chosen = { ...state.chosen, [facet.name]: box.checked ? [...others, value] : others };
        reload();
      };
      group.append(el('label', { className: 'check' }, box, el('span', { className: 'facet-value' }, facetLabel(value))));
    }
    groups.push(group);
  }
  const inView = el('input', { type: 'checkbox', checked: state.inView, name: 'in-view' });
  inView.onchange = () => {
    state.inView = inView.checked;
    reload();
  };
  groups.push(el('label', { className: 'check' }, inView, el('span', {}, 'In map view')));
  body.replaceChildren(...groups);

  const clear = $('queryables-clear');
  clear.onclick = () => {
    state.values = {};
    state.chosen = {};
    state.inView = false;
    renderQueryables();
    reload();
  };
}

function renderFeatures(): void {
  const state = current();
  showInspect(state?.page ? { query: state.sparql, template: state.template, result: state.page, context: state.jsonLdContext } : null);
  $('features-section').hidden = !state;
  const body = $('features');
  if (!state) return body.replaceChildren();

  const parts: HTMLElement[] = [];
  if (state.error) parts.push(el('p', { className: 'error' }, state.error));
  const base = state.pageUrl ?? window.location.href;
  const prev = linkHref(state.page?.links, 'prev', base);
  const next = linkHref(state.page?.links, 'next', base);
  const prevButton = el('button', { type: 'button', disabled: !prev, title: 'Previous page' }, '‹');
  const nextButton = el('button', { type: 'button', disabled: !next, title: 'Next page' }, '›');
  prevButton.onclick = () => prev && void loadPage(state, prev);
  nextButton.onclick = () => next && void loadPage(state, next);
  parts.push(el('div', { className: 'pager' }, prevButton, el('span', {}, state.page ? pageRange(offsetOf(base), state.page.features.length, state.page.numberMatched) : ''), nextButton));

  const features = state.page?.features ?? [];
  if (state.page && features.length === 0) parts.push(el('p', { className: 'empty' }, 'No features match.'));
  const list = el('ol', { className: 'features' });
  for (const feature of features) {
    const button = el('button', { type: 'button' }, featureLabel(feature));
    button.onclick = () => {
      const place = placeOf(feature.geometry);
      if (!place) return;
      map.fitBounds(place.bounds, { padding: 80, maxZoom: 14 });
      showPopup(state, feature, place.at);
    };
    list.append(el('li', {}, button));
  }
  parts.push(list);
  if (state.pageUrl && !inTab) {
    parts.push(el('a', { className: 'raw', href: state.pageUrl, target: '_blank', rel: 'noopener' }, 'GeoJSON'));
  }
  body.replaceChildren(...parts);
}

void start();
