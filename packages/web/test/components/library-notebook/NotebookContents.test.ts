/**
 * The contents rail.
 *
 * The rail's width was going on a two-line description under every entry, which
 * made long slugs wrap anyway. Density is the answer, and it is the sidebars'
 * own control and the sidebars' own stored preference — so what is asserted
 * here is that both rows agree about what a compact row shows.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import NotebookContents from '@/components/library-notebook/NotebookContents.vue';

function entry(slug: string, description: string | null) {
  return {
    slug,
    query: { queryType: 'SELECT', description, tags: [] },
  } as never;
}

const QUERIES = [entry('resolve-focus-nodes', 'Run once: every focus node and its target class.')];

function mountContents() {
  return mount(NotebookContents, {
    props: {
      queries: QUERIES,
      visible: new Set(['resolve-focus-nodes']),
      skipped: [],
      tags: [],
      search: '',
      grouping: 'kind' as const,
    },
  });
}

describe('NotebookContents', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('is one line an entry when compact, with the description in the tooltip', async () => {
    const w = mountContents();
    // Settings are a module singleton, so the state under test is asked for
    // rather than assumed from whatever ran before.
    await w.find('[data-testid="density-compact"]').trigger('click');
    const row = w.find('[data-testid="notebook-toc-resolve-focus-nodes"]');
    expect(row.find('.entry__desc').exists()).toBe(false);
    expect(row.attributes('title')).toBe('Run once: every focus node and its target class.');
    // The kind badge is not what compact economises on: reading what an entry
    // returns without opening it is the rail's whole promise.
    expect(row.text()).toContain('SELECT');
  });

  it('shows the description once comfortable is chosen', async () => {
    const w = mountContents();
    await w.find('[data-testid="density-comfortable"]').trigger('click');
    const row = w.find('[data-testid="notebook-toc-resolve-focus-nodes"]');
    expect(row.find('.entry__desc').text()).toBe('Run once: every focus node and its target class.');
    expect(row.text()).toContain('SELECT');
  });
});
