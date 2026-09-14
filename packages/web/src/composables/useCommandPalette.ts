import { ref } from 'vue';

/**
 * Whether the palette and the cheat sheet are open.
 *
 * Module state rather than props: both are mounted once in app.vue and opened
 * from a command, which has no component to talk to.
 */
const paletteOpen = ref(false);
const cheatSheetOpen = ref(false);

export function useCommandPalette() {
  return {
    paletteOpen,
    cheatSheetOpen,
    openPalette: () => { paletteOpen.value = true; },
    closePalette: () => { paletteOpen.value = false; },
    togglePalette: () => { paletteOpen.value = !paletteOpen.value; },
    toggleCheatSheet: () => { cheatSheetOpen.value = !cheatSheetOpen.value; },
  };
}
