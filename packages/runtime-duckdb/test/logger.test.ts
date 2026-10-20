import {
  DUCKDB_CLOSED_PROFILE,
  DUCKDB_LIMIT_DEFAULTS,
  DuckDbService,
  describeDuckDbCapabilities,
  duckDbInstanceConfig,
  type DuckDbLogger,
} from '../src/index.js';

let duckdbAvailable = true;
try {
  await import('@duckdb/node-api');
} catch {
  duckdbAvailable = false;
}

function recordingLogger(): { logger: DuckDbLogger; lines: Array<{ level: string; args: unknown[] }> } {
  const lines: Array<{ level: string; args: unknown[] }> = [];
  const at = (level: string) => (...args: unknown[]) => { lines.push({ level, args }); };
  return { logger: { debug: at('debug'), info: at('info'), warn: at('warn') } as DuckDbLogger, lines };
}

describe('the closed profile', () => {
  it('grants nothing', () => {
    expect(duckDbInstanceConfig(DUCKDB_CLOSED_PROFILE, DUCKDB_LIMIT_DEFAULTS)).toEqual({
      enable_external_access: 'false',
      autoinstall_known_extensions: 'false',
      autoload_known_extensions: 'false',
      memory_limit: '1GB',
    });
    expect(describeDuckDbCapabilities(DUCKDB_CLOSED_PROFILE))
      .toBe('filesystem=false http=false extensionInstall=false configLocked=true');
  });
});

describe.skipIf(!duckdbAvailable)('the logger option', () => {
  it('reports the resolved profile to the host logger once DuckDB loads', async () => {
    const { logger, lines } = recordingLogger();
    const service = new DuckDbService(DUCKDB_CLOSED_PROFILE, DUCKDB_LIMIT_DEFAULTS, { logger });
    await service.waitForInit();

    const loaded = lines.find(line => line.level === 'info');
    expect(loaded?.args).toEqual([
      {
        capabilities: 'filesystem=false http=false extensionInstall=false configLocked=true',
        limits: 'interactiveTimeout=30000ms queryTimeout=300000ms memoryLimit=1GB',
      },
      'DuckDbService: DuckDB loaded successfully',
    ]);
  });

  it('runs silently when no logger is given', async () => {
    const service = new DuckDbService(DUCKDB_CLOSED_PROFILE, DUCKDB_LIMIT_DEFAULTS);
    await service.waitForInit();
    expect(service.isAvailable()).toBe(true);
  });
});
