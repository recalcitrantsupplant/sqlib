<template>
  <div class="timing-donut" role="img" :aria-label="ariaLabel">
    <svg class="donut" viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="22" class="ring-bg" />
      <circle
        v-for="arc in arcs"
        :key="arc.key"
        cx="32"
        cy="32"
        r="22"
        class="arc"
        :class="`arc-${arc.key}`"
        :stroke-dasharray="`${arc.len} ${CIRCUMFERENCE - arc.len}`"
        :stroke-dashoffset="arc.offset"
        transform="rotate(-90 32 32)"
      />
      <text x="32" y="36" class="total">{{ totalLabel }}</text>
      <text x="32" y="48" class="units">ms</text>
    </svg>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    networkMs?: number | null;
    appMs?: number | null;
    triplestoreMs?: number | null;
    totalMs?: number | null;
    ariaLabel?: string;
  }>(),
  {
    networkMs: 0,
    appMs: 0,
    triplestoreMs: 0,
    totalMs: 0,
    ariaLabel: 'Execution timing',
  },
);

const CIRCUMFERENCE = 2 * Math.PI * 22;

const totalMsSafe = computed(() => Math.max(0, props.totalMs ?? 0));
const netMsSafe = computed(() => Math.max(0, props.networkMs ?? 0));
const tsMsSafe = computed(() => Math.max(0, props.triplestoreMs ?? 0));

const appMsSafe = computed(() => Math.max(0, props.appMs ?? 0));

const totalLabel = computed(() => {
  if (!Number.isFinite(totalMsSafe.value) || totalMsSafe.value <= 0) return '0';
  if (totalMsSafe.value >= 1000) return Math.round(totalMsSafe.value).toString();
  return Math.max(1, Math.round(totalMsSafe.value)).toString();
});

type ArcSegment = { key: 'net' | 'app' | 'ts'; len: number; offset: number };

const arcs = computed<ArcSegment[]>(() => {
  if (!totalMsSafe.value || totalMsSafe.value <= 0) return [];

  const parts: Array<{ key: ArcSegment['key']; value: number }> = [
    { key: 'net' as const, value: netMsSafe.value },
    { key: 'app' as const, value: appMsSafe.value },
    { key: 'ts' as const, value: tsMsSafe.value },
  ].filter((p) => Number.isFinite(p.value) && p.value > 0);

  if (parts.length === 0) return [];

  const totalRaw = parts.reduce((sum, p) => sum + p.value, 0);
  if (totalRaw <= 0) return [];

  const scale = totalRaw > totalMsSafe.value ? totalMsSafe.value / totalRaw : 1;

  let offset = 0;
  return parts.map((p) => {
    const len = (p.value * scale / totalMsSafe.value) * CIRCUMFERENCE;
    const seg: ArcSegment = { key: p.key, len, offset: -offset };
    offset += len;
    return seg;
  });
});
</script>

<style scoped>
.timing-donut {
  width: 64px;
  height: 64px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.donut {
  width: 54px;
  height: 54px;
  display: block;
}

.ring-bg {
  fill: none;
  stroke: rgba(15, 23, 42, 0.12);
  stroke-width: 8;
}

.arc {
  fill: none;
  stroke-width: 8;
  stroke-linecap: butt;
}

.arc-net {
  stroke: var(--action); /* brighter blue for network */
  opacity: 0.95;
}

.arc-app {
  stroke: var(--violet-500); /* purple for app/qlib */
  opacity: 0.9;
}

.arc-ts {
  stroke: var(--action);
  opacity: 0.7;
}

.total {
  font-size: var(--text-micro);
  fill: var(--ink);
  text-anchor: middle;
  font-weight: 700;
}

.units {
  font-size: var(--text-micro);
  fill: var(--ink-secondary);
  text-anchor: middle;
  font-weight: 500;
}

/* Dark rules hang off the .dark class the theme switch sets, not the OS
   preference: a preference pinned in Settings against the OS otherwise
   left this block applying in light mode, or not applying in dark. */
.dark .ring-bg {
  stroke: rgba(255, 255, 255, 0.1);
}

.dark .total {
  fill: rgba(229, 231, 235, 0.92);
}

.dark .units {
  fill: rgba(229, 231, 235, 0.6);
}
</style>
