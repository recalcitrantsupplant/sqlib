import { describe, it, expect, afterEach } from 'vitest';
import { nextTick } from 'vue';
import { mount } from '@vue/test-utils';

import ExpandableEditor from '@/components/shared/ExpandableEditor.vue';
import ExpandRunStrip from '@/components/shared/ExpandRunStrip.vue';
import ExpandButton from '@/components/shared/ExpandButton.vue';
import { useEditorExpand } from '@/composables/useEditorExpand';

const expansion = useEditorExpand();

afterEach(() => expansion.collapse());

function mountRegion() {
  return mount(ExpandableEditor, {
    attachTo: document.body,
    props: { title: 'Query Editor', testid: 'region' },
    slots: {
      default: `<template #default="{ expanded, toggle }">
        <button class="the-editor" :data-expanded="expanded" @click="toggle">editor</button>
      </template>`,
    },
  });
}

describe('ExpandableEditor', () => {
  it('draws no chrome until it is expanded', () => {
    const wrapper = mountRegion();

    expect(wrapper.find('[data-testid="region"]').classes()).not.toContain('expanded');
    expect(wrapper.find('.expand-header').exists()).toBe(false);
    expect(wrapper.find('[data-testid="region"]').attributes('role')).toBeUndefined();
    expect(wrapper.find('.the-editor').attributes('data-expanded')).toBe('false');
  });

  it('pops out from the slot and comes back from its Close button', async () => {
    const wrapper = mountRegion();

    await wrapper.find('.the-editor').trigger('click');

    const region = wrapper.find('[data-testid="region"]');
    expect(region.classes()).toContain('expanded');
    expect(region.attributes('role')).toBe('dialog');
    expect(region.attributes('aria-label')).toBe('Query Editor');
    expect(wrapper.find('.expand-title').text()).toBe('Query Editor');
    expect(wrapper.find('.the-editor').attributes('data-expanded')).toBe('true');

    await wrapper.find('[data-testid="region-close"]').trigger('click');
    expect(wrapper.find('[data-testid="region"]').classes()).not.toContain('expanded');
  });

  it('comes back on Escape, and stops listening once it has', async () => {
    const wrapper = mountRegion();
    await wrapper.find('.the-editor').trigger('click');
    expect(wrapper.find('[data-testid="region"]').classes()).toContain('expanded');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await nextTick();

    expect(wrapper.find('[data-testid="region"]').classes()).not.toContain('expanded');

    // A second Escape has nothing to close and nothing bound to it.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await nextTick();
    expect(expansion.activeId.value).toBeNull();
  });

  it('comes back when the dim around it is clicked, but not the editor inside', async () => {
    const wrapper = mountRegion();
    await wrapper.find('.the-editor').trigger('click');

    // The dim is the region's own ::before, so a click on it targets the region.
    await wrapper.find('[data-testid="region"]').trigger('click');
    expect(wrapper.find('[data-testid="region"]').classes()).not.toContain('expanded');
  });

  it('emits its state so the screen around it can follow', async () => {
    const wrapper = mountRegion();

    await wrapper.find('.the-editor').trigger('click');
    await wrapper.find('.the-editor').trigger('click');

    expect(wrapper.emitted('update:expanded')).toEqual([[true], [false]]);
  });

  it('lets one editor at a time have the screen', async () => {
    const first = mountRegion();
    const second = mountRegion();

    await first.find('.the-editor').trigger('click');
    await second.find('.the-editor').trigger('click');
    await nextTick();

    expect(first.find('[data-testid="region"]').classes()).not.toContain('expanded');
    expect(second.find('[data-testid="region"]').classes()).toContain('expanded');
  });

  it('takes the pop-out with it when the region goes away', async () => {
    const wrapper = mountRegion();
    await wrapper.find('.the-editor').trigger('click');
    expect(expansion.activeId.value).not.toBeNull();

    wrapper.unmount();
    expect(expansion.activeId.value).toBeNull();
  });
});

describe('ExpandRunStrip', () => {
  const harness = {
    components: { ExpandableEditor, ExpandRunStrip },
    template: `
      <div class="work-area">
        <ExpandRunStrip><div class="run-bar" data-testid="run-bar">run</div></ExpandRunStrip>
        <ExpandableEditor v-slot="{ toggle }" title="Query Editor" testid="region">
          <button class="the-editor" @click="toggle">editor</button>
        </ExpandableEditor>
      </div>
    `,
  };

  it('stays where it is until an editor pops out, then goes with it', async () => {
    const wrapper = mount(harness, { attachTo: document.body });

    const strip = () => document.querySelector('[data-testid="run-bar"]');
    expect(strip()?.parentElement?.classList.contains('work-area')).toBe(true);

    await wrapper.find('.the-editor').trigger('click');
    await nextTick();
    await nextTick();

    expect(strip()?.parentElement?.classList.contains('expand-run')).toBe(true);

    // ...and it is the same element that moved, not a second copy of it.
    expect(document.querySelectorAll('[data-testid="run-bar"]').length).toBe(1);

    expansion.collapse();
    await nextTick();
    await nextTick();
    expect(strip()?.parentElement?.classList.contains('work-area')).toBe(true);
  });
});

describe('ExpandButton', () => {
  it('says what it will enlarge', () => {
    const wrapper = mount(ExpandButton, { props: { subject: 'the query editor', testid: 'expand' } });
    expect(wrapper.attributes('title')).toBe('Expand the query editor — Esc to come back');
    expect(wrapper.attributes('aria-label')).toBe('Expand the query editor — Esc to come back');
    expect(wrapper.find('[data-testid="expand"]').exists()).toBe(true);
  });
});
