/**
 * The export menu, which is a Run button that saves its answer.
 *
 * The mounting notes in `RunByTagMenu.test.ts` apply here for the same reason:
 * this is a radix dropdown, so the portal is stubbed to keep every query scoped
 * to the mount, and the menu is closed before the wrapper goes.
 */
import { afterEach, describe, it, expect } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import TestReportExportMenu from '@/components/tests/TestReportExportMenu.vue';
import { TEST_REPORT_FORMATS } from '@/lib/testReportFormats';

let wrapper: VueWrapper | null = null;

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function mountMenu(props: Record<string, unknown> = {}) {
  wrapper = mount(TestReportExportMenu, {
    props: props as never,
    global: { stubs: { DropdownMenuPortal: { template: '<div><slot /></div>' } } },
  });
  return wrapper;
}

async function openMenu(props: Record<string, unknown> = {}) {
  const menu = mountMenu(props);
  await menu.find('[data-testid="test-export-report"]').trigger('click');
  await tick();
  return menu;
}

afterEach(async () => {
  if (!wrapper) return;
  const trigger = wrapper.find('[data-testid="test-export-report"]');
  if (trigger.exists() && trigger.attributes('aria-expanded') === 'true') {
    await trigger.trigger('click');
    await tick();
  }
  wrapper.unmount();
  wrapper = null;
  await tick();
});

describe('TestReportExportMenu', () => {
  it('offers every format the server renders, EARL included', async () => {
    const menu = await openMenu();

    for (const format of TEST_REPORT_FORMATS) {
      expect(menu.find(`[data-testid="test-export-${format.id}"]`).exists()).toBe(true);
    }
    expect(menu.find('[data-testid="test-export-earl"]').text()).toContain('EARL');
  });

  it('emits the format picked, with the Accept the server negotiates on', async () => {
    const menu = await openMenu();

    await menu.find('[data-testid="test-export-earl"]').trigger('click');
    await tick();

    expect(menu.emitted('export')?.[0]?.[0]).toMatchObject({
      id: 'earl',
      accept: 'text/turtle',
    });
  });

  it('says why it cannot export rather than offering a run that would 404', async () => {
    const menu = mountMenu({ disabled: true, disabledReason: 'Publish the test first' });
    const trigger = menu.find('[data-testid="test-export-report"]');

    expect(trigger.attributes('disabled')).toBeDefined();
    expect(trigger.attributes('title')).toBe('Publish the test first');
  });
});
