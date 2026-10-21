#!/usr/bin/env node
/** The `sqlib` binary: `main` bound to this process's arguments and streams. */
import { main } from './main.js';

const exitCode = await main(process.argv.slice(2), {
  stdout: text => { process.stdout.write(text); },
  stderr: text => { process.stderr.write(text); },
  readStdin: async () => {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString('utf8');
  },
  cwd: process.cwd(),
});
process.exitCode = exitCode;
