<template />

<script setup lang="ts">
import { watch } from 'vue'
import { toast } from 'vue-sonner'
import { useNuxtApp } from '#imports'

/*
 * The service worker's update prompt (#131). `registerType: 'prompt'` means a
 * waiting worker never takes over on its own — `needRefresh` flips once one
 * is ready, and the reload is left to the reader so an in-progress edit is
 * never interrupted by a mid-session reload. `usePWA()` is undefined when the
 * module has no service worker registered (e.g. `pnpm dev`, where
 * devOptions.enabled is false).
 */
const { $pwa: pwa } = useNuxtApp()

watch(
  () => pwa?.needRefresh,
  (needRefresh) => {
    if (!needRefresh) return
    toast('A new version is available', {
      duration: Number.POSITIVE_INFINITY,
      action: {
        label: 'Reload',
        onClick: () => pwa?.updateServiceWorker(true),
      },
    })
  },
)
</script>
