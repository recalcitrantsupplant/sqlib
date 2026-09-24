// @ts-ignore - Nuxt auto-imports
import { defineNuxtPlugin } from '#imports';
import { createKeyDispatcher, releaseEditorFocus } from '../composables/useCommandKeys';

/**
 * Installs the global keyboard dispatcher.
 *
 * One listener on the document for the whole app, in the capture phase so that
 * a shortcut is decided before a component's own `@keydown` handler — the
 * dispatcher already stands down inside inputs and CodeMirror, so capturing
 * costs nothing and stops a dialog from swallowing Mod+K.
 *
 * The commands themselves are registered elsewhere: app-wide ones by
 * `useAppCommands` in app.vue, context ones by the components that own the
 * action. This plugin knows only how to route a keystroke.
 */
export default defineNuxtPlugin(() => {
  const dispatcher = createKeyDispatcher();
  const onKeyDown = (event: KeyboardEvent) => { dispatcher.handle(event); };

  document.addEventListener('keydown', onKeyDown, { capture: true });
  // Bubble phase, so CodeMirror sees Escape first — see `releaseEditorFocus`.
  document.addEventListener('keydown', releaseEditorFocus);

  // Alt-tabbing away mid-sequence should not leave `g` armed for the return.
  const onBlur = () => dispatcher.reset();
  window.addEventListener('blur', onBlur);

  return {
    provide: {
      commandKeys: dispatcher,
    },
  };
});
