/**
 * The run report: `--report <path>` on `etl run` and `rules run`.
 *
 * A run the server never saw leaves no `EtlExecution` behind, so the CLI writes
 * its own record: what ran (with hashes, so a report names the exact text),
 * where its rows and RDF went, how long each stage took, and how it ended. A
 * failed run still writes one, with the error, before the command exits.
 */
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CliError, type Io, type Output } from './io.js';

/** `sha256-<hex>`, the spelling a bundle uses for its hashes. */
export function sha256(text: string): string {
  return `sha256-${createHash('sha256').update(text).digest('hex')}`;
}

/** An output that counts and hashes what passes through it. */
export function measuredOutput(out: Output): Output & { summary(): { bytes: number; sha256: string } } {
  const hash = createHash('sha256');
  let bytes = 0;
  return {
    write: async text => {
      hash.update(text);
      bytes += Buffer.byteLength(text);
      await out.write(text);
    },
    close: () => out.close(),
    summary: () => ({ bytes, sha256: `sha256-${hash.copy().digest('hex')}` }),
  };
}

/** A report being filled in as a run goes. */
export class RunReport {
  private readonly startedAt = new Date();
  private readonly fields: Record<string, unknown> = {};
  private readonly stages: Record<string, number> = {};

  constructor(private readonly command: string) {}

  set(fields: Record<string, unknown>): void {
    Object.assign(this.fields, fields);
  }

  /** Add time to a stage; a stage entered once per chunk adds up across chunks. */
  addTime(stage: string, ms: number): void {
    this.stages[stage] = (this.stages[stage] ?? 0) + ms;
  }

  /** Time one call and add it to a stage. */
  async time<T>(stage: string, call: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      return await call();
    } finally {
      this.addTime(stage, performance.now() - start);
    }
  }

  finish(status: string, error?: unknown): Record<string, unknown> {
    const finishedAt = new Date();
    const round = (ms: number) => Math.round(ms * 10) / 10;
    return {
      command: this.command,
      status,
      startedAt: this.startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - this.startedAt.getTime(),
      stagesMs: Object.fromEntries(Object.entries(this.stages).map(([stage, ms]) => [stage, round(ms)])),
      ...this.fields,
      ...(error !== undefined ? { error: error instanceof Error ? error.message : String(error) } : {}),
    };
  }
}

/**
 * Refuse a report that would land in the data. With `-` the report goes to
 * standard output, so the run's own output has to go to a file.
 */
export function checkReportTarget(report: string | undefined, out: string | undefined): void {
  if (report === '-' && (!out || out === '-')) {
    throw new CliError('--report - writes to standard output, so pass --out <file> for the data.');
  }
}

export async function writeReport(io: Io, file: string, report: Record<string, unknown>): Promise<void> {
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (file === '-') io.stdout(json);
  else await writeFile(path.resolve(io.cwd, file), json, 'utf8');
}

/**
 * Run a command body under a report, when one was asked for. The report is
 * written whether the body returns or throws; a throw still ends the command.
 */
export async function withReport(
  io: Io,
  file: string | undefined,
  report: RunReport,
  body: () => Promise<{ exitCode: number; status: string }>,
): Promise<number> {
  try {
    const { exitCode, status } = await body();
    if (file) await writeReport(io, file, report.finish(status));
    return exitCode;
  } catch (error) {
    if (file) await writeReport(io, file, report.finish('failed', error));
    throw error;
  }
}
