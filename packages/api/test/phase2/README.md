# Query group orchestration: combinatorial and property harness

Phase 2 of the query-group path to production. Two layers over one shared
harness, answering a question the numbered scenario suites cannot: not "does
this chain work" but "does every combination work, and does the validator agree
with the executor about which combinations exist".

The motivating observation: the suite was green while the orchestration had
real defects, because assertions like `bindings.length > 0` are satisfied by a
correctly-filtered result *and* by a completely unfiltered one. Everything here
asserts exact result multisets.

## Files

| File | What it is |
|---|---|
| `harness/group-harness.ts` | Builds a real query group from a compact spec, through the real API. Validates and executes it. Deliberately does not sanitise the spec - the matrix's job is to build illegal graphs. |
| `harness/query-templates.ts` | The query vocabulary. Small enough that every result set can be written down. |
| `harness/reference-interpreter.ts` | The oracle. Walks the DAG, substitutes VALUES by string templating, executes each node alone. Shares no orchestration code with the engine. |
| `harness/graph-generator.ts` | The bounded fast-check DAG generator. |
| `harness/fuzz-budget.ts` | Case count and seed, from the environment. |
| `legality-matrix.test.ts` | Layer A: all 160 (source type x flow type x target type) cells. |
| `legality-execution.test.ts` | Layer A, execution half: exact results for the shapes flagged as never exercised. |
| `graph-fuzz.test.ts` | Layer B: properties P1, P3-P7. |
| `graph-mutations.test.ts` | One-mutation-at-a-time invalid graphs, including P2's `whenEmpty` and the wrong-order rejection. |
| `variable-mappings.test.ts` | Edge variable mappings pinned with exact results: default pairing, explicit, malformed, partial, and fan-in dedupe. |
| `harness/legality-expectations.ts` | The Layer A oracle as data, extracted so it can be serialized. |
| `legality-artifact.test.ts` | Writes the oracle to `packages/contracts/fixtures/query-group-edge-legality.json`, the table the web suite (`canvasBackendLegality.test.ts`) checks the canvas connection rules against. Regenerate with `vitest -u` after an intentional rule change. |
| `harness/parameter-slots.ts` | Scans a dispatched query for surviving parameter slots, for P7. |
| `flat-round-trip.test.ts` | Create -> expand -> rebuild -> compare, on a structural fingerprint. |

One property built on this harness lives outside the directory:
`test/web/queryGroupCanvasRoundTrip.test.ts` asks `flat-round-trip`'s question of
the canvas rather than of a hand-written client — the same generated graphs, read
back through `packages/web`'s own composables and saved with the payload builder
a "Save new version" uses. It is in `test/web/` because that is where this
package's cross-package imports live, and it reads the same `fuzzBudget`, so
`scripts/ci/fuzz-nightly.sh` names both directories.

## Running

The whole suite is ordinary `vitest`, and runs in the PR pipeline as part of
`packages/api`'s unit tests (~11s):

```bash
pnpm --filter @sparql-query-lib/api exec vitest run test/phase2/
```

The deep run varies the seed and raises the case count by more than an order of
magnitude. It runs nightly (`.github/workflows/nightly-fuzz.yml`) and locally:

```bash
bash scripts/ci/fuzz-nightly.sh                       # random seed, 1000 cases
PHASE2_FUZZ_SEED=123 PHASE2_FUZZ_RUNS=500 bash scripts/ci/fuzz-nightly.sh
```

A failing nightly prints the seed twice - before the run and on failure - so it
reproduces with one command. fast-check shrinks to a minimal counterexample and
prints the complete graph spec.

## Two things that are load-bearing

**The oracle must not import the implementation.** It re-derives the decision
table from the specification rather than calling `SparqlQueryParser`,
`ExecutionEngine` or `GraphBuilder`, and it substitutes VALUES by regex over the
one-line `VALUES (?a ?b) { (UNDEF UNDEF) }` form the templates all use. An
oracle that shared the substitution code would have agreed with every defect
Phase 1 fixed. If you change the templates, keep that spelling.

**The fuzzer reports its own coverage.** `graph-fuzz.test.ts` tallies which
branches each run reached and fails if the corpus stops producing rows, empty
results, `whenEmpty: require` inputs, two-variable tuples, or explicit edge
mappings. A property that never generates a `require` input still passes its
`require` assertion; the tally is what stops that from looking like coverage.
The tally is printed on every run.

This is not hypothetical. The generator was arity-1 only to begin with, and at
arity 1 every variable-pairing rule agrees — so the edge-mapping assertions were
passing while testing nothing. Widening to arity 2 immediately turned up an
order-sensitive fan-in dedupe. If you add a dimension, add it to the tally.

## Known gap

P6 (ephemeral store cleanup) is asserted over the stores a run actually creates,
which today means the ones `RuleSetExecutor` opens. The node-level
`backendConfig` path that `ExecutionEngine` cleans up cannot be reached through
the API at all - `GroupVersionWriter` never writes `backendConfig`, so
`markEphemeralMaterializationNodes` and `materializeRdfResult` are unreachable
except from in-memory unit tests. `GraphBuilder` now rejects the RDF_GRAPH edges
that would silently rely on it (`EDGE_RDF_GRAPH_TARGET_CANNOT_CONSUME`), so the
gap is closed off rather than left to misfire, but wiring `backendConfig`
through the flat API is separate work.
