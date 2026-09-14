import { describe, it, expect, beforeEach, vi } from 'vitest';
import { nextTick } from 'vue';
import type { PrefixMapping } from '@/types/prefixes';

/*
 * The manager is the only screen that explains the prefix resolution rules, so
 * these tests are mostly about the words on a conflicting row: which mapping
 * wins, which is never used, and which is only an input alias. The rest covers
 * what the rebuild changed in behaviour — removal is undoable rather than
 * confirmed, and the dialog is a real `Dialog`, so its content is portalled to
 * the document rather than sitting inside the wrapper.
 *
 * usePrefixManager is a module-level singleton persisted through localStorage,
 * so each test re-imports it after seeding storage. Seeded mappings are merged
 * with DEFAULT_PREFIXES by the composable — the defaults conflict with nothing,
 * so the fixtures below use namespaces of their own and the assertions name
 * rows rather than counting them.
 */

const mockLocalStorage: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: vi.fn((key: string) => mockLocalStorage[key] ?? null),
  setItem: vi.fn((key: string, value: string) => {
    mockLocalStorage[key] = value;
  }),
  removeItem: vi.fn((key: string) => {
    delete mockLocalStorage[key];
  }),
  clear: vi.fn(() => {
    for (const key in mockLocalStorage) delete mockLocalStorage[key];
  }),
});

vi.mock('vue-sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function mapping(overrides: Partial<PrefixMapping> & { prefix: string; namespace: string }): PrefixMapping {
  return {
    id: `${overrides.prefix}-${overrides.namespace}`,
    enabled: true,
    isDefault: false,
    source: 'user-added',
    createdAt: 1,
    ...overrides,
  };
}

/** Same prefix, two namespaces: the longer namespace wins, the shorter is never used. */
const DUPE_WINNER = mapping({ prefix: 'dupe', namespace: 'http://conflict.example/longer-vocabulary#' });
const DUPE_LOSER = mapping({
  prefix: 'dupe',
  namespace: 'http://conflict.example/short#',
  source: 'auto-discovered',
  discoveredFrom: 'urn:sqlib:query:catalogue',
});
/** Same namespace, two prefixes: both accepted on input, the older written out. */
const ALIAS_PREFERRED = mapping({ prefix: 'aliasa', namespace: 'http://alias.example/ns#', createdAt: 1 });
const ALIAS_OTHER = mapping({ prefix: 'aliasb', namespace: 'http://alias.example/ns#', createdAt: 2 });
/** Conflicts with nothing. */
const SOLO = mapping({ prefix: 'solo', namespace: 'http://solo.example/ns#' });

const ALL = [DUPE_WINNER, DUPE_LOSER, ALIAS_PREFERRED, ALIAS_OTHER, SOLO];

async function open(mappings: PrefixMapping[]) {
  localStorage.setItem(
    'sparqlQueryLib.prefixSettings',
    JSON.stringify({ duplicateResolution: 'longest', mappings }),
  );
  const { mount } = await import('@vue/test-utils');
  const { default: PrefixMappingsEditor } = await import('@/components/PrefixMappingsEditor.vue');
  const { usePrefixManager } = await import('@/composables/usePrefixManager');
  const wrapper = mount(PrefixMappingsEditor, {
    props: { open: true },
    attachTo: document.body,
    global: {
      stubs: {
        NuxtLink: { props: ['to'], template: '<a :data-to="JSON.stringify(to)"><slot /></a>' },
      },
    },
  });
  await nextTick();
  await nextTick();
  return { wrapper, manager: usePrefixManager() };
}

function rows(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-testid="prefix-row"]'));
}

/** The row whose namespace cell is exactly this namespace. */
function rowFor(namespace: string): HTMLElement {
  const row = rows().find((r) => r.querySelector('.namespace')?.textContent === namespace);
  if (!row) throw new Error(`no row for ${namespace}`);
  return row;
}

function prefixesOn(list: HTMLElement[]): string[] {
  return list.map((r) => r.querySelector('.prefix-name')?.textContent ?? '');
}

function query<T extends HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`no element matching ${selector}`);
  return el;
}

function click(el: Element): Promise<void> {
  (el as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return nextTick();
}

function type(el: HTMLInputElement, value: string): Promise<void> {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return nextTick();
}

function button(root: ParentNode, title: string): HTMLElement {
  const found = root.querySelector<HTMLElement>(`button[title="${title}"]`);
  if (!found) throw new Error(`no button titled ${title}`);
  return found;
}

describe('PrefixMappingsEditor', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  it('is a real dialog, not a hand-rolled overlay', async () => {
    await open(ALL);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.querySelector('.focus-overlay')).toBeNull();
  });

  it('lists mappings twenty a page, with a count in the header', async () => {
    const { manager } = await open(ALL);
    const total = manager.prefixSettings.value.mappings.length;
    expect(total).toBeGreaterThan(20);
    expect(rows()).toHaveLength(20);
    expect(document.body.textContent).toContain(`${total} mappings · ${total} enabled`);
    expect(query('.page-label').textContent).toBe(`1–20 of ${total}`);
  });

  it('pages forward and back, and a filter resets to page one', async () => {
    const { manager } = await open(ALL);
    const total = manager.prefixSettings.value.mappings.length;

    await click(button(document, 'Next page'));
    expect(rows()).toHaveLength(total - 20);
    expect(query('.page-label').textContent).toBe(`21–${total} of ${total}`);
    expect(button(document, 'Next page').hasAttribute('disabled')).toBe(true);

    await click(button(document, 'Previous page'));
    expect(rows()).toHaveLength(20);

    await click(button(document, 'Next page'));
    await type(query<HTMLInputElement>('.filter-input'), 'alias');
    expect(prefixesOn(rows()).sort()).toEqual(['aliasa:', 'aliasb:']);
    expect(document.querySelector('[data-testid="prefix-pagination"]')).toBeNull();
  });

  it('marks the shadowed row and says what shadows it', async () => {
    await open(ALL);

    const loser = rowFor('http://conflict.example/short#');
    expect(loser.textContent).toContain('not used');
    expect(loser.textContent).toContain(
      'Shadowed by dupe: http://conflict.example/longer-vocabulary#',
    );

    const winner = rowFor('http://conflict.example/longer-vocabulary#');
    expect(winner.textContent).not.toContain('not used');
    expect(winner.textContent).toContain('Two mappings use dupe: — this one wins.');
  });

  it('calls a second prefix for one namespace an alias rather than a conflict', async () => {
    await open(ALL);
    const alias = rows().find((r) => r.querySelector('.prefix-name')?.textContent === 'aliasb:')!;
    expect(alias.textContent).toContain('Alias — accepted on input, aliasa: is written out.');
    expect(alias.textContent).not.toContain('not used');
  });

  it('does not call both sides of a prefix clash unused when a default owns the namespace', async () => {
    /*
     * The defaults ship schema: -> http://schema.org/ and sdo: -> https://schema.org/.
     * Adding schema: -> https://schema.org/ makes it win the prefix (longer
     * namespace) and lose the namespace to the default sdo:, so neither schema:
     * mapping is *effective* — reading the shadow marker off effectiveIds put
     * "not used" on both rows and named neither winner.
     */
    await open([mapping({ prefix: 'schema', namespace: 'https://schema.org/', createdAt: 9 })]);

    const shadowed = rowFor('http://schema.org/');
    expect(shadowed.textContent).toContain('not used');
    expect(shadowed.textContent).toContain('Shadowed by schema: https://schema.org/');

    const alias = rowFor('https://schema.org/');
    expect(alias.textContent).not.toContain('not used');
    expect(alias.textContent).toContain('Alias — accepted on input, sdo: is written out.');
  });

  it('links a discovered mapping to the editor that holds its source', async () => {
    await open(ALL);
    const discovered = rowFor('http://conflict.example/short#');
    expect(discovered.querySelector('.source')?.textContent).toBe('Discovered');

    const link = discovered.querySelector('.source-from');
    expect(link?.getAttribute('title')).toBe('urn:sqlib:query:catalogue');
    // The kind of thing it came from, not an instruction to go there.
    expect(link?.textContent).toBe('Query');
    expect(JSON.parse(link!.getAttribute('data-to')!)).toEqual({
      path: '/',
      query: { query: 'urn:sqlib:query:catalogue' },
    });
  });

  it('names an unsaved source by what it is, and still links to it', async () => {
    await open([
      mapping({
        prefix: 'rsrc',
        namespace: 'http://rule.example/ns#',
        source: 'auto-discovered',
        discoveredFrom: 'rule-set:urn:sqlib:ruleset:abc',
      }),
      mapping({
        prefix: 'scr',
        namespace: 'http://scratch.example/ns#',
        source: 'auto-discovered',
        discoveredFrom: 'scratch:rules:scratch-1',
      }),
      mapping({
        prefix: 'legacy',
        namespace: 'http://legacy.example/ns#',
        source: 'auto-discovered',
        discoveredFrom: 'urn:sqlib:query-version:old',
      }),
    ]);

    const ruleSet = rowFor('http://rule.example/ns#').querySelector('.source-from');
    expect(JSON.parse(ruleSet!.getAttribute('data-to')!)).toEqual({
      path: '/',
      query: { ruleSet: 'urn:sqlib:ruleset:abc' },
    });

    expect(ruleSet?.textContent).toBe('Rule set');

    const scratch = rowFor('http://scratch.example/ns#').querySelector('.source-from');
    expect(JSON.parse(scratch!.getAttribute('data-to')!)).toEqual({
      path: '/',
      query: { scratch: 'scratch-1' },
    });
    // A draft rule set is a rule set: the row says so rather than saying
    // "scratch", which is machinery rather than an answer.
    expect(scratch?.textContent).toBe('Rule set (draft)');

    // A query-version urn resolves to no route, so it stays informational text.
    const legacy = rowFor('http://legacy.example/ns#').querySelector('.source-from');
    expect(legacy?.getAttribute('data-to')).toBeNull();
    expect(legacy?.textContent).toContain('query-version:old');
  });

  it('counts conflicts and filters to them', async () => {
    await open(ALL);
    const conflicts = query('.conflicts-button');
    expect(conflicts.textContent).toContain('3 conflicts');

    await click(conflicts);
    expect(prefixesOn(rows()).sort()).toEqual(['aliasb:', 'dupe:', 'dupe:']);
  });

  it('says nothing about conflicts when there are none', async () => {
    await open([SOLO]);
    expect(document.querySelector('.conflicts-button')).toBeNull();
  });

  it('filters on prefix and on namespace', async () => {
    await open(ALL);
    await type(query<HTMLInputElement>('.filter-input'), 'solo.example');
    expect(prefixesOn(rows())).toEqual(['solo:']);

    await type(query<HTMLInputElement>('.filter-input'), 'nothing-here');
    expect(rows()).toHaveLength(0);
    expect(document.body.textContent).toContain('Nothing matches “nothing-here”.');
  });

  it('removes without a confirm dialog and puts the mapping back on undo', async () => {
    const { manager } = await open(ALL);
    const before = manager.prefixSettings.value.mappings.map((m) => m.id);

    // solo: sorts past the first page of twenty.
    await click(button(document, 'Next page'));
    await click(button(rowFor('http://solo.example/ns#'), 'Remove'));
    expect(manager.prefixSettings.value.mappings.some((m) => m.prefix === 'solo')).toBe(false);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(query('.undo-strip').textContent).toContain('Removed solo: http://solo.example/ns#');

    await click(query('.undo-button'));
    // Back, and back where it was: the list must not reshuffle under the pointer.
    expect(manager.prefixSettings.value.mappings.map((m) => m.id)).toEqual(before);
    expect(document.querySelector('.undo-strip')).toBeNull();
  });

  it('edits a row in place', async () => {
    const { manager } = await open([SOLO]);
    await click(button(rowFor('http://solo.example/ns#'), 'Edit'));

    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('.row-input'));
    expect(inputs).toHaveLength(2);
    await type(inputs[0], 'renamed');
    await type(inputs[1], 'http://solo.example/other#');
    await click(query('.row-button.save'));

    expect(manager.prefixSettings.value.mappings.find((m) => m.id === SOLO.id)).toMatchObject({
      prefix: 'renamed',
      namespace: 'http://solo.example/other#',
    });
  });

  it('describes the resolution even while abbreviation is switched off', async () => {
    // buildCache returns nothing when abbreviation is off, which would make
    // every row claim to be shadowed if the manager read the live cache.
    localStorage.setItem(
      'sparql-query-lib-settings',
      JSON.stringify({ prefixAbbreviationEnabled: false }),
    );
    await open(ALL);
    expect(rowFor('http://conflict.example/longer-vocabulary#').textContent).not.toContain('not used');
    expect(rowFor('http://conflict.example/short#').textContent).toContain('not used');
  });
});
