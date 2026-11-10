import { expect } from 'vitest';

/**
 * A Dockerfile read as instructions, for the tests in this directory that pin
 * what the image is built with. `docker run` is not available on the CI runner
 * (see `scripts/ci/docker-build-push.sh`), so they read the build instructions.
 */

export type Instruction = { keyword: string; text: string };

/**
 * The Dockerfile as instructions: comments dropped, continuations joined.
 *
 * Order is the property under test, so this keeps the instructions in file
 * order and compares positions rather than searching for text.
 */
export function parseDockerfile(source: string): Instruction[] {
  const joined: string[] = [];
  let pending = '';

  for (const raw of source.split('\n')) {
    const line = raw.trimEnd();
    if (pending === '' && /^\s*(#|$)/.test(line)) continue;
    const continues = line.endsWith('\\');
    pending += (pending ? ' ' : '') + (continues ? line.slice(0, -1).trim() : line.trim());
    if (!continues) {
      joined.push(pending);
      pending = '';
    }
  }
  if (pending) joined.push(pending);

  return joined.map((text) => ({ keyword: text.split(/\s+/)[0].toUpperCase(), text }));
}

/** The last build stage: the one that ships. */
export function productionStage(instructions: Instruction[]): Instruction[] {
  const starts = instructions
    .map((instruction, index) => ({ instruction, index }))
    .filter(({ instruction }) => instruction.keyword === 'FROM');
  const last = starts[starts.length - 1];
  expect(last, 'the Dockerfile has no FROM at all').toBeTruthy();
  return instructions.slice(last.index);
}
