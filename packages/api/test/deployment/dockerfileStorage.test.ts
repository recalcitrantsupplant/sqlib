import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { etlOutputDir } from '../../src/lib/EtlService.js';

/**
 * The image's half of issue #466, which nothing checked.
 *
 * A fresh container could not write ETL output because Docker seeds a fresh
 * volume from the image's content *including its ownership*, and
 * `/app/packages/api/storage` was root-owned `0755` under a process running as
 * uid 1000. The Dockerfile now creates that directory owned by `node` before
 * declaring the `VOLUME`.
 *
 * That fix is three instructions in a particular order, and every way of
 * breaking it is silent: moving `VOLUME` above the `mkdir` restores the
 * root-owned seed, and renaming the default output directory in `EtlService`
 * leaves the image preparing a path nothing writes to. Neither shows up in a
 * build, a boot, or any test — only in somebody's first job execution, weeks
 * later, which is exactly how #466 was found.
 *
 * `docker run` is not available on the CI runner (see the note in
 * `scripts/ci/docker-build-push.sh`), and pulling the published image is not
 * available from a cloud container either, so this reads the build instructions
 * rather than the built image. It cannot prove the ownership a fresh volume
 * ends up with; it does pin the order and the path that produce it. Running the
 * real thing is `scripts/storage-writability-smoke.ts` inside the container —
 * "Where a job execution's output goes" in docs/guides/etl.md.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, '../..');
const repoRoot = path.resolve(pkgRoot, '../..');

/** Where the image puts the API, and so what its working directory is. */
const API_DIR_IN_IMAGE = '/app/packages/api';
const STORAGE_IN_IMAGE = `${API_DIR_IN_IMAGE}/storage`;

type Instruction = { keyword: string; text: string };

/**
 * The Dockerfile as instructions: comments dropped, continuations joined.
 *
 * Order is the property under test, so this keeps the instructions in file
 * order and compares positions rather than searching for text.
 */
function parseDockerfile(source: string): Instruction[] {
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
function productionStage(instructions: Instruction[]): Instruction[] {
  const starts = instructions
    .map((instruction, index) => ({ instruction, index }))
    .filter(({ instruction }) => instruction.keyword === 'FROM');
  const last = starts[starts.length - 1];
  expect(last, 'the Dockerfile has no FROM at all').toBeTruthy();
  return instructions.slice(last.index);
}

const dockerfile = fs.readFileSync(path.join(repoRoot, 'Dockerfile'), 'utf8');
const stage = productionStage(parseDockerfile(dockerfile));
const indexOf = (predicate: (instruction: Instruction) => boolean): number =>
  stage.findIndex(predicate);

describe('Dockerfile: the storage volume a fresh container writes ETL output to', () => {
  it('creates the storage directory before declaring it a volume', () => {
    const mkdir = indexOf((i) => i.keyword === 'RUN' && i.text.includes(`mkdir -p ${STORAGE_IN_IMAGE}`));
    const volume = indexOf((i) => i.keyword === 'VOLUME' && i.text.includes(STORAGE_IN_IMAGE));

    expect(mkdir, `no RUN creates ${STORAGE_IN_IMAGE}`).toBeGreaterThan(-1);
    expect(volume, `no VOLUME declares ${STORAGE_IN_IMAGE}`).toBeGreaterThan(-1);
    // A fresh volume is seeded from the image at this path. Declared first, it
    // is seeded from a directory Docker itself created, root-owned.
    expect(mkdir).toBeLessThan(volume);
  });

  it('gives it to the user the container runs as, before declaring the volume', () => {
    const chown = indexOf((i) => i.keyword === 'RUN' && /chown\s+-R\s+node:node/.test(i.text)
      && i.text.includes(STORAGE_IN_IMAGE));
    const volume = indexOf((i) => i.keyword === 'VOLUME' && i.text.includes(STORAGE_IN_IMAGE));
    const user = indexOf((i) => i.keyword === 'USER' && /\bnode\b/.test(i.text));

    expect(chown, `nothing chowns ${STORAGE_IN_IMAGE} to node`).toBeGreaterThan(-1);
    expect(chown).toBeLessThan(volume);
    // The ownership is only the right one because this is the user that runs.
    expect(user, 'the image does not run as node').toBeGreaterThan(-1);
    expect(chown).toBeLessThan(user);
  });

  it('prepares the directory ETL output actually defaults to', () => {
    // The link the Dockerfile cannot state and a rename would break: the image
    // prepares a literal path, `EtlService` resolves one relative to the
    // process's working directory, and they have to be the same directory.
    expect(process.cwd(), 'this test reads the default relative to the package root')
      .toBe(pkgRoot);
    const relative = path.relative(process.cwd(), etlOutputDir());
    expect(relative.startsWith('..'), `${relative} is outside the package`).toBe(false);

    const expected = path.posix.join(API_DIR_IN_IMAGE, relative.split(path.sep).join('/'));
    const prepared = indexOf((i) => i.keyword === 'RUN' && i.text.includes(`mkdir -p ${expected}`));

    expect(prepared, `the image does not create ${expected}`).toBeGreaterThan(-1);
  });

  it('runs the API from the directory that default is relative to', () => {
    // `ETL_OUTPUT_DIR` defaults to `./storage/etl-output`, so the working
    // directory the API is started in decides which storage it means.
    const cmd = stage.find((i) => i.keyword === 'CMD');

    expect(cmd, 'the image has no CMD').toBeTruthy();
    expect(cmd!.text).toContain(`cd ${API_DIR_IN_IMAGE}`);
  });
});
