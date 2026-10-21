/**
 * The DuckDB profile from flags (decision D4 of the CLI plan).
 *
 * The server defaults every capability to off, because submitted SQL reaches
 * the API's host. The CLI runs in the operator's own process, and reading local
 * files is the point, so filesystem access is on unless `--no-allow-filesystem`
 * turns it off. HTTP and extension install stay off unless asked for.
 */
import {
  DUCKDB_LIMIT_DEFAULTS,
  describeDuckDbCapabilities,
  describeDuckDbLimits,
  type DuckDbCapabilities,
  type DuckDbLimits,
} from '@sparql-query-lib/runtime-duckdb';
import { CliError } from './io.js';

export const DUCKDB_OPTIONS = {
  'allow-filesystem': { type: 'boolean', default: true },
  'allow-http': { type: 'boolean', default: false },
  'allow-extension-install': { type: 'boolean', default: false },
  unrestricted: { type: 'boolean', default: false },
  'memory-limit': { type: 'string' },
  'query-timeout': { type: 'string' },
} as const;

export interface DuckDbFlagValues {
  'allow-filesystem'?: boolean;
  'allow-http'?: boolean;
  'allow-extension-install'?: boolean;
  unrestricted?: boolean;
  'memory-limit'?: string;
  'query-timeout'?: string;
}

export function duckDbProfile(values: DuckDbFlagValues): { capabilities: DuckDbCapabilities; limits: DuckDbLimits; notes: string[] } {
  const notes: string[] = [];
  const http = values['allow-http'] === true;
  let filesystem = values['allow-filesystem'] !== false;
  if (http && !filesystem) {
    notes.push('--allow-http grants filesystem access too: DuckDB gates both on one setting.');
    filesystem = true;
  }
  let queryTimeoutMs = DUCKDB_LIMIT_DEFAULTS.queryTimeoutMs;
  if (values['query-timeout'] !== undefined) {
    queryTimeoutMs = Number(values['query-timeout']);
    if (!Number.isInteger(queryTimeoutMs) || queryTimeoutMs < 0) {
      throw new CliError(`--query-timeout takes milliseconds, 0 for none; got '${values['query-timeout']}'.`);
    }
  }
  return {
    capabilities: {
      filesystem,
      http,
      extensionInstall: values['allow-extension-install'] === true,
      unrestricted: values.unrestricted === true,
    },
    limits: {
      interactiveTimeoutMs: DUCKDB_LIMIT_DEFAULTS.interactiveTimeoutMs,
      queryTimeoutMs,
      memoryLimit: values['memory-limit'] === undefined ? DUCKDB_LIMIT_DEFAULTS.memoryLimit : values['memory-limit'] || null,
    },
    notes,
  };
}

export function describeProfile(capabilities: DuckDbCapabilities, limits: DuckDbLimits): string {
  return `duckdb: ${describeDuckDbCapabilities(capabilities)} ${describeDuckDbLimits(limits)}`;
}
