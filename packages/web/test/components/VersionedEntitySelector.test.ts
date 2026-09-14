import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import VersionedEntitySelector, { type VersionedEntity } from '@/components/VersionedEntitySelector.vue';

const entity = (id: string, name: string, description?: string): VersionedEntity => ({
  id,
  name,
  description,
  versions: [{ id: `${id}:v1`, version: 1, isCurrent: true }],
  selectedVersionId: null,
  isChecked: false,
});

const ITEMS = [
  entity('urn:q1', 'Reaches'),
  entity('urn:q2', 'query-group smoke'),
  entity('urn:q3', 'settings audit', 'counts every reachable node'),
];

function mountSelector(items = ITEMS.map((item) => ({ ...item }))) {
  return mount(VersionedEntitySelector, {
    props: { items, title: 'QUERIES', selectionMode: 'single' as const },
  });
}

const names = (wrapper: ReturnType<typeof mountSelector>) =>
  wrapper.findAll('.item-name').map((element) => element.text());

describe('VersionedEntitySelector', () => {
  it('lists everything in the caller’s order with no filter', () => {
    expect(names(mountSelector())).toEqual(['Reaches', 'query-group smoke', 'settings audit']);
  });

  it('fuzzy-matches the name: a subsequence is enough, and the hit is marked', async () => {
    const wrapper = mountSelector();
    await wrapper.get('input[type="search"]').setValue('qgrp');

    expect(names(wrapper)).toEqual(['query-group smoke']);
    expect(wrapper.get('.item-name').findAll('mark').map((mark) => mark.text()).join('')).toBe('qgrp');
  });

  it('ranks best-first rather than listing in order', async () => {
    const wrapper = mountSelector();
    await wrapper.get('input[type="search"]').setValue('set');

    // "settings" starts with it; "query-group smoke" only holds it scattered.
    expect(names(wrapper)[0]).toBe('settings audit');
  });

  it('still finds a row by its description, as a plain substring', async () => {
    const wrapper = mountSelector();
    await wrapper.get('input[type="search"]').setValue('reachable node');

    expect(names(wrapper)).toEqual(['settings audit']);
  });

  it('says when the filter matches nothing', async () => {
    const wrapper = mountSelector();
    await wrapper.get('input[type="search"]').setValue('zzzz');

    expect(names(wrapper)).toEqual([]);
    expect(wrapper.text()).toContain('No items match the filter');
  });
});
