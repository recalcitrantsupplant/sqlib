import { describe, it, expect, beforeEach } from 'vitest';
import { nextTick } from 'vue';
import { getRememberedTab, rememberTab, useRememberedTab } from '@/lib/inspectorTabs';

const TABS = ['details', 'arguments', 'results', 'code'] as const;

describe('inspectorTabs', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('keeps one tab per rail', () => {
    rememberTab('query', 'results');
    rememberTab('ruleSet', 'code');
    expect(getRememberedTab('query', TABS)).toBe('results');
    expect(getRememberedTab('ruleSet', TABS)).toBe('code');
  });

  it('ignores a remembered tab that the screen does not have', () => {
    rememberTab('query', 'stratification');
    expect(getRememberedTab('query', TABS)).toBeNull();
  });

  it('survives corrupt storage', () => {
    window.localStorage.setItem('sqlib.inspectorTabs.v1', '{not json');
    expect(getRememberedTab('query', TABS)).toBeNull();
    rememberTab('query', 'code');
    expect(getRememberedTab('query', TABS)).toBe('code');
  });

  it('starts a new ref on the remembered tab and remembers each change', async () => {
    expect(useRememberedTab('query', TABS, 'details').value).toBe('details');
    const tab = useRememberedTab('query', TABS, 'details');
    tab.value = 'results';
    await nextTick();
    expect(useRememberedTab('query', TABS, 'details').value).toBe('results');
  });
});
