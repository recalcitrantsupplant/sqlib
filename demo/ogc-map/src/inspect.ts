/**
 * The right-hand panel: the SPARQL that ran for the selected collection's
 * page, and the GeoJSON it returned, each in a read-only CodeMirror view.
 *
 * It follows the web app's inspector (`packages/web/src/components/shared/InspectorPanel.vue`):
 * a collapse toggle beside the tabs, a drag edge on the left that a
 * double-click resets, and lines wrapped by default. The width, the collapsed
 * state and the wrap setting are kept in this browser.
 */
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { json } from '@codemirror/lang-json';
import { sparql } from '@kurrawongai/codemirror-lang-sparql12';

type Tab = 'query' | 'result';

const LANGUAGES: Record<Tab, () => Extension> = {
  query: () => sparql({ lateral: true }),
  result: () => json(),
};

const STORAGE_KEY = 'sqlib.ogcMap.inspect.v1';
const DEFAULT_WIDTH = 420;
const MIN_WIDTH = 280;
/** The map keeps at least this much room beside the two panels. */
const MIN_MAP = 240;

/** Lucide icons (ISC): panel-right-close, panel-right-open, wrap-text, copy, check. */
const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICONS = {
  collapse: svg('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/><path d="m8 9 3 3-3 3"/>'),
  expand: svg('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/><path d="m10 15-3-3 3-3"/>'),
  wrap: svg('<path d="m16 16-3 3 3 3"/><path d="M3 12h14.5a1 1 0 0 1 0 7H13"/><path d="M3 19h6"/><path d="M3 5h18"/>'),
  copy: svg('<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>'),
  copied: svg('<path d="M20 6 9 17l-5-5"/>'),
};

interface Prefs {
  width: number;
  collapsed: boolean;
  wrap: boolean;
}

let tab: Tab = 'query';
let texts: Record<Tab, string> = { query: '', result: '' };
let view: EditorView | null = null;
const wrapping = new Compartment();
let prefs: Prefs = readPrefs();
/** Called after the panel changes size, so the map can fill its new box. */
let onLayout: () => void = () => {};

const $ = (id: string) => document.getElementById(id) as HTMLElement;

function readPrefs(): Prefs {
  const fallback: Prefs = { width: DEFAULT_WIDTH, collapsed: false, wrap: true };
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Prefs>;
    return {
      width: typeof stored.width === 'number' && stored.width >= MIN_WIDTH ? stored.width : fallback.width,
      collapsed: stored.collapsed === true,
      wrap: stored.wrap !== false,
    };
  } catch {
    return fallback;
  }
}

function savePrefs(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Blocked storage loses the setting at the next load, nothing else.
  }
}

/** The widest the panel may be: the window less the list panel and the map's minimum. */
function maxWidth(): number {
  const list = $('panel').getBoundingClientRect().width;
  return Math.max(MIN_WIDTH, window.innerWidth - list - MIN_MAP);
}

function applyLayout(): void {
  const width = Math.min(Math.max(prefs.width, MIN_WIDTH), maxWidth());
  document.body.style.setProperty('--inspect-w', `${width}px`);
  document.body.classList.toggle('inspect-collapsed', prefs.collapsed);
  const toggle = $('inspect-toggle');
  toggle.innerHTML = prefs.collapsed ? ICONS.expand : ICONS.collapse;
  toggle.title = prefs.collapsed ? 'Expand panel' : 'Collapse panel';
  toggle.setAttribute('aria-expanded', String(!prefs.collapsed));
  const wrap = $('inspect-wrap');
  wrap.setAttribute('aria-pressed', String(prefs.wrap));
  onLayout();
}

function render(): void {
  for (const name of ['query', 'result'] as const) $(`tab-${name}`).setAttribute('aria-selected', String(name === tab));
  const state = EditorState.create({
    doc: texts[tab],
    extensions: [
      LANGUAGES[tab](),
      syntaxHighlighting(defaultHighlightStyle),
      wrapping.of(prefs.wrap ? EditorView.lineWrapping : []),
      EditorView.editable.of(false),
      EditorState.readOnly.of(true),
    ],
  });
  if (view) view.setState(state);
  else view = new EditorView({ state, parent: $('inspect-code') });
}

function startResize(event: PointerEvent): void {
  if (prefs.collapsed || event.button !== 0) return;
  event.preventDefault();
  const handle = $('inspect-resizer');
  handle.setPointerCapture(event.pointerId);
  handle.classList.add('active');
  document.body.classList.add('resizing');
  const startX = event.clientX;
  const startWidth = $('inspect').getBoundingClientRect().width;
  const move = (e: PointerEvent) => {
    prefs.width = Math.min(Math.max(startWidth + startX - e.clientX, MIN_WIDTH), maxWidth());
    applyLayout();
  };
  const end = () => {
    handle.classList.remove('active');
    document.body.classList.remove('resizing');
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', end);
    handle.removeEventListener('pointercancel', end);
    savePrefs();
  };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}

async function copy(): Promise<void> {
  const button = $('inspect-copy');
  try {
    await navigator.clipboard.writeText(texts[tab]);
    button.innerHTML = ICONS.copied;
    button.title = 'Copied';
  } catch {
    button.title = 'Copy failed';
  }
  window.setTimeout(() => {
    button.innerHTML = ICONS.copy;
    button.title = 'Copy';
  }, 1500);
}

export function initInspect(hasQuery: boolean, layoutChanged: () => void): void {
  onLayout = layoutChanged;
  $('tab-query').hidden = !hasQuery;
  if (!hasQuery) tab = 'result';
  for (const name of ['query', 'result'] as const) {
    $(`tab-${name}`).onclick = () => {
      tab = name;
      if (prefs.collapsed) {
        prefs.collapsed = false;
        savePrefs();
        applyLayout();
      }
      render();
    };
  }
  $('inspect-toggle').onclick = () => {
    prefs.collapsed = !prefs.collapsed;
    savePrefs();
    applyLayout();
  };
  $('inspect-wrap').innerHTML = ICONS.wrap;
  $('inspect-wrap').onclick = () => {
    prefs.wrap = !prefs.wrap;
    savePrefs();
    view?.dispatch({ effects: wrapping.reconfigure(prefs.wrap ? EditorView.lineWrapping : []) });
    applyLayout();
  };
  $('inspect-copy').innerHTML = ICONS.copy;
  $('inspect-copy').onclick = () => void copy();
  const resizer = $('inspect-resizer');
  resizer.onpointerdown = startResize;
  resizer.ondblclick = () => {
    prefs.width = DEFAULT_WIDTH;
    savePrefs();
    applyLayout();
  };
  window.addEventListener('resize', () => applyLayout());
  applyLayout();
}

/** Show a page's query and result. Null hides the panel. */
export function showInspect(content: { query: string | null; result: unknown } | null): void {
  const panel = $('inspect');
  const wasHidden = panel.hidden;
  panel.hidden = content === null;
  document.body.classList.toggle('inspecting', content !== null);
  if (wasHidden !== panel.hidden) onLayout();
  if (!content) return;
  texts = { query: content.query ?? '', result: content.result === null ? '' : JSON.stringify(content.result, null, 2) };
  render();
}
