import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import SearchSelect from '@/components/shared/SearchSelect.vue';

const OPTIONS = [
  { value: 'urn:q1', label: 'Reaches' },
  { value: 'urn:q2', label: 'query-group smoke' },
  { value: 'urn:q3', label: 'settings audit' },
];

function mountSelect(overrides: Record<string, unknown> = {}) {
  return mount(SearchSelect, {
    props: { modelValue: null, options: OPTIONS, testId: 'chooser', ...overrides },
    attachTo: document.body,
  });
}

async function open(wrapper: ReturnType<typeof mountSelect>) {
  const input = wrapper.get('[data-testid="chooser"]');
  await input.trigger('click');
  await nextTick();
  return input;
}

describe('SearchSelect', () => {
  it('opens on click with every option, in the caller’s order', async () => {
    const wrapper = mountSelect();
    await open(wrapper);
    const options = wrapper.findAll('[data-testid="chooser-option"]');
    expect(options.map((option) => option.text())).toEqual([
      'Reaches',
      'query-group smoke',
      'settings audit',
    ]);
  });

  it('fuzzy-filters as you type: subsequences match, ranked best first', async () => {
    const wrapper = mountSelect();
    const input = await open(wrapper);
    // Not a substring of anything — "qgrp" only survives as a subsequence.
    await input.setValue('qgrp');
    await nextTick();
    const options = wrapper.findAll('[data-testid="chooser-option"]');
    expect(options.map((option) => option.text())).toEqual(['query-group smoke']);
    // The matched characters are marked for highlighting.
    expect(options[0].findAll('mark').map((m) => m.text()).join('')).toBe('qgrp');
  });

  it('chooses on click and shows the chosen label', async () => {
    const wrapper = mountSelect();
    await open(wrapper);
    const target = wrapper
      .findAll('[data-testid="chooser-option"]')
      .find((option) => option.text() === 'query-group smoke');
    expect(target).toBeDefined();
    await target!.trigger('click');
    await nextTick();
    expect(wrapper.emitted('update:modelValue')).toEqual([['urn:q2']]);
  });

  it('says so when nothing matches', async () => {
    const wrapper = mountSelect();
    const input = await open(wrapper);
    await input.setValue('zzzz');
    await nextTick();
    expect(wrapper.findAll('[data-testid="chooser-option"]')).toHaveLength(0);
    expect(wrapper.text()).toContain('No matches');
  });

  it('offers no way back to empty unless the caller asks for one', async () => {
    const wrapper = mountSelect();
    await open(wrapper);
    expect(wrapper.findAll('[data-testid="chooser-option"]')).toHaveLength(OPTIONS.length);
  });

  it('clears through the empty row', async () => {
    const wrapper = mountSelect({ emptyLabel: 'None', modelValue: 'urn:q2' });
    await open(wrapper);
    const rows = wrapper.findAll('[data-testid="chooser-option"]');
    expect(rows.map((row) => row.text())[0]).toBe('None');
    await rows[0].trigger('click');
    await nextTick();
    expect(wrapper.emitted('update:modelValue')).toEqual([['']]);
  });

  it('keeps the empty row out of the way once you are typing', async () => {
    const wrapper = mountSelect({ emptyLabel: 'None' });
    const input = await open(wrapper);
    await input.setValue('set');
    await nextTick();
    expect(wrapper.findAll('[data-testid="chooser-option"]').map((row) => row.text())).not.toContain(
      'None',
    );
  });

  it('opens onto the whole list even when something is already chosen', async () => {
    // reka seeds the input with the chosen label on open; if that text is left
    // in the filter the menu shows only the row you already have.
    const wrapper = mountSelect({ modelValue: 'urn:q2' });
    await open(wrapper);
    await nextTick();
    expect(wrapper.findAll('[data-testid="chooser-option"]')).toHaveLength(OPTIONS.length);
  });

  it('leaves Home and End to the text box, so Shift+Home can select what you typed', async () => {
    // reka binds both on the input and calls preventDefault, which took
    // select-to-start away from a field whose whole job is typing.
    const wrapper = mountSelect();
    const input = await open(wrapper);
    await input.setValue('quer');

    for (const key of ['Home', 'End']) {
      const event = new KeyboardEvent('keydown', {
        key,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      input.element.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }

    // The arrows still belong to the list.
    const arrow = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
    input.element.dispatchEvent(arrow);
    expect(arrow.defaultPrevented).toBe(true);
  });

  it('does nothing when disabled', async () => {
    const wrapper = mountSelect({ disabled: true });
    await open(wrapper);
    expect(wrapper.findAll('[data-testid="chooser-option"]')).toHaveLength(0);
  });
});
