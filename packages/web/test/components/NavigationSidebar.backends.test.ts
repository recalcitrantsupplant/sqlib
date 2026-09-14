/**
 * The unscoped tree's backend rows, and where a click on one goes.
 *
 * A backend's record lives on the Backends section, and the tree is not it —
 * picking a section replaces this sidebar. So a backend row can only be a door:
 * it has to tell the page, because the page is what scopes the rail and selects
 * the record. It did neither. `handleSelectBackend` set a highlight the tree
 * kept to itself and emitted nothing, so clicking a backend in the tree looked
 * like a selection and left the work area on whatever was already open — while
 * the pencil beside it, three lines away, has always opened the record.
 *
 * These specs pin the row as that door, and the two controls beside it as the
 * distinct things they are: the pencil opens the same record, and neither the
 * pencil nor the delete button may fire the row's own event on the way past.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ref } from 'vue';
import { mount } from '@vue/test-utils';
import NavigationSidebar from '@/components/NavigationSidebar.vue';

const backends = ref<Array<{ id: string; name: string }>>([]);

const stores = vi.hoisted(() => ({
  loadLibraries: vi.fn(),
  loadQueries: vi.fn(),
  loadQueryGroups: vi.fn(),
  fetchRuleSets: vi.fn(),
  loadBackends: vi.fn(),
}));

vi.mock('@/composables/useLibrariesStore', () => ({
  useLibrariesStore: () => ({
    libraries: ref([]),
    visibleLibraries: ref([]),
    loading: ref(false),
    error: ref(null),
    loadLibraries: stores.loadLibraries,
  }),
}));
vi.mock('@/composables/useQueriesStore', () => ({
  useQueriesStore: () => ({
    queries: ref([]),
    loading: ref(false),
    error: ref(null),
    loadQueries: stores.loadQueries,
  }),
}));
vi.mock('@/composables/useQueryGroupsStore', () => ({
  useQueryGroupsStore: () => ({
    queryGroups: ref([]),
    loading: ref(false),
    error: ref(null),
    loadQueryGroups: stores.loadQueryGroups,
  }),
}));
vi.mock('@/composables/useRuleSetsStore', () => ({
  useRuleSetsStore: () => ({
    ruleSets: ref([]),
    loading: ref(false),
    error: ref(null),
    fetchRuleSets: stores.fetchRuleSets,
  }),
}));
vi.mock('@/composables/useBackendsStore', () => ({
  useBackendsStore: () => ({
    backends,
    loading: ref(false),
    error: ref(null),
    loadBackends: stores.loadBackends,
  }),
}));
vi.mock('@/composables/useApiClient', () => ({
  useApiClient: () => ({ executeTarget: vi.fn() }),
}));

function mountTree() {
  return mount(NavigationSidebar, { props: { section: null } });
}

/** The row for a backend, by the name it draws. */
function rowFor(wrapper: ReturnType<typeof mountTree>, name: string) {
  const row = wrapper
    .findAll('.backend-item')
    .find((item) => item.find('.backend-name').text() === name);
  if (!row) throw new Error(`no backend row for ${name}`);
  return row;
}

describe('NavigationSidebar backend rows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    backends.value = [
      { id: 'urn:backend:wikidata', name: 'Wikidata Public' },
      { id: 'urn:backend:graphdb', name: 'GraphDB Prod' },
    ];
  });

  it('asks the page to open the record when a row is clicked', async () => {
    const wrapper = mountTree();

    await rowFor(wrapper, 'GraphDB Prod').find('.backend-button').trigger('click');

    expect(wrapper.emitted('select-backend')).toEqual([
      [{ backendId: 'urn:backend:graphdb', backendName: 'GraphDB Prod' }],
    ]);
  });

  it('names the backend that was clicked, not the first one', async () => {
    const wrapper = mountTree();

    await rowFor(wrapper, 'Wikidata Public').find('.backend-button').trigger('click');
    await rowFor(wrapper, 'GraphDB Prod').find('.backend-button').trigger('click');

    expect(wrapper.emitted('select-backend')).toEqual([
      [{ backendId: 'urn:backend:wikidata', backendName: 'Wikidata Public' }],
      [{ backendId: 'urn:backend:graphdb', backendName: 'GraphDB Prod' }],
    ]);
  });

  /*
   * The pencil and the row mean the same thing and say so separately: the page
   * routes both to one function. What matters here is that the pencil is still
   * its own event and does not also fire the row's — the two would open the
   * record twice, and a `@click.stop` that goes missing is the way that breaks.
   */
  it('keeps the pencil a separate event that does not fire the row', async () => {
    const wrapper = mountTree();

    await rowFor(wrapper, 'Wikidata Public').find('.edit-button-small').trigger('click');

    expect(wrapper.emitted('edit-backend')).toEqual([
      [{ backendId: 'urn:backend:wikidata', backendName: 'Wikidata Public' }],
    ]);
    expect(wrapper.emitted('select-backend')).toBeUndefined();
  });

  it('does not open the record on the way to deleting one', async () => {
    const wrapper = mountTree();

    await rowFor(wrapper, 'Wikidata Public').find('.delete-button-small').trigger('click');

    expect(wrapper.emitted('delete-backend')).toEqual([
      [{ backendId: 'urn:backend:wikidata', backendName: 'Wikidata Public' }],
    ]);
    expect(wrapper.emitted('select-backend')).toBeUndefined();
  });
});

/*
 * The other half of the door, which the mount above cannot see: an event nobody
 * listens to is the same defect one component along. `pages/index.vue` owns the
 * two moves that open a backend — scoping the rail and selecting the record —
 * so this checks that the row's event arrives there and lands on them.
 *
 * A source read rather than a mount, because the page is a Nuxt route with the
 * whole app under it; what is asserted is the wiring, which is exactly what a
 * mount of the sidebar alone cannot reach.
 */
const PAGE = readFileSync(resolve(import.meta.dirname, '../../src/pages/index.vue'), 'utf8');

/** The `<NavigationSidebar …>` tag, opening angle to `>`. */
function sidebarTag(): string {
  const at = PAGE.indexOf('<NavigationSidebar');
  expect(at).toBeGreaterThan(-1);
  return PAGE.slice(at, PAGE.indexOf('>', at) + 1);
}

/**
 * A `function name(…) { … }` body, by brace matching.
 *
 * The parameter list is skipped first rather than scanned for the opening
 * brace: these handlers take an inline object type, so the first `{` after the
 * name belongs to the annotation and matching from there returns the arguments
 * instead of the body — a check that would then pass whatever the function did.
 */
function bodyOf(name: string): string {
  const at = PAGE.indexOf(`function ${name}(`);
  expect(at, `pages/index.vue declares ${name}`).toBeGreaterThan(-1);

  let parens = 0;
  let cursor = PAGE.indexOf('(', at);
  for (; cursor < PAGE.length; cursor += 1) {
    if (PAGE[cursor] === '(') parens += 1;
    if (PAGE[cursor] === ')') {
      parens -= 1;
      if (parens === 0) break;
    }
  }

  let depth = 0;
  for (let i = PAGE.indexOf('{', cursor); i < PAGE.length; i += 1) {
    if (PAGE[i] === '{') depth += 1;
    if (PAGE[i] === '}') {
      depth -= 1;
      if (depth === 0) return PAGE.slice(at, i + 1);
    }
  }
  throw new Error(`unterminated body for ${name}`);
}

/** A handler's body plus the bodies of the page's own functions it calls. */
function effectOf(name: string): string {
  const body = bodyOf(name);
  const called = [...body.matchAll(/\b([a-zA-Z][\w]*)\(/g)]
    .map((match) => match[1])
    .filter((callee) => callee !== name && PAGE.includes(`function ${callee}(`));
  return [body, ...called.map(bodyOf)].join('\n');
}

describe('the page behind the tree’s backend rows', () => {
  it('listens for the row', () => {
    expect(sidebarTag()).toMatch(/@select-backend="(\w+)"/);
  });

  it.each([
    ['@select-backend', 'the row'],
    ['@edit-backend', 'the pencil'],
  ])('opens the record from %s (%s)', (attribute) => {
    const handler = sidebarTag().match(new RegExp(`${attribute}="(\\w+)"`))?.[1];
    expect(handler, `${attribute} is bound`).toBeTruthy();

    const effect = effectOf(handler as string);
    // Both moves, or the click lands on a section that is not drawn.
    expect(effect).toContain("activeSection.value = 'backends'");
    expect(effect).toContain('handleSelectBackend(');
  });
});
