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
  sparql: string | null;
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
        sparql: null,
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
  fitToExtents();
  initInspect([...collections.values()].some(state => state.sparqlHref !== null));
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
  (map.getSource(state.info.id) as GeoJSONSource).setData({ type: 'FeatureCollection', features: (state.page?.features ?? []) as never });
  renderList();
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

function renderList(): void {
  const list = $('collections');
  list.replaceChildren(...[...collections.values()].map(state => renderCollection(state)));
  const current = selected === null ? undefined : collections.get(selected);
  showInspect(current?.page ? { query: current.sparql, result: current.page } : null);
}

function renderCollection(state: CollectionState): HTMLElement {
  const isSelected = state.info.id === selected;
  const toggle = el('input', { type: 'checkbox', checked: state.visible, title: 'Show on the map' });
  toggle.setAttribute('aria-label', `Show ${state.info.title} on the map`);
  toggle.onchange = () => setVisible(state, toggle.checked);
  const swatch = el('span', { className: 'swatch' });
  swatch.style.background = state.colour;
  const count = el('span', { className: 'count' }, state.page ? pageRange(offsetOf(state.pageUrl ?? ''), state.page.features.length, state.page.numberMatched) : '');
  const head = el('button', { type: 'button', className: 'collection-head' }, swatch, el('span', { className: 'collection-title' }, state.info.title || state.info.id), count);
  head.setAttribute('aria-expanded', String(isSelected));
  head.onclick = () => {
    selected = isSelected ? null : state.info.id;
    renderList();
  };
  const item = el('li', { className: `collection${isSelected ? ' selected' : ''}` }, el('div', { className: 'collection-row' }, toggle, head));
  if (isSelected) item.append(renderDetail(state));
  return item;
}

function renderDetail(state: CollectionState): HTMLElement {
  const detail = el('div', { className: 'detail' });
  if (state.info.description) detail.append(el('p', { className: 'description' }, state.info.description));

  const form = el('form', { className: 'filters' });
  const facetNames = new Set(state.facets.map(facet => facet.name));
  for (const facet of state.facets) {
    const group = el('fieldset', { className: 'facet' }, el('legend', {}, facet.title));
    for (const value of facet.values) {
      const box = el('input', { type: 'checkbox', checked: (state.chosen[facet.name] ?? []).includes(value) });
      box.onchange = () => {
        const others = (state.chosen[facet.name] ?? []).filter(v => v !== value);
        state.chosen[facet.name] = box.checked ? [...others, value] : others;
        void loadFirstPage(state);
      };
      group.append(el('label', { className: 'check' }, box, el('span', { className: 'facet-value' }, facetLabel(value))));
    }
    form.append(group);
  }
  for (const queryable of state.info.queryables.filter(q => !facetNames.has(q.name) && ['string', 'number', 'integer', 'date'].includes(q.type))) {
    const input = el('input', {
      name: queryable.name,
      type: queryable.type === 'date' ? 'date' : queryable.type === 'string' ? 'search' : 'number',
      value: state.values[queryable.name] ?? '',
    });
    form.append(el('label', {}, el('span', {}, queryable.title ?? queryable.name), input));
  }
  const inView = el('input', { type: 'checkbox', checked: state.inView, name: 'in-view' });
  form.append(
    el('label', { className: 'check' }, inView, el('span', {}, 'In map view')),
    el('div', { className: 'actions' }, el('button', { type: 'submit', className: 'primary' }, 'Search'), el('button', { type: 'reset' }, 'Clear')),
  );
  const read = () => {
    const data = new FormData(form);
    state.values = Object.fromEntries(state.info.queryables.map(q => [q.name, String(data.get(q.name) ?? '')]));
    state.inView = inView.checked;
  };
  form.onsubmit = event => {
    event.preventDefault();
    read();
    void loadFirstPage(state);
  };
  form.onreset = event => {
    event.preventDefault();
    state.values = {};
    state.chosen = {};
    state.inView = false;
    void loadFirstPage(state);
  };
  detail.append(form);

  if (state.error) detail.append(el('p', { className: 'error' }, state.error));
  const base = state.pageUrl ?? window.location.href;
  const prev = linkHref(state.page?.links, 'prev', base);
  const next = linkHref(state.page?.links, 'next', base);
  const pager = el('div', { className: 'pager' });
  const prevButton = el('button', { type: 'button', disabled: !prev, title: 'Previous page' }, '‹');
  const nextButton = el('button', { type: 'button', disabled: !next, title: 'Next page' }, '›');
  prevButton.onclick = () => prev && void loadPage(state, prev);
  nextButton.onclick = () => next && void loadPage(state, next);
  pager.append(prevButton, el('span', {}, state.page ? pageRange(offsetOf(base), state.page.features.length, state.page.numberMatched) : ''), nextButton);
  detail.append(pager);

  const features = state.page?.features ?? [];
  if (state.page && features.length === 0) detail.append(el('p', { className: 'empty' }, 'No features match.'));
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
  detail.append(list);
  if (state.pageUrl && !inTab) {
    detail.append(el('a', { className: 'raw', href: state.pageUrl, target: '_blank', rel: 'noopener' }, 'GeoJSON'));
  }
  return detail;
}

void start();
