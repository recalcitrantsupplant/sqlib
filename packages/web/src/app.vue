<template>
  <NuxtPage />
  <Sonner position="bottom-right" :toast-options="{ duration: 2000 }" />
  <!--
    Mounted once, above every page: the palette and the cheat sheet are opened
    by a command, which has no page to belong to. PwaUpdatePrompt is the same
    shape — a watcher with no page of its own.
  -->
  <CommandPalette />
  <ShortcutCheatSheet />
  <PwaUpdatePrompt />
</template>

<script setup lang="ts">
import 'vue-sonner/style.css'
import Sonner from '~/components/ui/sonner/Sonner.vue'
import CommandPalette from './components/CommandPalette.vue'
import ShortcutCheatSheet from './components/ShortcutCheatSheet.vue'
import PwaUpdatePrompt from './components/PwaUpdatePrompt.vue'
import { useAppCommands } from './composables/useAppCommands'
import { useTheme } from '~/composables/useTheme'

// Installs the .dark class watcher; the theme itself is the .dark block in tokens.css.
useTheme()

/*
 * The app-wide commands — navigation, the palette, the view toggles. Here
 * rather than in the key plugin because they are Vue-scoped (router, stores)
 * and because registration is what the plugin dispatches *against*; the plugin
 * only routes keystrokes.
 */
useAppCommands()
</script>

<style>
@import './assets/css/compact-buttons.css';
@import './assets/css/format-dropdown.css';
@import './assets/css/results-chrome.css';

/* Global font: Inter with fallbacks */
body {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* Preserve CodeMirror's font settings */
.cm-editor,
.cm-content,
.cm-line {
  font-family: inherit !important;
}

/* Fix Sonner toast positioning */
:deep([data-sonner-toaster]) {
  position: fixed !important;
  z-index: 9999 !important;
  pointer-events: none;
}

:deep([data-sonner-toast]) {
  pointer-events: auto;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
}
</style>
