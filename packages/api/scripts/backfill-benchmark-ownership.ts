#!/usr/bin/env ts-node
/**
 * Give every benchmark experiment stored before experiments had an owner one.
 *
 * `BenchmarkExperiment.isPartOf` names the library the entity guard checks, and
 * every create sets it. An experiment stored before it existed has none, which
 * `benchmarks.ts` answers by making it administrator-only — safe, and useless to
 * everyone else. This assigns each such experiment a library:
 *
 * - the one library every subject of every version resolves to, when there is
 *   exactly one, since that is where the things it measures live;
 * - otherwise `--library <iri>`, when given;
 * - otherwise nothing, and the experiment is reported for a decision.
 *
 * Only `isPartOf` is written. Safe to run repeatedly: an experiment that has an
 * owner is left alone.
 *
 * Usage:  pnpm tsx scripts/backfill-benchmark-ownership.ts [--dry-run] [--library <iri>]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveOwningLibrary } from '../src/auth/enforce.js';
import { getCacheCoordinator } from '../src/lib/CacheCoordinatorProvider.js';
import { parseSubjectSpecs } from '../src/lib/BenchmarkExperimentService.js';
import type { CacheCoordinator } from '../src/lib/CacheCoordinator.js';
import type { LdkitBenchmarkExperiment } from '../src/persistence/schemas/BenchmarkExperimentSchema.js';
import type { LdkitBenchmarkExperimentVersion } from '../src/persistence/schemas/BenchmarkExperimentVersionSchema.js';

export interface OwnershipDecision {
  experiment: string;
  /** The library assigned, or null when none could be decided. */
  library: string | null;
  reason: string;
}

type Coordinator = Pick<CacheCoordinator, 'get' | 'list' | 'update'>;

/** Decide, and unless `dryRun`, write, an owner for every unowned experiment. */
export async function backfillBenchmarkOwnership(
  coordinator: Coordinator,
  options: { dryRun?: boolean; fallbackLibrary?: string | null } = {},
): Promise<OwnershipDecision[]> {
  const fallback = options.fallbackLibrary ?? null;
  if (fallback && coordinator.get(fallback)?.['@type'] !== 'Library') {
    throw new Error(`--library ${fallback} is not a library`);
  }

  const experiments = coordinator.list('BenchmarkExperiment') as LdkitBenchmarkExperiment[];
  const versions = coordinator.list('BenchmarkExperimentVersion') as LdkitBenchmarkExperimentVersion[];
  const decisions: OwnershipDecision[] = [];

  for (const experiment of experiments) {
    if (experiment.isPartOf) continue;

    const libraries = new Set<string | null>();
    for (const version of versions.filter(v => v.isPartOf === experiment.$id)) {
      for (const spec of parseSubjectSpecs(version.subjectSpecs)) {
        libraries.add(resolveOwningLibrary(coordinator.get(spec.subject)));
      }
    }

    let decision: OwnershipDecision;
    if (libraries.size === 1 && !libraries.has(null)) {
      decision = { experiment: experiment.$id, library: [...libraries][0], reason: 'every subject lives there' };
    } else if (fallback) {
      const why = libraries.size === 0 ? 'no subjects' : 'subjects span libraries or resolve to none';
      decision = { experiment: experiment.$id, library: fallback, reason: `${why}; --library` };
    } else {
      const why = libraries.size === 0 ? 'no subjects' : 'subjects span libraries or resolve to none';
      decision = { experiment: experiment.$id, library: null, reason: `${why}; pass --library to assign one` };
    }

    if (decision.library && !options.dryRun) {
      await coordinator.update('BenchmarkExperiment', experiment.$id, { isPartOf: decision.library });
    }
    decisions.push(decision);
  }

  return decisions;
}

function argValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const coordinator = getCacheCoordinator();
  await coordinator.loadAll();

  const decisions = await backfillBenchmarkOwnership(coordinator, {
    dryRun,
    fallbackLibrary: argValue('--library'),
  });

  for (const { experiment, library, reason } of decisions) {
    console.log(`${library ? (dryRun ? 'would assign' : 'assigned') : 'left unowned'}  ${experiment}  ${library ?? ''}  (${reason})`);
  }
  const undecided = decisions.filter(decision => !decision.library).length;
  console.log(`${decisions.length} unowned experiment(s); ${undecided} left for a decision.`);
}

const modulePath = fileURLToPath(import.meta.url);
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';

if (modulePath === invokedPath) {
  main()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Failed to backfill benchmark ownership:', error);
      process.exit(1);
    });
}
