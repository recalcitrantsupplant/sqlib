/**
 * The registry and the dispatcher.
 *
 * What matters is not that a key runs a callback — it is the four rules that
 * make a keyboard layer liveable: a command that is not applicable does not
 * swallow its key, a sequence can be abandoned, typing beats shortcuts, and a
 * command unregisters with the component that owns it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { effectScope } from 'vue';

import { createKeyDispatcher, releaseEditorFocus, SEQUENCE_TIMEOUT_MS } from '@/composables/useCommandKeys';
import {
  resetCommandsForTest,
  useCommand,
  useCommandProvider,
  useCommandRegistry,
  type Command,
} from '@/composables/useCommandRegistry';

const command = (overrides: Partial<Command> & Pick<Command, 'id'>): Command => ({
  title: overrides.title ?? overrides.id,
  group: 'Go to',
  run: vi.fn(),
  ...overrides,
});

/** A keydown that records whether the dispatcher claimed it. */
const press = (key: string, init: Partial<KeyboardEventInit> = {}, target?: EventTarget) => {
  const event = new KeyboardEvent('keydown', { key, cancelable: true, ...init });
  if (target) Object.defineProperty(event, 'target', { value: target });
  return event;
};

beforeEach(() => {
  resetCommandsForTest();
});

describe('the registry', () => {
  it('runs a command by id', () => {
    const run = vi.fn();
    useCommand(command({ id: 'query.run', run }));
    expect(useCommandRegistry().execute('query.run')).toBe(true);
    expect(run).toHaveBeenCalledOnce();
  });

  it('refuses to run a command whose moment has passed', () => {
    const run = vi.fn();
    useCommand(command({ id: 'query.save', when: () => false, run }));
    expect(useCommandRegistry().execute('query.save')).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it('drops a component’s commands when its scope dies', () => {
    const scope = effectScope();
    scope.run(() => { useCommand(command({ id: 'query.run' })); });
    expect(useCommandRegistry().all.value).toHaveLength(1);
    scope.stop();
    expect(useCommandRegistry().all.value).toHaveLength(0);
  });

  it('keeps a re-registration when the old owner disposes', () => {
    const first = command({ id: 'query.run', title: 'old' });
    const dispose = useCommand(first);
    useCommand(command({ id: 'query.run', title: 'new' }));
    dispose();
    expect(useCommandRegistry().all.value[0]?.title).toBe('new');
  });

  it('offers provider commands to the palette but not to the key layer', () => {
    useCommandProvider(() => [command({ id: 'go.query.1', title: 'Query: one' })]);
    const registry = useCommandRegistry();
    expect(registry.palette().map((entry) => entry.id)).toContain('go.query.1');
    expect(registry.available.value).toHaveLength(0);
  });

  it('keeps hidden commands out of the palette', () => {
    useCommand(command({ id: 'palette.open', hidden: true }));
    expect(useCommandRegistry().palette()).toHaveLength(0);
  });
});

describe('the dispatcher', () => {
  it('runs a chord and claims the event', () => {
    const run = vi.fn();
    useCommand(command({ id: 'query.run', keys: 'Mod+Enter', run }));
    const event = press('Enter', { ctrlKey: true });
    createKeyDispatcher().handle(event);
    expect(run).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it('runs a sequence, and consumes its first key', () => {
    const run = vi.fn();
    useCommand(command({ id: 'go.queries', keys: 'g q', run }));
    const dispatcher = createKeyDispatcher();

    const first = press('g');
    dispatcher.handle(first);
    expect(first.defaultPrevented).toBe(true);
    expect(run).not.toHaveBeenCalled();
    expect(dispatcher.pending()).toEqual(['g']);

    dispatcher.handle(press('q'));
    expect(run).toHaveBeenCalledOnce();
    expect(dispatcher.pending()).toEqual([]);
  });

  it('forgets a sequence that was left hanging', () => {
    const run = vi.fn();
    useCommand(command({ id: 'go.queries', keys: 'g q', run }));
    let now = 0;
    const dispatcher = createKeyDispatcher(() => now);

    dispatcher.handle(press('g'));
    now += SEQUENCE_TIMEOUT_MS + 1;
    dispatcher.handle(press('q'));
    expect(run).not.toHaveBeenCalled();
  });

  it('retries the key that ended a sequence on its own', () => {
    const palette = vi.fn();
    useCommand([
      command({ id: 'go.queries', keys: 'g q' }),
      command({ id: 'palette.open', keys: 'Mod+k', run: palette }),
    ]);
    const dispatcher = createKeyDispatcher();

    dispatcher.handle(press('g'));
    dispatcher.handle(press('k', { ctrlKey: true }));
    expect(palette).toHaveBeenCalledOnce();
  });

  it('leaves the key alone when no command is applicable', () => {
    const run = vi.fn();
    useCommand(command({ id: 'query.run', keys: 'Mod+Enter', when: () => false, run }));
    const event = press('Enter', { ctrlKey: true });
    createKeyDispatcher().handle(event);
    expect(run).not.toHaveBeenCalled();
    // The browser, or the focused control, still gets its turn.
    expect(event.defaultPrevented).toBe(false);
  });

  it('stands down inside an input for anything typing could produce', () => {
    const sequence = vi.fn();
    const save = vi.fn();
    useCommand([
      command({ id: 'go.queries', keys: 'g q', run: sequence }),
      command({ id: 'query.save', keys: 'Mod+s', run: save }),
    ]);
    const field = document.createElement('input');
    const dispatcher = createKeyDispatcher();

    dispatcher.handle(press('g', {}, field));
    dispatcher.handle(press('q', {}, field));
    expect(sequence).not.toHaveBeenCalled();

    dispatcher.handle(press('s', { ctrlKey: true }, field));
    expect(save).toHaveBeenCalledOnce();
  });

  it('ignores a modifier pressed on its own mid-sequence', () => {
    const run = vi.fn();
    useCommand(command({ id: 'go.queries', keys: 'g q', run }));
    const dispatcher = createKeyDispatcher();

    dispatcher.handle(press('g'));
    dispatcher.handle(press('Shift', { shiftKey: true }));
    dispatcher.handle(press('q'));
    expect(run).toHaveBeenCalledOnce();
  });

  it('ignores keydowns that belong to an IME composition', () => {
    const run = vi.fn();
    useCommand(command({ id: 'go.queries', keys: 'g q', run }));
    const dispatcher = createKeyDispatcher();
    const composing = press('g');
    Object.defineProperty(composing, 'isComposing', { value: true });
    dispatcher.handle(composing);
    expect(dispatcher.pending()).toEqual([]);
  });
});

describe('escaping an editor', () => {
  const editor = () => {
    const root = document.createElement('div');
    root.className = 'cm-editor';
    const content = document.createElement('div');
    content.className = 'cm-content';
    content.contentEditable = 'true';
    content.tabIndex = 0;
    root.appendChild(content);
    document.body.appendChild(root);
    content.focus();
    return content;
  };

  it('hands focus back to the page, so `g q` works again', () => {
    const run = vi.fn();
    useCommand(command({ id: 'go.queries', keys: 'g q', run }));
    const content = editor();
    expect(document.activeElement).toBe(content);

    expect(releaseEditorFocus(press('Escape', {}, content))).toBe(true);
    expect(document.activeElement).not.toBe(content);

    const dispatcher = createKeyDispatcher();
    dispatcher.handle(press('g', {}, document.body));
    dispatcher.handle(press('q', {}, document.body));
    expect(run).toHaveBeenCalledOnce();
    content.parentElement?.remove();
  });

  it('leaves an Escape the editor already used alone', () => {
    const content = editor();
    const event = press('Escape', {}, content);
    event.preventDefault();
    expect(releaseEditorFocus(event)).toBe(false);
    expect(document.activeElement).toBe(content);
    content.parentElement?.remove();
  });

  it('ignores Escape outside an editor', () => {
    expect(releaseEditorFocus(press('Escape', {}, document.body))).toBe(false);
  });
});
