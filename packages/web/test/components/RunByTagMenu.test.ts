/**
 * Picking tags and asking for them to be run.
 *
 * The component's whole job is to survive a *multi*-pick — the menu staying
 * open across ticks, and the match mode appearing only once it can change the
 * answer — so that is what is asserted here. What the tags then select is the
 * server's business (`POST /tests/run`), and is tested there.
 *
 * Two things about the mounting, both about the dropdown being a radix one:
 *
 * - **The portal is stubbed**, so the menu renders inside the wrapper instead
 *   of at `document.body`. Every query below is then scoped to *this* mount,
 *   which is what a component test wants anyway.
 * - **The menu is closed before the wrapper goes**, because radix schedules its
 *   listener teardown and unmounting an open layer leaves that work to run
 *   after the test environment has gone — an unhandled rejection attributed to
 *   whatever file happened to be running next.
 */
import { afterEach, describe, it, expect } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import RunByTagMenu from '@/components/tests/RunByTagMenu.vue';

const TAGS = [
  { id: 'tag:negation', name: 'negation', color: '#2f6feb', count: 12 },
  { id: 'tag:rdfs', name: 'RDFS', color: '#15803d', count: 6 },
];

let wrapper: VueWrapper | null = null;

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function mountMenu(props: Record<string, unknown> = {}) {
  wrapper = mount(RunByTagMenu, {
    props: { tags: TAGS, ...props } as never,
    // The portal renders inline, so the menu lands inside the wrapper: every
    // query is then scoped to this mount rather than to a shared document.
    global: { stubs: { DropdownMenuPortal: { template: '<div><slot /></div>' } } },
  });
  return wrapper;
}

async function openMenu(props: Record<string, unknown> = {}) {
  const menu = mountMenu(props);
  await menu.find('[data-testid="tests-run-by-tag"]').trigger('click');
  await tick();
  return menu;
}

afterEach(async () => {
  if (!wrapper) return;
  const trigger = wrapper.find('[data-testid="tests-run-by-tag"]');
  // Closing before unmount, per the file's docblock. `aria-expanded` is radix's
  // own record of the state, so this closes exactly when there is one open.
  if (trigger.exists() && trigger.attributes('aria-expanded') === 'true') {
    await trigger.trigger('click');
    await tick();
  }
  wrapper.unmount();
  wrapper = null;
  await tick();
});

const item = (menu: VueWrapper, id: string) => menu.find(`[data-testid="run-tag-${id}"]`);
const go = (menu: VueWrapper) => menu.find('[data-testid="tests-run-by-tag-go"]');

describe('RunByTagMenu', () => {
  it('offers nothing to run when the list carries no tags', () => {
    const menu = mountMenu({ tags: [] });
    expect(menu.find('[data-testid="tests-run-by-tag"]').attributes('disabled')).toBeDefined();
  });

  it('lists each tag with how many tests carry it', async () => {
    const menu = await openMenu();
    expect(item(menu, 'tag:negation').text()).toContain('negation');
    expect(item(menu, 'tag:negation').text()).toContain('12');
  });

  it('emits the tags picked, and stays open long enough to pick two', async () => {
    const menu = await openMenu();

    await item(menu, 'tag:negation').trigger('click');
    // Still open: a menu that closed on the first tick would make two tags two
    // trips.
    expect(item(menu, 'tag:rdfs').exists()).toBe(true);
    await item(menu, 'tag:rdfs').trigger('click');

    expect(go(menu).text()).toContain('18');
    await go(menu).trigger('click');

    expect(menu.emitted('run')?.[0]).toEqual([['tag:negation', 'tag:rdfs'], 'any']);
  });

  it('offers all-of only once a second tag makes the two modes differ', async () => {
    const menu = await openMenu();

    await item(menu, 'tag:negation').trigger('click');
    expect(menu.find('[data-testid="run-tag-match-all"]').exists()).toBe(false);

    await item(menu, 'tag:rdfs').trigger('click');
    await menu.find('[data-testid="run-tag-match-all"]').trigger('click');
    await go(menu).trigger('click');

    expect(menu.emitted('run')?.[0]?.[1]).toBe('all');
  });

  it('offers the export formats only once there is a selection to export', async () => {
    const menu = await openMenu();
    expect(menu.find('[data-testid="tests-export-earl"]').exists()).toBe(false);

    await item(menu, 'tag:negation').trigger('click');
    expect(menu.find('[data-testid="tests-export-earl"]').exists()).toBe(true);
  });

  it('exports the same selection the Run button would have run', async () => {
    // Export is a run: the formats apply to the tags picked above them, not to
    // whatever the rail last showed.
    const menu = await openMenu();

    await item(menu, 'tag:negation').trigger('click');
    await item(menu, 'tag:rdfs').trigger('click');
    await menu.find('[data-testid="run-tag-match-all"]').trigger('click');
    await menu.find('[data-testid="tests-export-earl"]').trigger('click');

    const [tagIds, match, format] = menu.emitted('export')?.[0] as [string[], string, { accept: string }];
    expect(tagIds).toEqual(['tag:negation', 'tag:rdfs']);
    expect(match).toBe('all');
    expect(format.accept).toBe('text/turtle');
    // The run itself is not also fired: one press, one run.
    expect(menu.emitted('run')).toBeUndefined();
  });

  it('drops a tag that has gone from the library rather than running a dead IRI', async () => {
    const menu = await openMenu();

    await item(menu, 'tag:rdfs').trigger('click');
    await menu.setProps({ tags: [TAGS[0]] } as never);

    expect(go(menu).attributes('disabled')).toBeDefined();
  });
});
