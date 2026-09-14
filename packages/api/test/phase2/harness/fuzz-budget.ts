/**
 * How many cases to generate and with which seed.
 *
 * The PR suite runs these properties as ordinary unit tests, so the default has
 * to stay inside the unit-test budget; the nightly deep run raises both through
 * the environment (scripts/ci/fuzz-nightly.sh).
 *
 * The parsing is defensive on purpose: a GitHub Actions `workflow_dispatch`
 * input that the caller left blank arrives as an empty string rather than as an
 * unset variable, and `Number('')` is 0 - which would silently run zero cases
 * and report a green fuzz run that tested nothing.
 */
export interface FuzzBudget {
  runs: number;
  seed: number;
}

const numeric = (raw: string | undefined, fallback: number): number => {
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const fuzzBudget = (defaultRuns: number): FuzzBudget => ({
  runs: numeric(process.env.PHASE2_FUZZ_RUNS, defaultRuns),
  seed: numeric(process.env.PHASE2_FUZZ_SEED, 20260731),
});
