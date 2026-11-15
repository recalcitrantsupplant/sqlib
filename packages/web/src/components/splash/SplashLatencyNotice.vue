<template>
  <div v-if="visible" class="latency-notice" role="status" data-testid="splash-latency-notice">
    <Clock :size="15" class="latency-icon" aria-hidden="true" />
    <span class="latency-time" data-testid="splash-latency-time">Server {{ roundTripMs }} ms away</span>
    <span v-if="location" class="latency-location" data-testid="splash-latency-location">Hosted in {{ location }}</span>
    <a
      class="latency-link"
      :href="DEPLOY_DOC_URL"
      target="_blank"
      rel="noreferrer"
      data-testid="splash-latency-link"
    >Deploy near you and your data</a>
    <button
      type="button"
      class="latency-hide"
      title="Hide"
      aria-label="Hide"
      data-testid="splash-latency-hide"
      @click="hide"
    >
      <X :size="14" />
    </button>
  </div>
</template>

<script setup lang="ts">
/**
 * A warning row under the command field when the API is far from this browser.
 *
 * It shows at `SLOW_ROUND_TRIP_MS` or more. Hide keeps it hidden in this
 * browser until the round trip moves into a higher 100 ms band, so a server
 * that becomes slower shows the row again.
 */
import { computed, onMounted, ref } from 'vue';
import { Clock, X } from '@lucide/vue';
import { useServerLatency } from '../../composables/useServerLatency';
import { docUrl } from '../../lib/docs';

const DEPLOY_DOC_URL = docUrl('guides/deploying.md#where-to-run-sqlib');
const HIDDEN_KEY = 'sqlib-latency-notice-hidden-band';

const { roundTripMs, location, isSlow, ensureMeasured } = useServerLatency();

function readHiddenBand(): number | null {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY);
    const value = raw === null ? NaN : Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

const hiddenBand = ref<number | null>(readHiddenBand());
const band = computed(() => (roundTripMs.value === null ? null : Math.floor(roundTripMs.value / 100)));

const visible = computed(
  () => isSlow.value && band.value !== null && (hiddenBand.value === null || band.value > hiddenBand.value),
);

function hide() {
  if (band.value === null) return;
  hiddenBand.value = band.value;
  try {
    localStorage.setItem(HIDDEN_KEY, String(band.value));
  } catch {
    // Storage is blocked. The row stays hidden until the page reloads.
  }
}

onMounted(() => {
  void ensureMeasured();
});
</script>

<style scoped>
.latency-notice {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-4);
  width: 100%;
  max-width: 560px;
  box-sizing: border-box;
  padding: var(--space-2) var(--space-4);
  border: 1px solid var(--warning-border);
  border-radius: var(--radius-lg);
  background: var(--warning-surface);
  color: var(--warning-ink);
  font-size: var(--text-label);
}

.latency-icon {
  flex-shrink: 0;
}

.latency-time {
  font-weight: var(--weight-semibold);
  font-variant-numeric: tabular-nums;
}

.latency-location {
  opacity: 0.85;
}

.latency-link {
  margin-left: auto;
  color: inherit;
  font-weight: var(--weight-medium);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.latency-hide {
  display: inline-flex;
  align-items: center;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  cursor: pointer;
}

.latency-hide:focus-visible,
.latency-link:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}
</style>
