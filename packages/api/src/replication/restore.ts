/**
 * Restore the SQLite files from their replicas before the server starts.
 *
 * Each file is restored to `<file>.restoring` first and only then moved into
 * place, so a failed or partial restore never leaves a half-written database
 * where the server will open it. Any failure other than "no replica yet" stops
 * the start: a server that started on an empty or stale file would upload that
 * state as the newest one.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { ReplicatedDatabase } from './litestreamConfig.js';
import type { RestorePolicy } from './settings.js';

export type RestoreOutcome =
  /** The replica was restored and replaced any local file. */
  | 'restored'
  /** No replica exists yet. The local file, if any, is used. */
  | 'no-replica'
  /** `local` policy and a non-empty local file: the file is used as is. */
  | 'kept-local'
  /** `never` policy. */
  | 'skipped';

export interface CommandResult {
  code: number;
  output: string;
}

export type CommandRunner = (command: string, args: readonly string[]) => Promise<CommandResult>;

/** Runs a command and collects its combined output, which Litestream uses for its errors. */
export const runCommand = (command: string, args: readonly string[], env: NodeJS.ProcessEnv = process.env): Promise<CommandResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, output }));
  });

export class RestoreError extends Error {
  constructor(readonly database: string, detail: string) {
    super(`Could not restore the ${database} database from its replica, so sqlib will not start. ${detail}`);
    this.name = 'RestoreError';
  }
}

/** The SQLite and Litestream files that belong to a database file. */
function sidecars(file: string): string[] {
  const dir = path.dirname(file);
  const base = path.basename(file);
  return [`${file}-wal`, `${file}-shm`, path.join(dir, `.${base}-litestream`)];
}

function removeAll(paths: readonly string[]): void {
  for (const target of paths) fs.rmSync(target, { recursive: true, force: true });
}

function nonEmptyFile(file: string): boolean {
  try {
    return fs.statSync(file).size > 0;
  } catch {
    return false;
  }
}

/** The last lines of Litestream's output, which hold the error. */
function tail(output: string): string {
  const lines = output.trim().split('\n').filter(Boolean);
  return lines.slice(-3).join(' | ') || 'Litestream gave no output.';
}

export async function restoreDatabase(
  database: ReplicatedDatabase,
  options: { policy: RestorePolicy; configPath: string; litestreamBin: string; run?: CommandRunner },
): Promise<RestoreOutcome> {
  const { policy, configPath, litestreamBin, run = runCommand } = options;
  if (policy === 'never') return 'skipped';
  if (policy === 'local' && nonEmptyFile(database.path)) return 'kept-local';

  const staging = `${database.path}.restoring`;
  fs.mkdirSync(path.dirname(database.path), { recursive: true });
  removeAll([staging, ...sidecars(staging)]);

  let result: CommandResult;
  try {
    result = await run(litestreamBin, ['restore', '-config', configPath, '-if-replica-exists', '-o', staging, database.path]);
  } catch (error) {
    throw new RestoreError(database.name, `Could not run ${litestreamBin}: ${(error as Error).message}`);
  }
  if (result.code !== 0) {
    removeAll([staging, ...sidecars(staging)]);
    throw new RestoreError(database.name, tail(result.output));
  }
  if (!fs.existsSync(staging)) return 'no-replica';

  // The replica wins: the local file, its WAL and Litestream's position for it
  // all describe an older state.
  removeAll([database.path, ...sidecars(database.path)]);
  fs.renameSync(staging, database.path);
  removeAll(sidecars(staging));
  fs.chmodSync(database.path, 0o600);
  return 'restored';
}
