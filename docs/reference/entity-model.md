# Entity model reference

This page lists the entity kinds that the server stores, how each is
identified, which are versioned, and what contains what.
[Concepts](../concepts.md) explains the purpose of each kind. This page is for
lookup.

The authoritative list of type names is
`packages/api/src/persistence/entityTypeNames.ts`. Each name has a schema in
`packages/api/src/persistence/schemas/` and a repository registered in
`packages/api/src/lib/EntityRegistry.ts`. The compiler checks both against the
name list, so a type added to one and not to the other does not build.

The [feature flags](feature-flags.md) of the deployment decide whether the
routes of a kind are registered.

## Entity kinds

### Library content

Each of these kinds belongs to exactly one library, and is versioned. A stable
pointer holds the name and metadata. Immutable numbered versions hold the
content.

| Stable pointer | Version | What it holds |
| --- | --- | --- |
| `Query` | `QueryVersion` | One SPARQL query: its text, its type, and the parameters, inputs and outputs inferred from it |
| `QueryGroup` | `QueryGroupVersion` | A DAG of nodes and edges: the canvas |
| `Rule` | `RuleVersion` | One SRL rule |
| `DataBlock` | `DataBlockVersion` | One SRL `DATA { … }` block of ground triples |
| `RuleSet` | `RuleSetVersion` | A set of rules and data blocks, with its stratification report. Its content is an SRL document. See [the SRL reference](srl-language.md) |
| `DataGraph` | `DataGraphVersion` | Reference RDF that the library holds, as a serialised document |
| `TupleSet` | `TupleSetVersion` | A table of RDF terms, as a SPARQL Results JSON document |
| `Notebook` | `NotebookVersion` | Prose and cells over the entities of the library, as a `sqlib-notebook/1` JSON document |
| `ArgumentSet` | `ArgumentSetVersion` | The input for one call of a callable |
| `Test` | `TestVersion` | A callable, its inputs, and the expected result |
| `BenchmarkExperiment` | `BenchmarkExperimentVersion` | A measurement plan: subjects, backends, repeats, timing policy |
| `EtlJob` | `EtlJobVersion` | DuckDB SQL and a SPARQL template that builds RDF from its rows |
| `EtlColumnMapping` | `EtlColumnMappingVersion` | How the columns of an ETL job map into that template |

### Not versioned

| Kind | What it is |
| --- | --- |
| `Library` | The container. Carries a name and an optional `defaultBackend` |
| `Backend` | A SPARQL endpoint or an in-process Oxigraph store. It is at account level: no library contains it, and libraries point to it |
| `Tag` | A label in a library. It is not versioned, because a tag classifies content and is not content |
| `Patch` | The ground quad diff of one write against a backend. It records an event, and is written once. After that, only its status changes |
| `EtlExecution` | One run of an ETL job version, with its status, counts and output location |
| `TestRun`, `TestRunCase` | One execution of a test, and the verdict for each case. A run is not library content, because nobody authors it. It refers to its test by a plain reference, and no containment |

### Structural parts

These parts exist only inside a version. They are listed here because they
appear as IRIs in API responses.

| Kind | Belongs to |
| --- | --- |
| `LimitParameter`, `OffsetParameter` | A `QueryVersion`: one for each `LIMIT 000n` / `OFFSET 000n` |
| `QueryInputTuple`, `QueryOutputTuple`, `TupleMember` | A `QueryVersion`: the tuple signatures inferred from its `VALUES` clauses and projection |
| `QueryInputVariable`, `QueryOutputVariable` | The ports of a query group node |
| `TriplesQuadsIO`, `BooleanIO`, `QueryIdInput` | Ports that are not tables: RDF output, the boolean of an ASK, the query identifier of a dynamic node |
| `QueryNode`, `RuleSetNode`, `PatchNode`, `DuckDbEtlNode`, `DynamicQueryNode`, `StartNode`, `EndNode`, `QueryEdge` | A `QueryGroupVersion` |
| `ArgumentTupleBinding`, `ArgumentScalarBinding` | An `ArgumentSetVersion`: a table for each `VALUES` clause, a number for each named limit. An argument set holds no graphs. See [argument sets without graphs](../proposals/argument-sets-without-graphs.md). |
| `BrowserDefaultDataGraph` | A `QueryGroup` or a `RuleSet`: the data graph that the web app selects for one input, by `position`. See [browser defaults](../proposals/browser-defaults.md). |
| `TestCase`, `TestCaseDataGraph` | A `TestVersion` |
| `BenchmarkRun`, `BenchmarkNodeRun`, `BenchmarkIterationRun` and their `*Observation` counterparts | A benchmark execution |

## Identity

The IRI of an entity never changes. The server mints it, in
`packages/api/src/lib/id.ts`, as a prefix for the kind, then a UUID without its
hyphens:

```
urn:sqlib:query:5f2c1b9a4e7d4c8fb3a1e6d09c7b2a54
urn:sqlib:query-version:0a7e3c5d19b24f6c8d2a7e13b4c95f60
```

Each kind has its own prefix. Most prefixes are the type name in lower case,
with hyphens between words: `urn:sqlib:query:`, `urn:sqlib:query-version:`,
`urn:sqlib:data-graph:`, `urn:sqlib:tuple-set:`, `urn:sqlib:argument-set:`,
`urn:sqlib:test:`, `urn:sqlib:etl-job:`, `urn:sqlib:backend:`,
`urn:sqlib:library:`, `urn:sqlib:tag:` and `urn:sqlib:patch:`. Some are shorter
than their type name: a `RuleSet` is `urn:sqlib:ruleset:`, and a `QueryGroup`
is `urn:sqlib:group:`. The full map is the `NS` constant in that module. Do not
derive a prefix from a type name.

A client can supply its own `id` when it makes an entity. The field is optional
in each schema. Where a create schema accepts it, the value must match `^urn:`
and must not already exist. Usually, omit it, and the server mints one.

### Three spellings of the same identity

| Spelling | Where |
| --- | --- |
| `$id` | Internally, in TypeScript |
| `@id` | In RDF and JSON-LD, when the entity is persisted or exported |
| `id` | In REST request and response bodies |

The adapters in `packages/api/src/persistence/utils/id-adapter.ts` convert at
the boundary: `toPersisted` on the way in, and `toRestApi` on the way out. No
route handler converts manually. In a schema definition, `'@id'` on a
*property* has a different meaning: it names the RDF predicate of that
property. Only `'@id'` on an entity is identity.

## Versioning

A versioned entity is two entities:

- The stable pointer holds the name, description, tags, containment and a
  `currentVersion` link. You share its IRI, and tags attach to it.
- Each version holds the content, an integer `version` that starts at 1, and an
  `isPartOf` link back to the pointer.

A list response for pointers also gives `currentVersionNumber` from the version
that each one points to. A caller that lists queries therefore gets "v3" with
no second request.

### What is immutable

A version is frozen when it is made. The writer sets `immutable` to `true`, and
ignores an `immutable` field in a create request body. A version can never
change.

`PATCH` on a version therefore accepts only *annotations*: statements about the
version, which are not its content.

| Field | Allowed | Result if refused |
| --- | --- | --- |
| `comment` | yes | — |
| `immutable: true` | yes | The freeze transition, for versions created before freeze-on-create |
| `immutable: false` | no | `409`: `A version cannot be unfrozen; create a new version instead.` |
| any content field | no | `409`: `Version is immutable; create a new version instead.` |
| `id`, `$id`, `@type`, `version`, `isPartOf` | no | `400`: `Cannot update system field '<name>'. This field is controlled by the backend.` |

The two refusals are for two different mistakes. A content patch tries to edit
the snapshot. A system-field patch tries to change its number or its parent.
Both responses name the fields at fault.

Tags are not annotations here. No version schema has tags, because a tag applies
to the stable entity. The `canvasData` of a query group is also not an
annotation. It is in the payload of the group version. If `PATCH` accepted it, a
node dragged while an old version is open would change that version.

The button that makes a version is **Save**, and the states are *unsaved* and
*saved*. Before a save, edits are a draft in the browser. A save makes a version
that a test, a benchmark or a pin can name.

### Pinning and floating

The split gives two ways to name content:

- A **pin** is a version IRI. It always resolves to the same content.
- A **float** is a pointer IRI. It resolves to the `currentVersion` of that
  entity at the time of the call.

Execution always resolves to a version. You can therefore reproduce a run from
its record, also when a float started it. When a plan floats and a run must not,
sqlib stores both. A benchmark plan names an `ArgumentSet` through
`refArgumentSet`, and each run records `refArgumentSetVersion`. A rule-set plan
records `refDataGraph` with `refDataGraphVersion`.

Concurrency on the stable pointer uses HTTP validators, and no version numbers.
A `GET` returns `ETag` and `Last-Modified`, from `dateModified`. A `PUT` or
`PATCH` with an `If-Match` that no longer matches gets `412 Precondition
Failed`, with `{ error, expected, current }`. `current` holds the current
entity, so the caller can refresh and try again.

`dateModified` is the revision. Each write moves it forward. When two writes
occur in the same millisecond, the second adds one millisecond to the previous
value. No two states of an entity therefore share a tag. `If-Match` follows RFC
9110: `*`, or a comma-separated list of tags, any of which can match. The
comparison is strong, so a weak `W/"…"` tag never matches. sqlib accepts a
bare, unquoted `dateModified` as a strong tag, because clients have always sent
it in that form.

[Versioning and immutability](../explanation/versioning-and-immutability.md)
gives the reasons for this model.

### Who created and changed an entity

Each entity with `dateCreated` and `dateModified` also has two authorship
fields. Each holds the principal IRI of a signed-in caller
(`urn:sqlib:principal:user:…`).

| Field | Predicate | Set |
| --- | --- | --- |
| `createdBy` | `dct:creator` | Once, when the entity is created. It never changes. |
| `modifiedBy` | `sqlib:modifiedBy` | On create and on each update. It names the author of the write that `dateModified` dates. |

The server sets both, in the same place as the timestamps
(`CacheCoordinator`). A client cannot set them: create and update bodies
leave them out. The rules:

- A signed-in caller is recorded. This follows the same rule as the
  `?authUser` identity slot.
- A request that identifies no person records no person. This applies to
  `disabled` and `anonymous` mode, a system token, and `dry-run` without a
  token. Such an update clears `modifiedBy`, so the field never names a person
  who did not make the last write.
- A write outside a request (startup, a seed, an import script) keeps the values
  that the entity already has.
- A run that continues after its response (a test or benchmark run) records
  the caller who started it.

Entities saved before these fields existed, or while auth was disabled, have
neither field.

## Containment

Containment is `sdo:isPartOf`. The target of the predicate depends on the kind:

| Kind | `isPartOf` points at |
| --- | --- |
| `Query`, `Rule`, `RuleSet`, `DataBlock` | An array that must contain exactly one `Library`, and may also contain `QueryGroup` entries |
| `QueryGroup`, `ArgumentSet`, `Tag`, `EtlJob` | A `Library` |
| `DataGraph`, `TupleSet`, `Test` | Exactly one `Library` |
| Any `*Version` | Its stable pointer |
| `TestCase`, `TestCaseDataGraph` | Their `TestVersion` |
| `BrowserDefaultDataGraph` | Its `QueryGroup` or `RuleSet` |
| `Patch` | The `Backend` whose data it describes. One predicate gives containment and target, so read access follows the path of the backend |
| `Backend` | Nothing. Backends are at account level, and each library can use them |
| `BenchmarkExperiment` | A `Library`. Required on create. An experiment stored before this field existed has none, and only administrators can use it until `scripts/backfill-benchmark-ownership.ts` sets one |

A library is the unit that you export, import and copy, and the unit that a
grant applies to. It can name a `defaultBackend`: the backend that its queries
run on when no other backend is selected. It grants no access to that backend.

## Subject kinds

Four kinds are callable, and can be the subject of a test or a benchmark. Each
kind accepts a different set of inputs. `packages/types/src/subjectKinds.ts`
declares them, and the test writer enforces them:

| Subject kind | Backend | Data graph | Argument set | Tuple seeds | SQL fixture |
| --- | --- | --- | --- | --- | --- |
| `query` | yes | yes | yes | no | no |
| `queryGroup` | no | yes | yes | no | no |
| `ruleSet` | no | yes | no | yes | no |
| `etlJob` | no | yes | no | no | yes |

A query is the only kind that accepts two stores and must run against one of
them. A test names a backend, or a data graph on each case. It cannot name both
or neither. sqlib checks this for the whole version, because a run records once
whether it was hermetic, and each report shows this.

A refusal names the slot, and gives the reason that the kind does not take it.
For example, a rule set runs in the process against its base graph, so there is
no endpoint to name. To query a live endpoint and then run rules over the
result, use a query group.

## Vocabulary

Entity properties map to RDF predicates from these vocabularies:

- schema.org: `sdo:name`, `sdo:description`, `sdo:isPartOf`, `sdo:version`,
  `sdo:dateCreated`, `sdo:dateModified`;
- Dublin Core: `dct:creator`;
- XSD: datatypes;
- `sqlib:` (`https://sparql-query-lib/`): each term specific to this system.

Test reports use W3C EARL, with DOAP, FOAF and Dublin Core terms for the subject
and the assertor. A conformance submission and an ordinary library test run
therefore give the same shape of graph.

`sqlib:IRI` marks a property whose object is an IRI reference, and not a
literal. It is a marker in the schema only. sqlib never writes it into the
stored data, where the value is an IRI node.
