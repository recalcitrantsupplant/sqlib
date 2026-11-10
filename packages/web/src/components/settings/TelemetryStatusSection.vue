<template>
  <section v-if="status" class="settings-section" data-testid="settings-telemetry">
    <SectionLabel as="h3">Telemetry</SectionLabel>

    <div class="telemetry-row">
      <span
        class="telemetry-pill"
        :class="`telemetry-pill-${status.state}`"
        data-testid="telemetry-state"
        :title="stateTitle"
      >
        <span class="telemetry-dot" aria-hidden="true" />
        {{ stateLabel }}
      </span>
      <a
        v-if="status.dashboardUrl"
        :href="status.dashboardUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="telemetry-link"
        data-testid="telemetry-dashboard-link"
      >
        Open dashboard
        <ExternalLinkIcon :size="13" />
      </a>
    </div>

    <dl v-if="status.state !== 'off'" class="telemetry-facts">
      <div class="telemetry-fact">
        <dt>Service</dt>
        <dd>{{ status.serviceName }}</dd>
      </div>
      <div v-if="status.endpoint" class="telemetry-fact">
        <dt>Sending to</dt>
        <dd class="telemetry-mono">{{ status.endpoint }}</dd>
      </div>
      <div v-if="status.slowRuns.thresholdMs !== null" class="telemetry-fact">
        <dt :title="`Runs of ${status.slowRuns.thresholdMs} ms or more since the server started`">
          Slow runs
        </dt>
        <dd data-testid="telemetry-slow-runs">
          {{ status.slowRuns.count }}
          <span v-if="lastSlowRun" class="telemetry-muted" :title="status.slowRuns.lastAt ?? undefined">
            · last {{ lastSlowRun }}
          </span>
        </dd>
      </div>
      <div v-if="status.state === 'failing' && status.lastExportError" class="telemetry-fact">
        <dt>Last error</dt>
        <dd class="telemetry-error" :title="status.lastExportError.at">{{ status.lastExportError.message }}</dd>
      </div>
    </dl>
  </section>
</template>

<script setup lang="ts">
/**
 * Whether the server is sending telemetry, for an administrator: on or off,
 * exporting or failing, where to, slow runs since start, and a link to the
 * dashboard when the deployment names one. Read from `GET /telemetry` each time
 * Settings opens. Absent for anyone the server refuses.
 */
import { computed, onMounted, ref } from 'vue';
import { ExternalLinkIcon } from '@lucide/vue';
import SectionLabel from '../shared/SectionLabel.vue';
import { useApiClient, type TelemetryStatus } from '../../composables/useApiClient';
import { formatRelativeTime } from '../../lib/time';

const apiClient = useApiClient();
const status = ref<TelemetryStatus | null>(null);

onMounted(async () => {
  try {
    status.value = await apiClient.getTelemetryStatus();
  } catch {
    // Not an administrator, or a server without the route: no section.
    status.value = null;
  }
});

const STATE_LABELS: Record<TelemetryStatus['state'], string> = {
  off: 'Off',
  exporting: 'Exporting',
  failing: 'Failing',
};

const stateLabel = computed(() => (status.value ? STATE_LABELS[status.value.state] : ''));

const stateTitle = computed(() => {
  const value = status.value;
  if (!value || value.state === 'off') return undefined;
  return value.protocol ? `OTLP over ${value.protocol}` : undefined;
});

const lastSlowRun = computed(() =>
  status.value?.slowRuns.lastAt ? formatRelativeTime(status.value.slowRuns.lastAt) : null,
);
</script>

<style scoped>
.settings-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.telemetry-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
}

.telemetry-pill {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-label);
  font-weight: var(--weight-semibold);
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-full);
  border: 1px solid var(--border-default);
  color: var(--ink-muted);
  background: var(--surface-subtle);
}

.telemetry-dot {
  width: 7px;
  height: 7px;
  border-radius: var(--radius-full);
  background: currentColor;
}

.telemetry-pill-exporting {
  color: var(--success-ink);
  background: var(--success-surface);
  border-color: var(--success);
}

.telemetry-pill-failing {
  color: var(--danger-ink);
  background: var(--danger-surface);
  border-color: var(--danger);
}

.telemetry-link {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-label);
  font-weight: var(--weight-medium);
  color: var(--action);
  text-decoration: none;
}

.telemetry-link:hover {
  text-decoration: underline;
}

.telemetry-facts {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
}

.telemetry-fact {
  display: flex;
  justify-content: space-between;
  gap: var(--space-4);
  font-size: var(--text-label);
}

.telemetry-fact dt {
  color: var(--ink-muted);
}

.telemetry-fact dd {
  margin: 0;
  color: var(--ink);
  text-align: right;
  min-width: 0;
  overflow-wrap: anywhere;
}

.telemetry-mono {
  font-family: var(--font-mono);
}

.telemetry-muted {
  color: var(--ink-muted);
}

.telemetry-error {
  color: var(--danger-ink);
}
</style>
