import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { main } from '../src/main.js';

/** A temporary directory holding the given files. */
export async function workspace(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'sqlib-cli-'));
  for (const [name, content] of Object.entries(files)) await writeFile(path.join(dir, name), content);
  return dir;
}

/** Run one command line in `cwd`, capturing its output and exit status. */
export async function sqlib(cwd: string, argv: string[], stdin = '') {
  let stdout = '';
  let stderr = '';
  const status = await main(argv, {
    stdout: text => { stdout += text; },
    stderr: text => { stderr += text; },
    readStdin: async () => stdin,
    cwd,
  });
  return { status, stdout, stderr };
}

export const PEOPLE = `@prefix ex: <http://ex/> .
ex:ann ex:livesIn ex:Perth ; ex:parent ex:bo .
ex:bo ex:livesIn ex:Hobart ; ex:parent ex:cy .
ex:cy ex:livesIn ex:Perth .
`;
