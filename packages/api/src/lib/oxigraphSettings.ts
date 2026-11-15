/**
 * Settings of the in-process Oxigraph stores, read from the environment.
 *
 * `OxigraphStoreManager` reads them itself. A manager that a backend
 * initialises on first use then gets the same directory and the same
 * checkpoint interval as one that start-up initialises.
 */
import path from 'node:path';

const DEFAULT_STORAGE_DIR = './storage/oxigraph';
const DEFAULT_CHECKPOINT_INTERVAL_MS = 60000;

/** The directory for the `.nq` files of durable Oxigraph backends. */
export function oxigraphStorageDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(env.OXIGRAPH_STORAGE_DIR || DEFAULT_STORAGE_DIR);
}

/**
 * The directory that a manager used before it read `OXIGRAPH_STORAGE_DIR` on
 * first use: the default, resolved against the working directory.
 */
export function defaultOxigraphStorageDir(): string {
  return path.resolve(DEFAULT_STORAGE_DIR);
}

/**
 * The interval between checkpoints of durable stores, in milliseconds.
 *
 * `0` turns the periodic checkpoint off. A value that is not a whole number of
 * milliseconds, 0 or more, is an error: a typing mistake must stop start-up,
 * because a server that runs with no checkpoint loses writes when it is killed.
 */
export function oxigraphCheckpointIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.INTERNAL_OXIGRAPH_CHECKPOINT_INTERVAL_MS;
  if (raw === undefined || raw.trim() === '') return DEFAULT_CHECKPOINT_INTERVAL_MS;
  if (!/^\d+$/.test(raw.trim())) {
    throw new Error(
      `Invalid INTERNAL_OXIGRAPH_CHECKPOINT_INTERVAL_MS "${raw}". Expected a whole number of milliseconds, or 0 to turn the periodic checkpoint off.`
    );
  }
  return parseInt(raw.trim(), 10);
}
