# Arguments are SPARQL Results JSON

Status: proposed, pre-1.0 clean break. No compatibility shim: nothing outside
this repository sends the old shape.

## The change in one paragraph

An execution request keeps its outer `arguments` array, one entry per table
parameter, and its scalar `limits` / `offsets` lists. Each entry of `arguments`
becomes a plain **SPARQL Query Results JSON** document — `{"head": {"vars":
[…]}, "results": {"bindings": […]}}` — with no blank nodes. The inner
`arguments` key, and the coined name "arguments JSON" / "args-JSON", go away.
`whenEmpty` leaves the wire entirely: a caller's intent is already expressed by
whether a slot is supplied and whether its document has rows. Stored argument
sets and tuple sets already hold this exact shape, so storage does not move.

```jsonc
// POST /execute
{
  "targetId": "<query or version IRI>",
  "backendId": "<backend IRI>",
  "arguments": [
    { "head": { "vars": ["city"] },
      "results": { "bindings": [
        { "city": { "type": "uri", "value": "http://example.org/Perth" } },
        { "city": { "type": "literal", "value": "Hobart", "xml:lang": "en" } }
      ] } }
  ],
  "limits":  [{ "name": "1", "value": 20 }],
  "offsets": [{ "name": "2", "value": 0 }]
}
```

## Why

- Any Results JSON producer becomes a valid argument with no editing: a query's
  own output, a saved tuple set, a stored argument set, curl output from any
  endpoint. Today every one of those needs `results` renamed first.
- Storage is already Results JSON. The wire is the only place the renamed key
  exists, and the code admits it: the tuple seed reader accepts both spellings
  "because a caller may reasonably be holding either", the export path renames
  one way and the web client renames back.
- One shape means one type. `SparqlResults` in `packages/types` already
  describes it.

## Wire contract

`arguments[i]` is accepted when it satisfies all of:

| Rule | Detail |
| --- | --- |
| Shape | `head.vars: string[]`, `results.bindings: object[]`. Strict: no other members. `head.link` and `boolean` are refused because they carry nothing for a call. |
| Terms | `type` is `uri` or `literal`. `datatype` is an IRI; `xml:lang` a string. |
| Blank nodes | `bnode` is refused with a message saying why: a blank node label is document-scoped and can join with nothing in the target store. Same rule tuple set import already applies. |
| Legacy spelling | `typed-literal` (the 2008 draft spelling some endpoints still emit) is normalised to `literal` + `datatype` at the boundary. |
| UNDEF | An absent key in a row is UNDEF, as in Results JSON. `null` cells and `null` rows are still tolerated and normalised to absence, because a grid round-trip produces them. Every Results JSON document is valid input; not every valid input is Results JSON. |
| Alignment | Documents are matched to slots by `head.vars` signature, not position (`alignArgumentSets` already does this). |
| Arity | **At most** one document per slot. A slot with no matching document runs `unconstrained`. A document that matches no slot is a 400 naming its variables. This replaces today's "exactly one entry per slot". |

`limits` and `offsets` are unchanged. `argumentSetIds` is unchanged. The GET
querystring form still carries the same JSON as a string.

## `whenEmpty`: where the policy lives

Today it lives in three places: on a `QueryEdge` (the author's declaration,
stored), on the wire argument (per call, optional, sent by nobody but tests),
and on the runtime `TemplateArgumentSet` (the internal carrier the parser
reads). The question was whether it belongs on the execution, on the query, or
on the group.

The answer falls out of the three modes:

| Mode | Whose decision | Where it is expressed after this change |
| --- | --- | --- |
| `unconstrained` — nothing arrived, run open | the caller | omit the slot |
| `propagateEmpty` — the empty set arrived, match nothing | the caller | supply the slot with zero rows |
| `require` — this input is mandatory | the author | `QueryEdge.whenEmpty`, as today |

So the two caller-side modes are already spelled by the argument itself, and
`require` is not a caller's choice at all: nobody requires themselves to send
rows. It stays where the author declares it, on the edge that feeds a slot in
a group. Precedence is unchanged: an edge policy wins over the parser default;
the parser default is `propagateEmpty` for zero rows and `unconstrained` for
the pure singleton wildcard row.

**No request-level `whenEmpty` for 1.0.** The engine's "a `whenEmpty` on the
request is more specific than the stored default" branch goes with the field.

**No query-level default for 1.0.** `require` on a query version would be the
one mode that is genuinely the query's own property. It is deferred for two
reasons: the project's rule is that parameters are declared in the query text
and there is no SPARQL syntax to say "mandatory"; and the existing design note
(input tuples belong to the version and are shared by every group) already
argued the per-edge home. If it is wanted later it is additive: a per-slot
annotation on the version, read by the same precedence chain, edge over version
over default. Nothing in this change forecloses it.

The runtime's internal `TemplateArgumentSet` keeps `whenEmpty` as a private
field the route and engine attach after validation. It is documented as never
appearing on the wire.

## Plan

Work in dependency order; each phase leaves the tree green.

### 1. Contract and types

- `packages/contracts/src/generated/execution.ts` (and `sparql.ts`, which
  reuses it): `executionArgumentSchema` becomes strict `{ head: { vars },
  results: { bindings } }`. Drop `whenEmpty`. Term enum `uri | literal` with a
  custom message for `bnode`. Preprocess `typed-literal` to `literal`. Note
  the file header claims generation but `scripts/generate-schemas.ts` writes
  this module from an inline template (`generateExecutionContractModule`), so
  the edit goes in the generator, then regenerate.
- `packages/types`: export `ExecutionArgument` as the `SparqlResults` SELECT
  subset (`head.vars`, `results.bindings`), so the wire type is the results
  type.
- `packages/api/src/lib/tupleSeedInput.ts`: drop the dual-spelling read and the
  "arguments JSON" wording.

### 2. Runtime

`packages/runtime/src/{arguments,query-template,bundle,library,group}.ts`:

- `WireArgumentSet` is the Results JSON document. Normalisation
  (`normalizeUndefBindings`) drops nulls and folds `typed-literal`; its output
  is `TemplateArgumentSet`, which is the document plus internal `whenEmpty`.
- `alignArgumentSets` returns a partial assignment: `(T | undefined)[]` in slot
  order, plus the list of unclaimed documents so the caller can 400 on them.
  Unclaimed slots are filled with an empty document marked `unconstrained`.
- `applyTemplateArguments` reads `results.bindings`.
- Bundle examples: relax the arity check at `bundle.ts` line 330 to "at most";
  rename the key. The bundle format stays `version: 1`, since no v1 bundle
  exists outside this repository; the golden fixture is regenerated.

### 3. API

- `parser.ts` (`applyArguments`, `ApplyArgumentSet`, the property probe
  `set(...)` helper): rename, same alignment change, same error wording as the
  runtime. The differential suite `parser.template-equivalence.test.ts` must
  still pass; it is the proof the two stay identical.
- `executionArguments.ts`, `query-chaining.ts` types, `routes/execute.ts`,
  `routes/playground.ts`: rename; the inline path fills unmatched slots exactly
  as the `argumentSetIds` path already does at `execute.ts` line 605 onward,
  so the two paths share that code rather than repeating it.
- `orchestration/ExecutionEngine.ts`: rename the synthesised sets; delete the
  request-`whenEmpty` precedence branch; everything else unchanged.
- `ArgumentSetService.ts` `exportRuntimePayload`: stop rewrapping stored rows;
  the stored document is the wire document.
- `EtlService.ts`, `system-queries/SystemQueryRunner.ts`, `export/demoPage.ts`,
  `scripts/bench-apply-args.ts`, `scripts/bench-node-hop.ts`: rename.
- `persistence/schemas/TupleSetVersionSchema.ts` header: delete the paragraph
  contrasting SRJ with "arguments-JSON"; there is no second format.

### 4. Clients

- Web: `lib/notebookValues.ts` (`toSlotArgument`), `composables/useNotebook.ts`,
  `composables/useArgumentSets.ts`, `types/argument-sets.ts`,
  `types/tuple-sets.ts` header, e2e fixtures `tests/e2e/fixtures/callables.ts`
  and the two specs that build payloads.
- MCP app: `packages/mcp-app/src/views/bench.html` builds and counts slots by
  the inner key.
- MCP server guide text: `packages/tools/src/guide.ts` line 45 describes the
  shape to the model. Rewrite as "each entry is a SPARQL Results JSON document
  with no blank nodes; omit a slot to run it unconstrained; supply it with zero
  rows to match nothing".

### 5. Tests

36 test files reference the inner key. The substantive ones, beyond the
rename:

- `parser.applyArguments.test.ts`, `parser.values-property.test.ts`: add cases
  for omitted slot, zero-row slot, unmatched document (400), `bnode` refusal
  message, `typed-literal` folding.
- `ExecutionEngine.test.ts`, `ExecutionEngine.startNodeTuples.test.ts`,
  scenario `12-when-empty-policy.test.ts`: assert edge policy still wins and
  that a request can no longer carry one.
- Phase 2 harness (`graph-generator`, `reference-interpreter`,
  `group-harness`, `query-templates`) and `graph-fuzz.test.ts`: the reference
  interpreter is the oracle, so it changes first and the engine is checked
  against it.
- `export/fixtures/goldenBundleV1.ts`: regenerate.
- `tupleSeedInput.test.ts`: drop the dual-spelling case.

### 6. Documentation

- `docs/concepts.md` Parameters and ArgumentSet sections: "each argument is a
  SPARQL Results JSON document"; move the `whenEmpty` paragraph to say it is an
  edge property and describe the omit / zero-row spelling for callers.
- `docs/guides/rest-api-walkthrough.md`, `docs/guides/query-groups.md`
  (`whenEmpty` section and the example at line 279), `docs/guides/mcp-app.md`,
  `docs/guides/static-export.md`, `docs/design/mcp-app.md`,
  `docs/proposals/notebook-cells.md`: examples and prose.
- `CHANGELOG.md`: one breaking-change entry under the 1.0 heading.

## Verification

```
pnpm generate-schemas
pnpm -r build
pnpm --filter @sparql-query-lib/runtime test
pnpm --filter @sparql-query-lib/api test        # includes the differential and phase 2 suites
pnpm --filter @sparql-query-lib/web test
pnpm --filter @sparql-query-lib/api test:e2e
pnpm --filter @sparql-query-lib/web test:e2e:ci
grep -rn '"arguments": {\|arguments\.bindings\|arguments: { bindings' packages docs --include='*.ts' --include='*.tsx' --include='*.html' --include='*.md' | grep -v node_modules | grep -v /dist/
```

The final grep must return nothing. A second grep for `whenEmpty` outside
`QueryEdge`, the runtime's internal type, the engine and the parser must also
return nothing.

## Out of scope

- A query-level `require` default (see above; additive later).
- Any change to `limits` / `offsets`, `argumentSetIds` or `dataGraphs`.
- The notebook's own `whenEmpty` vocabulary (`skip` / `stop` in
  `notebookFormat.ts`), which is a cell-level concern, not a slot policy.
