/**
 * The palette, end to end from the registry.
 *
 * The dispatcher's rules are pinned in `test/composables/commands.spec.ts`;
 * what is left to prove here is the wiring — that what the registry holds is
 * what the palette lists, that provider commands (jump to a query) show up
 * beside registered ones, that the search ranks rather than filters blindly,
 * and that Enter runs the row the arrow keys landed on.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

import CommandPalette from '@/components/CommandPalette.vue';
import { useCommandPalette } from '@/composables/useCommandPalette';
import {
  resetCommandsForTest,
  useCommand,
  useCommandProvider,
  type Command,
} from '@/composables/useCommandRegistry';

// The palette asks the stores to fill in when they are empty; nothing in these
// tests depends on the answer, only on it not being a real request.
const api = vi.hoisted(() => ({
  listQueries: vi.fn().mockResolvedValue([]),
  listQueryGroups: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/composables/useApiClient', () => ({ useApiClient: () => api }));

const command = (overrides: Partial<Command> & Pick<Command, 'id' | 'title'>): Command => ({
  group: 'Go to',
  run: vi.fn(),
  ...overrides,
});

const { paletteOpen, closePalette } = useCommandPalette();

async function openPalette() {
  const wrapper = mount(CommandPalette, { attachTo: document.body });
  paletteOpen.value = true;
  // The dialog's content is teleported to the body, so everything below reads
  // the document rather than the wrapper.
  await nextTick();
  await nextTick();
  return wrapper;
}

const rows = (): string[] =>
  [...document.querySelectorAll('.palette__row .palette__title')].map((row) => row.textContent?.trim() ?? '');

const input = (): HTMLInputElement =>
  document.querySelector<HTMLInputElement>('[data-testid="command-palette-input"]')!;

async function search(term: string): Promise<void> {
  const field = input();
  field.value = term;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  await nextTick();
}

async function press(key: string): Promise<void> {
  input().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  await nextTick();
}

beforeEach(() => {
  vi.clearAllMocks();
  resetCommandsForTest();
  closePalette();
  document.body.innerHTML = '';
});

describe('CommandPalette', () => {
  it('lists the applicable commands, and skips the ones that do not apply', async () => {
    useCommand([
      command({ id: 'go.queries', title: 'Go to Queries', keys: 'g q' }),
      command({ id: 'query.save', title: 'Save the query', group: 'Query', when: () => false }),
    ]);

    const wrapper = await openPalette();
    expect(rows()).toEqual(['Go to Queries']);
    wrapper.unmount();
  });

  it('shows a command\u2019s binding beside it, in the platform\u2019s spelling', async () => {
    useCommand(command({ id: 'go.queries', title: 'Go to Queries', keys: 'g q' }));

    const wrapper = await openPalette();
    expect(document.querySelector('.palette__keys')?.textContent).toBe('G Q');
    wrapper.unmount();
  });

  it('offers provider commands beside registered ones', async () => {
    useCommand(command({ id: 'go.queries', title: 'Go to Queries' }));
    useCommandProvider(() => [command({ id: 'go.query.1', title: 'Query: Countries' })]);

    const wrapper = await openPalette();
    expect(rows()).toContain('Query: Countries');
    wrapper.unmount();
  });

  it('keeps hidden commands out of the list', async () => {
    useCommand([
      command({ id: 'palette.open', title: 'Command palette', group: 'Help', hidden: true }),
      command({ id: 'go.queries', title: 'Go to Queries' }),
    ]);

    const wrapper = await openPalette();
    expect(rows()).toEqual(['Go to Queries']);
    wrapper.unmount();
  });

  it('ranks on the title and on keywords that are never shown', async () => {
    useCommand([
      command({ id: 'go.backends', title: 'Go to Backends' }),
      command({ id: 'view.theme', title: 'Toggle dark mode', group: 'View', keywords: 'appearance' }),
    ]);

    const wrapper = await openPalette();
    await search('appear');
    expect(rows()).toEqual(['Toggle dark mode']);
    wrapper.unmount();
  });

  it('runs the row the arrow keys landed on, and closes', async () => {
    const second = vi.fn();
    useCommand([
      command({ id: 'go.queries', title: 'A first' }),
      command({ id: 'go.groups', title: 'B second', run: second }),
    ]);

    const wrapper = await openPalette();
    await press('ArrowDown');
    await press('Enter');
    await nextTick();

    expect(second).toHaveBeenCalledOnce();
    expect(paletteOpen.value).toBe(false);
    wrapper.unmount();
  });

  it('says so rather than showing an empty list', async () => {
    useCommand(command({ id: 'go.queries', title: 'Go to Queries' }));

    const wrapper = await openPalette();
    await search('zzzz');
    expect(document.querySelector('.palette__empty')).not.toBeNull();
    wrapper.unmount();
  });
});
