/**
 * Run on the Tests list: one button without a filter, a split button with one.
 *
 * The portal is stubbed so the menu renders inside the wrapper, and the menu
 * is closed before the wrapper goes: radix schedules its listener teardown,
 * and unmounting an open layer leaves that work to run after the test
 * environment has gone.
 */
import { afterEach, describe, it, expect } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import TestsRunButton from '@/components/tests/TestsRunButton.vue';

let wrapper: VueWrapper | null = null;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function mountButton(props: Record<string, unknown> = {}) {
  wrapper = mount(TestsRunButton, {
    props: { label: 'Run all', count: 343, totalCount: 343, filtered: false, canExport: false, busy: false, ...props } as never,
    global: { stubs: { DropdownMenuPortal: { template: '<div><slot /></div>' } } },
  });
  return wrapper;
}

async function openMenu(props: Record<string, unknown>) {
  const button = mountButton(props);
  await button.get('[data-testid="tests-run-menu"]').trigger('click');
  await tick();
  return button;
}

afterEach(async () => {
  if (!wrapper) return;
  const trigger = wrapper.find('[data-testid="tests-run-menu"]');
  if (trigger.exists() && trigger.attributes('aria-expanded') === 'true') {
    await trigger.trigger('click');
    await tick();
  }
  wrapper.unmount();
  wrapper = null;
  await tick();
});

const FILTERED = { label: 'Run 16', count: 16, filtered: true, canExport: true };

describe('TestsRunButton', () => {
  it('is one Run all button when the list is not filtered', async () => {
    const button = mountButton();
    expect(button.get('[data-testid="tests-run-all"]').text()).toBe('Run all');
    expect(button.find('[data-testid="tests-run-menu"]').exists()).toBe(false);
    await button.get('[data-testid="tests-run-all"]').trigger('click');
    expect(button.emitted('run')).toHaveLength(1);
  });

  it('runs the filtered list, or everything from its menu', async () => {
    const button = await openMenu(FILTERED);
    expect(button.get('[data-testid="tests-run-all"]').text()).toBe('Run 16');
    expect(button.get('[data-testid="tests-run-everything"]').text()).toContain('Run all 343 tests');
    await button.get('[data-testid="tests-run-everything"]').trigger('click');
    expect(button.emitted('run-all')).toHaveLength(1);
    expect(button.emitted('run')).toBeUndefined();
  });

  it('offers the report formats only when the filter is tags only', async () => {
    const tagged = await openMenu(FILTERED);
    await tagged.get('[data-testid="tests-export-earl"]').trigger('click');
    const [format] = tagged.emitted('export')?.[0] as [{ accept: string }];
    expect(format.accept).toBe('text/turtle');
    await tagged.get('[data-testid="tests-run-menu"]').trigger('click');
    await tick();
    tagged.unmount();
    wrapper = null;

    const texted = await openMenu({ ...FILTERED, canExport: false });
    expect(texted.find('[data-testid="tests-export-earl"]').exists()).toBe(false);
  });

  it('cannot run an empty list', () => {
    const button = mountButton({ ...FILTERED, label: 'Run 0', count: 0 });
    expect(button.get('[data-testid="tests-run-all"]').attributes('disabled')).toBeDefined();
  });
});
