/**
 * The container entrypoint when SQLite replication is on.
 *
 *   1. Build the Litestream config from sqlib's own config.
 *   2. Take the replica lease, so no other instance writes the same replica.
 *   3. Restore each SQLite file from its replica.
 *   4. Run `litestream replicate -exec <the server command>`.
 *   5. Renew the lease while it runs; stop the server if the lease is lost.
 *   6. Release the lease once Litestream has made its last sync and exited.
 *
 * Signals go to Litestream, which passes them to the server, waits for it to
 * exit, and then syncs one last time.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildLitestreamConfig, listDatabases } from './litestreamConfig.js';
import { ObjectLease, type Lease } from './lease.js';
import { restoreDatabase, runCommand, type CommandRunner } from './restore.js';
import { readReplicaSettings, type ReplicaSettings } from './settings.js';

export interface SupervisorLogger {
  info(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

/** One JSON line per event on stderr, next to Litestream's and the server's logs. */
export const jsonLogger: SupervisorLogger = {
  info: (msg, fields) => process.stderr.write(`${JSON.stringify({ level: 'info', name: 'sqlib-replica', msg, ...fields })}\n`),
  error: (msg, fields) => process.stderr.write(`${JSON.stringify({ level: 'error', name: 'sqlib-replica', msg, ...fields })}\n`),
};

export interface SupervisorOptions {
  env?: NodeJS.ProcessEnv;
  logger?: SupervisorLogger;
  /** Overrides the lease, for tests. */
  createLease?: (settings: ReplicaSettings) => Promise<Lease>;
  run?: CommandRunner;
  /** How long to wait for the child after a lost lease before SIGKILL. */
  killAfterMs?: number;
}

async function defaultCreateLease(settings: ReplicaSettings): Promise<Lease> {
  const { createLeaseStore } = await import('./leaseStores.js');
  return new ObjectLease(await createLeaseStore(settings), { ttlMs: settings.leaseTtlMs });
}

/** POSIX single quotes: the text exactly, with each `'` as `'\''`. */
export function shellQuote(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/**
 * The server command as a script for `-exec`. Litestream splits `-exec` with
 * its own word parser, which cannot carry every quote a command may hold; a
 * script run by `sh` can, and its `exec` leaves no extra shell behind.
 */
function writeChildScript(dir: string, command: readonly string[]): string {
  const file = path.join(dir, 'server.sh');
  fs.writeFileSync(file, `exec ${command.map(shellQuote).join(' ')}\n`, { mode: 0o600 });
  return file;
}

function waitForExit(child: ChildProcess): Promise<number> {
  return new Promise((resolve) => {
    child.on('error', () => resolve(1));
    child.on('exit', (code, signal) => resolve(code ?? (signal ? 128 + (os.constants.signals[signal] ?? 0) : 1)));
  });
}

/** Runs a command with no replication: the path when the feature is off. */
async function passThrough(command: readonly string[]): Promise<number> {
  const child = spawn(command[0], command.slice(1), { stdio: 'inherit' });
  const forward = (signal: NodeJS.Signals) => child.kill(signal);
  process.on('SIGTERM', forward);
  process.on('SIGINT', forward);
  try {
    return await waitForExit(child);
  } finally {
    process.off('SIGTERM', forward);
    process.off('SIGINT', forward);
  }
}

export async function runSupervisor(command: readonly string[], options: SupervisorOptions = {}): Promise<number> {
  const env = options.env ?? process.env;
  const logger = options.logger ?? jsonLogger;
  if (command.length === 0) throw new Error('sqlib-replica: no server command given.');

  const settings = readReplicaSettings(env);
  if (!settings) return passThrough(command);

  const databases = listDatabases(env);
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlib-replica-'));
  let lease: Lease | null = null;

  // A stop before the server starts (while waiting for the lease, or during a
  // restore) releases the lease, so the next instance need not wait it out.
  const stopEarly = () => {
    void (lease ? lease.release() : Promise.resolve()).finally(() => {
      fs.rmSync(workDir, { recursive: true, force: true });
      process.exit(143);
    });
  };
  process.once('SIGTERM', stopEarly);
  process.once('SIGINT', stopEarly);

  try {
    let configPath: string;
    if (settings.customConfigPath) {
      configPath = settings.customConfigPath;
      logger.info('Using the operator Litestream config', { config: configPath });
    } else {
      configPath = path.join(workDir, 'litestream.yml');
      fs.writeFileSync(configPath, buildLitestreamConfig(databases, settings), { mode: 0o600 });
    }

    if (settings.lease) {
      lease = await (options.createLease ?? defaultCreateLease)(settings);
      logger.info('Waiting for the replica lease', { lease: lease.description, holder: lease.holder });
      await lease.acquire(settings.leaseWaitMs);
      logger.info('Holding the replica lease', { lease: lease.description, holder: lease.holder });
    }

    for (const database of databases) {
      const outcome = await restoreDatabase(database, {
        policy: settings.restore,
        configPath,
        litestreamBin: settings.litestreamBin,
        run: options.run ?? ((bin, args) => runCommand(bin, args, env)),
      });
      logger.info('Restore', { database: database.name, path: database.path, outcome });
    }

    process.off('SIGTERM', stopEarly);
    process.off('SIGINT', stopEarly);
    const script = writeChildScript(workDir, command);
    const child = spawn(
      settings.litestreamBin,
      ['replicate', '-config', configPath, '-exec', `sh ${script}`],
      { stdio: 'inherit', env }
    );
    const exited = waitForExit(child);

    const forward = (signal: NodeJS.Signals) => child.kill(signal);
    process.on('SIGTERM', forward);
    process.on('SIGINT', forward);

    let lost = false;
    let renewTimer: NodeJS.Timeout | undefined;
    if (lease) {
      const held = lease;
      let lastRenewed = Date.now();
      renewTimer = setInterval(() => {
        held.renew().then(
          (ok) => {
            if (ok) {
              lastRenewed = Date.now();
              return;
            }
            stopForLostLease('Another instance took the replica lease');
          },
          (error: unknown) => {
            logger.error('Could not renew the replica lease', { error: (error as Error).message });
            // Give up before another instance may take over (TTL plus grace).
            if (Date.now() - lastRenewed >= settings.leaseTtlMs) stopForLostLease('The replica lease expired');
          }
        );
      }, settings.leaseRenewMs);
      renewTimer.unref();
    }

    function stopForLostLease(reason: string): void {
      if (lost) return;
      lost = true;
      logger.error(`${reason}; stopping so two instances never write one replica`, {});
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), options.killAfterMs ?? 30_000).unref();
    }

    const code = await exited;
    if (renewTimer) clearInterval(renewTimer);
    process.off('SIGTERM', forward);
    process.off('SIGINT', forward);
    if (lost) {
      lease = null;
      return code === 0 ? 1 : code;
    }
    return code;
  } finally {
    process.off('SIGTERM', stopEarly);
    process.off('SIGINT', stopEarly);
    if (lease) {
      await lease.release();
      logger.info('Released the replica lease', {});
    }
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}
