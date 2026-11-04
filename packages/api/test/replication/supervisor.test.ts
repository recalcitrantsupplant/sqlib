import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Lease } from '../../src/replication/lease.js';
import { runSupervisor, shellQuote, type SupervisorLogger } from '../../src/replication/supervisor.js';

/**
 * A stand-in for the Litestream binary. `restore` copies $FAKE_REPLICA to the
 * `-o` path when it exists; `replicate -exec CMD` records its config and runs
 * CMD, as Litestream does.
 */
const FAKE_LITESTREAM = `#!/bin/sh
echo "$*" >> "$FAKE_LOG"
case "$1" in
  restore)
    out=""; prev=""
    for a in "$@"; do [ "$prev" = "-o" ] && out="$a"; prev="$a"; done
    [ -n "$FAKE_RESTORE_FAIL" ] && { echo "Error: access denied" >&2; exit 1; }
    [ -f "$FAKE_REPLICA" ] && cp "$FAKE_REPLICA" "$out"
    exit 0 ;;
  replicate)
    cp "$3" "$FAKE_DIR/seen-config.yml"
    exec $5 ;;
esac
exit 2
`;

const quiet: SupervisorLogger = { info: () => {}, error: () => {} };

function fakeLease(events: string[], renew: () => Promise<boolean> = async () => true): Lease {
  return {
    description: 'memory://lease',
    holder: 'test',
    acquire: async () => { events.push('acquire'); },
    renew: async () => { events.push('renew'); return renew(); },
    release: async () => { events.push('release'); },
  };
}

describe('runSupervisor', () => {
  let dir: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlib-supervisor-'));
    const bin = path.join(dir, 'litestream');
    fs.writeFileSync(bin, FAKE_LITESTREAM, { mode: 0o755 });
    env = {
      PATH: process.env.PATH,
      SQLIB_SQLITE_REPLICA_URL: 's3://bucket/prod',
      SQLIB_LITESTREAM_BIN: bin,
      LIBRARY_STORAGE_DIR: path.join(dir, 'lib'),
      FAKE_LOG: path.join(dir, 'calls.log'),
      FAKE_DIR: dir,
      FAKE_REPLICA: path.join(dir, 'replica.sqlite'),
    };
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('quotes any argument for sh', () => {
    expect(shellQuote(`it's "x" $HOME`)).toBe(`'it'\\''s "x" $HOME'`);
  });

  it('takes the lease, restores, runs the server under replicate, and releases the lease', async () => {
    fs.writeFileSync(env.FAKE_REPLICA!, 'replica-bytes');
    const events: string[] = [];
    const out = path.join(dir, 'server-ran');
    const code = await runSupervisor(['sh', '-c', `printf '%s' "$1" > ${out}; exit 7`, 'arg0', `it's "quoted"`], {
      env,
      logger: quiet,
      createLease: async () => fakeLease(events),
    });

    expect(code).toBe(7);
    expect(fs.readFileSync(out, 'utf8')).toBe(`it's "quoted"`);
    expect(fs.readFileSync(path.join(dir, 'lib', 'library.sqlite'), 'utf8')).toBe('replica-bytes');
    expect(events).toEqual(['acquire', 'release']);
    const calls = fs.readFileSync(env.FAKE_LOG!, 'utf8').trim().split('\n');
    expect(calls[0]).toMatch(/^restore -config \S+litestream\.yml -if-replica-exists -o \S+library\.sqlite\.restoring \S+library\.sqlite$/);
    expect(calls[1]).toMatch(/^replicate -config \S+litestream\.yml -exec sh \S+server\.sh$/);
    expect(fs.readFileSync(path.join(dir, 'seen-config.yml'), 'utf8')).toContain('url: "s3://bucket/prod/library"');
  });

  it('does not start the server when a restore fails, and still releases the lease', async () => {
    const events: string[] = [];
    const out = path.join(dir, 'server-ran');
    await expect(
      runSupervisor(['sh', '-c', `touch ${out}`], {
        env: { ...env, FAKE_RESTORE_FAIL: '1' },
        logger: quiet,
        createLease: async () => fakeLease(events),
      })
    ).rejects.toThrow(/access denied/);
    expect(fs.existsSync(out)).toBe(false);
    expect(events).toEqual(['acquire', 'release']);
  });

  it('stops the server when another instance takes the lease', async () => {
    const events: string[] = [];
    const errors: string[] = [];
    const code = await runSupervisor(['sh', '-c', 'trap "exit 0" TERM; while :; do sleep 0.05; done'], {
      env: { ...env, SQLIB_SQLITE_REPLICA_LEASE_TTL: '200ms', SQLIB_SQLITE_REPLICA_LEASE_RENEW: '50ms' },
      logger: { info: () => {}, error: (msg) => errors.push(msg) },
      createLease: async () => fakeLease(events, async () => false),
      killAfterMs: 2_000,
    });
    expect(code).toBe(1);
    expect(errors.join()).toMatch(/Another instance took the replica lease/);
    // The lease is someone else's now: releasing it would free it for a third.
    expect(events).not.toContain('release');
  });

  it('skips the lease when it is off', async () => {
    const events: string[] = [];
    const code = await runSupervisor(['true'], {
      env: { ...env, SQLIB_SQLITE_REPLICA_LEASE: 'off' },
      logger: quiet,
      createLease: async () => fakeLease(events),
    });
    expect(code).toBe(0);
    expect(events).toEqual([]);
  });

  it('runs the command directly when replication is off', async () => {
    const code = await runSupervisor(['sh', '-c', 'exit 3'], { env: { PATH: process.env.PATH }, logger: quiet });
    expect(code).toBe(3);
    expect(fs.existsSync(env.FAKE_LOG!)).toBe(false);
  });
});
