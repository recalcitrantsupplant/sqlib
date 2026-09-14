<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import type { BadgeVariants } from "."
import { reactiveOmit } from "@vueuse/core"
import { Primitive } from "reka-ui"
import { cn } from "@/lib/utils"
import { badgeVariants } from "."

const props = withDefaults(defineProps<{
  variant?: BadgeVariants["variant"]
  class?: HTMLAttributes["class"]
  as?: string
  asChild?: boolean
}>(), {
  variant: "default",
})

const delegatedProps = reactiveOmit(props, "class", "variant")
</script>

<template>
  <Primitive
    data-slot="badge"
    :class="cn(badgeVariants({ variant }), props.class)"
    v-bind="delegatedProps"
  >
    <slot />
  </Primitive>
</template>
