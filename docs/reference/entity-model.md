# Entity model reference

The entity kinds the server stores, how they are identified, which of them are
versioned, and what belongs to what. [Concepts](../concepts.md) explains what
these things are *for*; this page is the lookup table.

The authoritative list of type names is
`packages/api/src/persistence/entityTypeNames.ts`. Each name has a schema in
`packages/api/src/persistence/schemas/` and a repository registered in
`packages/api/src/lib/EntityRegistry.ts`; both are checked against the name list
at compile time, so a type added to one and not the other does not build.

Whether a kind's routes are registered at all depends on the deployment's
[feature flags](feature-flags.md).

## Entity kinds

### Library content

Each of these belongs to exactly one library and is versioned: a stable pointer
carrying the name and metadata, and immutable numbered versions carrying the
content.

| Stable pointer | Version | What it holds |
| --- | --- | --- |
| `Query` | `QueryVersion` | One SPARQL query: its text, its type, and the parameters, inputs and outputs inferred from it |
| `QueryGroup` | `QueryGroupVersion` | A DAG of nodes and edges — the canvas |
| `Rule` | `RuleVersion` | One SRL rule |
| `DataBlock` | `DataBlockVersion` | One SRL `DATA { … }` block of ground triples |
| `RuleSet` | `RuleSetVersion` | A set of rules and data blocks, with its stratification report. Its content is an SRL document — see [the SRL reference](srl-language.md) |
| `DataGraph` | `DataGraphVersion` | Reference RDF the library holds, as a serialised document |
| `TupleSet` | `TupleSetVersion` | A table of RDF terms, as a SPARQL Results JSON document |
| `ArgumentSet` | `ArgumentSetVersion` | One call's worth of input for a callable |
| `Test` | `TestVersion` | A callable, its inputs and what it should produce |
| `BenchmarkExperiment` | `BenchmarkExperimentVersion` | A measurement plan: subjects, backends, repeats, timing policy |
| `EtlJob` | `EtlJobVersion` | DuckDB SQL and a SPARQL template that builds RDF from its rows |
| `EtlColumnMapping` | `EtlColumnMappingVersion` | How an ETL job's columns map into that template |

### Not versioned

| Kind | What it is |
| --- | --- |
| `Library` | The container. Carries a name, an optional `defaultBackend` and a list of `allowedBackends` |
| `Backend` | A SPARQL endpoint or an in-process Oxigraph store. Account-level: it is not contained by a library, and libraries point at it |
| `Tag` | A label within a library. Deliberately outside the version machinery — a tag is a classification, not content |
| `Patch` | The ground quad diff of one write against a backend. An event, written once; only its status changes afterwards |
| `EtlExecution` | One run of an ETL job version, with its status, counts and output location |
| `TestRun`, `TestRunCase` | One execution of a test and its per-case verdicts. Not library content: a run is not authored, and it cites the test it judged by plain reference rather than by containment |

### Structural parts

These exist only inside a version and have no life of their own. They are listed
because they appear as IRIs in API responses.

| Kind | Belongs to |
| --- | --- |
| `LimitParameter`, `OffsetParameter` | A `QueryVersion` — one per `LIMIT 000n` / `OFFSET 000n` |
| `QueryInputTuple`, `QueryOutputTuple`, `TupleMember` | A `QueryVersion` — the tuple signatures inferred from its `VALUES` clauses and projection |
| `QueryInputVariable`, `QueryOutputVariable` | A query group node's ports |
| `TriplesQuadsIO`, `BooleanIO`, `QueryIdInput` | Non-tabular ports: RDF output, an ASK's boolean, a dynamic node's query identifier |
| `QueryNode`, `RuleSetNode`, `PatchNode`, `DuckDbEtlNode`, `DynamicQueryNode`, `StartNode`, `EndNode`, `QueryEdge` | A `QueryGroupVersion` |
| `ArgumentTupleBinding`, `ArgumentScalarBinding`, `ArgumentGraphBinding` | An `ArgumentSetVersion` — a table per `VALUES` clause, a number per named limit, a graph per start-node RDF port |
| `TestCase`, `TestCaseDataGraph` | A `TestVersion` |
| `BenchmarkRun`, `BenchmarkNodeRun`, `BenchmarkIterationRun` and their `*Observation` counterparts | A benchmark execution |

## Identity

An entity's IRI never changes. Minting happens on the server, in
`packages/api/src/lib/id.ts`, as a per-kind prefix plus a UUID with its hyphens
removed:

```
urn:sqlib:query:5f2c1b9a4e7d4c8fb3a1e6d09c7b2a54
urn:sqlib:query-version:0a7e3c5d19b24f6c8d2a7e13b4c95f60
```

Each kind has its own prefix. Most are the type name in lower case with hyphens
between words — `urn:sqlib:query:`, `urn:sqlib:query-version:`,
`urn:sqlib:data-graph:`, `urn:sqlib:tuple-set:`, `urn:sqlib:argument-set:`,
`urn:sqlib:test:`, `urn:sqlib:etl-job:`, `urn:sqlib:backend:`,
`urn:sqlib:library:`, `urn:sqlib:tag:`, `urn:sqlib:patch:` — and a few are
shorter than their type name: a `RuleSet` is `urn:sqlib:ruleset:`, a
`QueryGroup` is `urn:sqlib:group:`. The complete map is the `NS` constant in
that module; do not infer a prefix from a type name.

A client may supply its own `id` when creating an entity. The field is optional
everywhere it appears, and where a create schema accepts it the value must match
`^urn:` and must not already exist. The usual case is to omit it and let the
server mint one.

### Three spellings of the same identity

| Spelling | Where |
| --- | --- |
| `$id` | Internally, in TypeScript |
| `@id` | In RDF and JSON-LD, when the entity is persisted or exported |
| `id` | In REST request and response bodies |

The adapters in `packages/api/src/persistence/utils/id-adapter.ts` convert at
the boundary — `toLdkit` on the way in, `toRestApi` on the way out — so no route
handler does it by hand. In a schema definition, `'@id'` on a *property* means
something else entirely: it names the RDF predicate that property maps to. Only
`'@id'` on an entity is identity.

## Versioning

A versioned entity is two entities. The stable pointer carries the name,
description, tags, containment and a `currentVersion` link; its IRI is what you
share and what a tag attaches to. Each version carries the content, an integer
`version` counting from 1, and an `isPartOf` link back to the pointer.

Listing responses for a pointer also project `currentVersionNumber` from the
version it points at, so a caller listing queries gets "v3" without a second
request.

### What is immutable

A version is frozen when it is created. `immutable` is set to `true` by the
writer, and an `immutable` field in a create request body is ignored — there is
no state in which a version can still change.

`PATCH` on a version is therefore restricted to *annotations*, meaning things
said about the version rather than its content:

| Field | Allowed | Result if refused |
| --- | --- | --- |
| `comment` | yes | — |
| `immutable: true` | yes | The freeze transition, for versions created before freeze-on-create |
| `immutable: false` | no | `409` — `A version cannot be unfrozen; create a new version instead.` |
| any content field | no | `409` — `Version is immutable; create a new version instead.` |
| `id`, `$id`, `@type`, `version`, `isPartOf` | no | `400` — `Cannot update system field '<name>'. This field is controlled by the backend.` |

The two rejections are different mistakes: a content patch is an attempt to edit
the snapshot, a system-field patch is an attempt to renumber or re-parent it.
Both responses name the offending fields.

Tags are not annotations for this purpose. No version schema carries tags,
because tagging targets the stable entity. Nor is a query group's `canvasData`:
it rides in the group version payload, so allowing it would mean that dragging a
node while viewing an old version rewrote that version.

The button that creates a version is **Save**, and the states are *unsaved* and
*saved*. Edits before that are a browser-local draft; saving is what produces
something a test, a benchmark or a pin can name.

### Pinning and floating

Two ways of naming content follow from the split:

- A **pin** is a version IRI. It always resolves to the same content.
- A **float** is a pointer IRI. It resolves to whatever that entity's
  `currentVersion` is at the time of the call.

Execution always resolves to a version, so a run is reproducible from its record
even when the reference that started it was floating. Where a plan floats and a
run must not, both are stored: a benchmark plan names an `ArgumentSet` through
`refArgumentSet` while each run records `refArgumentSetVersion`, and a rule-set
plan records `refDataGraph` alongside `refDataGraphVersion`.

Concurrency on the stable pointer uses HTTP validators rather than version
numbers. A `GET` returns `ETag` and `Last-Modified` derived from `dateModified`;
a `PUT` or `PATCH` carrying `If-Match` that no longer matches answers `412
Precondition Failed` with the current entity in the body, so the caller can
refresh and retry.

See [versioning and immutability](../explanation/versioning-and-immutability.md)
for why the model is shaped this way.

## Containment

Containment is `sdo:isPartOf`. What the predicate points at differs by kind:

| Kind | `isPartOf` points at |
| --- | --- |
| `Query`, `Rule`, `RuleSet`, `DataBlock` | An array that must contain exactly one `Library`, and may also contain `QueryGroup` entries |
| `QueryGroup`, `ArgumentSet`, `Tag`, `EtlJob` | A `Library` |
| `DataGraph`, `TupleSet`, `Test` | Exactly one `Library` |
| Any `*Version` | Its stable pointer |
| `TestCase`, `TestCaseDataGraph` | Their `TestVersion` |
| `Patch` | The `Backend` whose data it describes — containment and target in one predicate, so read access follows the backend's path |
| `Backend` | Nothing. Backends are account-level and shared by every library |
| `BenchmarkExperiment` | Nothing in its schema. It is reached through the library's benchmark listing rather than through containment |

A library is the unit you export, import and copy, and the unit a grant applies
to. It may name a `defaultBackend` and a list of `allowedBackends`, which is
what its own saved queries may execute against; `defaultBackend` is always
implicitly included.

## Subject kinds

Four kinds of thing are callable and can be the subject of a test or a
benchmark. Each accepts a different set of inputs, declared in
`packages/types/src/subjectKinds.ts` and enforced by the test writer:

| Subject kind | Backend | Data graph | Argument set | Tuple seeds | SQL fixture |
| --- | --- | --- | --- | --- | --- |
| `query` | yes | yes | yes | no | no |
| `queryGroup` | no | yes | yes | no | no |
| `ruleSet` | no | yes | no | yes | no |
| `etlJob` | no | yes | no | no | yes |

A query is the one kind that accepts two stores and must run against one: a test
names either a backend, or a data graph on every case, never both and never
neither. That is judged across the whole version rather than per case, because
whether a run was hermetic is recorded once and lands in every report.

A refusal names the slot and says why the kind does not take it — for example, a
rule set runs in-process against its base graph, so there is no endpoint to
name; to query a live endpoint first and run rules over what comes back, use a
query group.

## Vocabulary

Entity properties map to RDF predicates from schema.org (`sdo:name`,
`sdo:description`, `sdo:isPartOf`, `sdo:version`, `sdo:dateCreated`,
`sdo:dateModified`), from XSD for datatypes, and from `sqlib:`
(`https://sparql-query-lib/`) for everything specific to this system. Test
reports are written in W3C EARL, with DOAP, FOAF and Dublin Core terms for the
subject and the assertor, so a conformance submission and an ordinary library
test run produce the same shape of graph.

`ldkit:IRI` marks a property whose object is an IRI reference rather than a
literal. The vocabulary outlived the library it is named after: changing the IRI
would be a data-format migration rather than a rename.
