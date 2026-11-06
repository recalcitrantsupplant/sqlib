import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import TelemetryStatusSection from '@/components/settings/TelemetryStatusSection.vue';
import type { TelemetryStatus } from '@/composables/useApiClient';

const api = vi.hoisted(() => ({ getTelemetryStatus: vi.fn() }));
vi.mock('@/composables/useApiClient', () => ({ useApiClient: () => api }));

function status(overrides: Partial<TelemetryStatus> = {}): TelemetryStatus {
  return {
    state: 'exporting',
    serviceName: 'sqlib',
    endpoint: 'collector:4318',
    protocol: 'http/protobuf',
    lastExportError: null,
    slowRuns: { count: 3, lastAt: new Date().toISOString(), thresholdMs: 1000 },
    detail: 'ids',
    dashboardUrl: 'https://grafana.example/d/sqlib',
    traceLinks: true,
    ...overrides,
  };
}

async function render(value: TelemetryStatus | Error) {
  if (value instanceof Error) api.getTelemetryStatus.mockRejectedValue(value);
  else api.getTelemetryStatus.mockResolvedValue(value);
  const wrapper = mount(TelemetryStatusSection);
  await flushPromises();
  return wrapper;
}

describe('TelemetryStatusSection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the state, where telemetry goes, slow runs and the dashboard link', async () => {
    const wrapper = await render(status());
    expect(wrapper.get('[data-testid="telemetry-state"]').text()).toBe('Exporting');
    expect(wrapper.text()).toContain('collector:4318');
    expect(wrapper.get('[data-testid="telemetry-slow-runs"]').text()).toMatch(/^3/);
    const link = wrapper.get('[data-testid="telemetry-dashboard-link"]');
    expect(link.attributes('href')).toBe('https://grafana.example/d/sqlib');
    expect(link.attributes('target')).toBe('_blank');
  });

  it('shows the last error only while failing', async () => {
    const error = { at: new Date().toISOString(), message: 'connect ECONNREFUSED' };
    const failing = await render(status({ state: 'failing', lastExportError: error }));
    expect(failing.get('[data-testid="telemetry-state"]').text()).toBe('Failing');
    expect(failing.text()).toContain('connect ECONNREFUSED');

    const recovered = await render(status({ lastExportError: error }));
    expect(recovered.text()).not.toContain('connect ECONNREFUSED');
  });

  it('shows only the pill when telemetry is off', async () => {
    const wrapper = await render(
      status({ state: 'off', serviceName: null, endpoint: null, dashboardUrl: null, traceLinks: false }),
    );
    expect(wrapper.get('[data-testid="telemetry-state"]').text()).toBe('Off');
    expect(wrapper.find('dl').exists()).toBe(false);
    expect(wrapper.find('[data-testid="telemetry-dashboard-link"]').exists()).toBe(false);
  });

  it('renders nothing when the server refuses', async () => {
    const wrapper = await render(new Error('403'));
    expect(wrapper.find('[data-testid="settings-telemetry"]').exists()).toBe(false);
  });
});
