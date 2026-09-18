/**
 * Namespaces for the SPARQL Query Library
 *
 * These namespaces provide type-safe access to vocabulary terms
 * used throughout the application's RDF schemas.
 */

import { createNamespace } from './vocabulary.js';

// Standard vocabularies the schemas draw datatypes from. Previously imported
// from `ldkit/namespaces`; the term lists and IRIs are carried over unchanged so
// every schema keeps producing the IRIs already stored in the data.
export const xsd = createNamespace({
  iri: "http://www.w3.org/2001/XMLSchema#",
  prefix: "xsd:",
  terms: [
    "anyURI",
    "boolean",
    "byte",
    "date",
    "dateTime",
    "decimal",
    "double",
    "duration",
    "float",
    "int",
    "integer",
    "language",
    "long",
    "negativeInteger",
    "nonNegativeInteger",
    "nonPositiveInteger",
    "normalizedString",
    "positiveInteger",
    "short",
    "string",
    "time",
    "token",
    "unsignedByte",
    "unsignedInt",
    "unsignedLong",
    "unsignedShort"
  ]
} as const);

/**
 * The RDF vocabulary.
 *
 * `rdf:JSON` is the datatype a property declares to say "my object is a JSON
 * document, not a string". It is a real datatype rather than a convention on
 * plain literals so that a JSON value is distinguishable in the store from a
 * string that happens to look like one — which is what lets a value written
 * before the datatype existed be recognised as needing repair (issue #305).
 */
export const rdf = createNamespace({
  iri: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  prefix: "rdf:",
  terms: [
    "type",
    "JSON"
  ]
} as const);

/**
 * The LDKit ontology.
 *
 * Retained after LDKit itself was removed because `ldkit:IRI` is the marker the
 * schemas use for "this property's object is an IRI reference, not a literal",
 * and it is written into the schema objects that generate the API contracts.
 * Changing the IRI would be a data-format migration, not a cleanup, so the
 * vocabulary outlives the library it is named after.
 * `schemaIntrospection.LDKIT_IRI_TYPE` is the runtime counterpart.
 */
export const ldkit = createNamespace({
  iri: "https://ldkit.io/ontology/",
  prefix: "ldkit:",
  terms: [
    "Resource",
    "IRI"
  ]
} as const);

// Schema.org namespace with HTTPS (the built-in one uses HTTP)
export const sdo = createNamespace({
  iri: "https://schema.org/",
  prefix: "sdo",
  terms: [
    "name",
    "description",
    "comment",
    "url",
    "dateCreated",
    "dateModified",
    "creativeWorkStatus",
    "isPartOf",
    "additionalProperty",
    "keywords",
    "version"
  ]
} as const);

// Schema.org namespace with "schema" prefix
export const schema = createNamespace({
  iri: "http://schema.org/",
  prefix: "schema",
  terms: [
    "name",
    "description",
    "comment",
    "url",
    "dateCreated",
    "dateModified",
    "creativeWorkStatus",
    "isPartOf",
    "additionalProperty",
    "keywords",
    "version"
  ]
} as const);

export const qb = createNamespace({
  iri: "http://purl.org/linked-data/cube#",
  prefix: "qb",
  terms: [
    "DataSet",
    "Observation",
    "structure",
    "dataSet",
    "dimension",
    "measure",
    "attribute",
    "component",
    "componentRequired",
  ]
} as const);

export const prov = createNamespace({
  iri: "http://www.w3.org/ns/prov#",
  prefix: "prov",
  terms: [
    "startedAtTime",
    "endedAtTime",
  ]
} as const);

/**
 * W3C EARL — the vocabulary test reports are written in.
 *
 * Chosen over minting `sqlib:` terms because the W3C eval/ harness (#150)
 * already reports in EARL, so conformance runs and ordinary library test runs
 * produce the same graph rather than two shapes needing a mapping. See
 * `docs/guides/testing-and-conformance.md`.
 *
 * `inapplicable` and `untested` are unused by `reportFormats/earl.ts` today; they are
 * here because the eval harness needs them the moment it lands, and a namespace
 * is cheaper to fill once than to revisit.
 */
export const earl = createNamespace({
  iri: "http://www.w3.org/ns/earl#",
  prefix: "earl",
  terms: [
    "Assertion",
    "TestResult",
    "TestCase",
    "TestSubject",
    "Software",
    "Assertor",
    "assertedBy",
    "subject",
    "test",
    "result",
    "mode",
    "outcome",
    "info",
    "passed",
    "failed",
    "cantTell",
    "inapplicable",
    "untested",
    "automatic",
  ]
} as const);

/**
 * Dublin Core terms. `dct:date` is EARL's conventional timestamp — it defines
 * none — and `dct:title` names the case an assertion cites, so a report graph
 * says which case failed without a join back to the library store it does not
 * live in.
 */
export const dct = createNamespace({
  iri: "http://purl.org/dc/terms/",
  prefix: "dct",
  terms: [
    "date",
    "title",
    // The report's own header: what it is a report of, in a document that has
    // no `sqlib:` terms to say it with.
    "description",
    "hasVersion",
  ]
} as const);

/**
 * DOAP — how a *project* is described to someone who was not told about it.
 *
 * A conformance submission has to say what was tested precisely enough for a
 * reader to obtain the same thing and check: name, release, repository,
 * homepage. EARL itself says none of that — its `earl:TestSubject` is a bare
 * node — so every W3C implementation report pairs the two, and this is the
 * half that makes `earl:subject` more than an opaque IRI.
 */
export const doap = createNamespace({
  iri: "http://usefulinc.com/ns/doap#",
  prefix: "doap",
  terms: [
    "Project",
    "Version",
    "name",
    "description",
    "shortdesc",
    "homepage",
    "repository",
    "download-page",
    "programming-language",
    "release",
    "revision",
    "developer",
  ]
} as const);

/**
 * FOAF, for the assertor.
 *
 * Who stands behind a verdict is part of the claim: a report asserted by the
 * software about itself and a report asserted by a named person are different
 * evidence, and a reviewer is entitled to tell them apart. `foaf:name` and
 * `foaf:homepage` are what the W3C report generators read.
 */
export const foaf = createNamespace({
  iri: "http://xmlns.com/foaf/0.1/",
  prefix: "foaf",
  terms: [
    "Person",
    "Organization",
    "Agent",
    "name",
    "homepage",
  ]
} as const);

// SPARQL Query Library custom vocabulary
export const sqlib = createNamespace({
  iri: "https://sparql-query-lib/",
  prefix: "sqlib",
  terms: [
    "Backend",
    "backendType",
    "authEnvKey",
    "query",
    "queryType",
    "srlImportable",
    "srlImportRevision",
    "rule",
    "normalizedInsert",
    "grammarType",
    "grammarValid",
    "validationError",
    "grammarValidations",
    "queryId",
    "backendId",
    "defaultBackend",
    "allowedBackend",
    "inferredOutputs",
    "limitParameters", 
    "offsetParameters",
    "executionNodes",
    "edges",
    "canvasData",
    "inputs",
    "outputs",
    "outputTuples",
    "inferredInputs",
    "QueryGroup",
    "QueryNode",
    "RuleSetNode",
    "PatchNode",
    "deletionsOutput",
    "additionsOutput",
    "DuckDbEtlNode",
    "etlJobVersionId",
    "QueryEdge",
    "QueryInputTuple",
    "QueryOutputTuple",
    "QueryInputVariable",
    "QueryOutputVariable",
    "allowedTypes", 
    "LimitParameter",
    "OffsetParameter",
    "value", 
    "defaultValue",
    "valueType",
    "datatype",
    "language",
    "TupleMember",
    "position",
    "variable",
    "inputVariables",
    "outputVariables",
    "variableName",
    "StartNode",
    "EndNode",
    "DynamicQueryNode",
    "startNode",
    "endNode",
    "mediaType",
    "sourceNodeId",
    "targetNodeId",
    "sourceLocalId",
    "targetLocalId",
    "dataFlowType",
    "sourceOutputId",
    "targetInputId",
    "variableMappings",
    "nodeType",

    "memberEntries",
    "whenEmpty",
    "Library",
    "Query",
    "QueryVersion",
    "Rule",
    "RuleVersion",
    "RuleSet",
    "RuleSetVersion",
    "ruleSetVersion",
    "DataBlock",
    "DataBlockVersion",
    "isImmutable",
    "hasRule",
    "hasDataBlock",
    "stratificationReport",
    "tupleSeeds",
    // DuckDB statements a test case runs before its ETL subject's own SQL —
    // the rows the job reads.
    "sqlFixture",
    "tuplesEnabled",
    "rulesetMembership",
    "QueryGroupVersion",
    "currentVersion",
    "groupId",
    "rdfOutputs",
    "serializationFormat",
    "TriplesQuadsIO",
    "BooleanIO",
    "QueryIdInput",
    "ioType",
    "outputType",
    "triplesOrQuads",
    "specifiedGraph",
    "ArgumentSet",
    "ArgumentSetVersion",
    "ArgumentTupleBinding",
    "ArgumentScalarBinding",
    // A data graph bound to a query group's start-node graph port. Queries
    // declare no graph parameter — their store is their backend. See
    // `docs/concepts.md`.
    "ArgumentGraphBinding",
    // The argument-set binding a data graph was minted from, when it was
    // created by pasting RDF into a call rather than composed on the rail.
    // Origin, for the rail's Origin grouping — not a link and not a fence.
    "mintedFrom",
    "graphBindings",
    "argumentSets",
    "targetEntity",
    "argumentScope",
    "tupleBindings",
    "scalarBindings",
    "tupleSignature",
    "fallbackVariables",
    "parameterKind",
    "parameterName",
    "numericValue",
    "provenanceTupleId",
    "parameterIri",

    // Benchmarking
    "BenchmarkExperiment",
    "BenchmarkExperimentVersion",
    "BenchmarkRun",
    "BenchmarkNodeRun",
    // The second-level dataset a rule-set run writes its per-iteration
    // observations into — the fixpoint loop's counterpart to
    // `BenchmarkNodeRun`.
    "BenchmarkIterationRun",
    "BenchmarkObservation",
    "BenchmarkNodeObservation",
    "BenchmarkIterationObservation",
    "subjectSpecs",
    "subject",
    "backends",
    "repeats",
    "executionStrategy",
    "timeWindow",
    "maxConcurrency",
    "warmupRuns",
    "cooldownMs",
    "timeoutMs",
    "retryCount",
    "retryDelayMs",
    "randomizeOrder",
    "abortOnError",
    "definedBy",
    "refSubject",
    "refBackend",
    "refArgumentSet",
    // What `refArgumentSet` resolved to when the run executed. The plan names
    // an argument set — a library object that floats — so the version is the
    // only place a run's actual inputs are recorded (issue #246).
    "refArgumentSetVersion",
    // The graph axis, which only a rule-set subject has: the base graph a run
    // read, and what that reference resolved to. Same floating-plan/pinned-run
    // split as `refArgumentSet`/`refArgumentSetVersion` above.
    "refDataGraph",
    "refDataGraphVersion",
    "runIndex",
    "durationMs",
    "resultCount",
    "success",
    "errorMessage",
    "errorType",
    "backendDurationMs",
    "queueDelayMs",
    "timestamp",
    "runStatus",
    "tasksTotal",
    "tasksCompleted",
    "refGroupObservation",
    "refNode",
    "nodeIndex",
    // Per-iteration observations for a rule-set request. An iteration has no
    // library object to point at the way a node observation points at its
    // node, so its identity is ordinal: `iterationIndex` within the run to
    // fixpoint, `stratum` saying which layer that ordinal belongs to.
    "refSubjectObservation",
    "iterationIndex",
    "stratum",
    "tupleCount",
    "rulesEvaluated",

    // Data graphs — the *input* a ruleset runs against, distinct from the
    // DATA blocks that are part of a ruleset.
    "DataGraph",
    "DataGraphVersion",
    "contentString",
    "contentFormat",
    "tripleCount",
    "byteSize",
    // Provenance for a version materialized from a query rather than
    // hand-authored (issue #153) — see DataGraphVersionSchema.ts.
    "sourceQueryVersion",
    "sourceArgumentSetVersion",
    "sourceBackend",
    "sourceExecutedAt",
    "sourceResultHash",

    // Tests — an invocation spec plus an expectation.
    "Test",
    "TestVersion",
    "TestCase",
    "cases",
    "subjectKind",
    "subjectVersion",
    "dataGraphVersion",
    // A case's ordered data graph inputs, one per start-node RDF port. The
    // single `dataGraphVersion` above stays as the one-graph spelling.
    "TestCaseDataGraph",
    "dataGraphs",
    "expectationKind",
    "expected",
    "expectedFormat",
    "ordered",
    "maxIterations",

    // Test reports. EARL covers the assertion itself; these carry what it has
    // no term for — the comparator diff, and whether the run touched a live
    // backend. `refSubject`/`refBackend`/`refArgumentSet` are reused from the
    // benchmark dimensions rather than duplicated, so verdicts and timings join.
    "detail",
    "hermetic",
    // `earl:test` names the *case*, so the version an assertion came from needs
    // a term of its own — it is what "which version broke it" is asked against.
    "testVersion",
    // The external criterion a test implements — a W3C manifest entry IRI, say.
    // A `Test` has its own minted id because it is library content that can be
    // edited; this is the immutable thing upstream calls the same test, and it
    // is what a conformance report must cite instead of our id. Set by the W3C
    // suite seeder, and settable by hand for any other external suite.
    "criterion",

    // Stored test runs — the durable half of the above (issue #179). A run is
    // not library content: it is not authored, it lives outside the preloaded
    // registry, and `refTest` is a plain reference rather than `sdo:isPartOf`
    // precisely so that a run cannot read as an edit to the test it judged.
    // `TestRunCase` is `sdo:isPartOf` its run, which *is* containment: a case
    // row has no life outside the run that produced it.
    "TestRun",
    "TestRunCase",
    "refTest",
    // The `TestCase` a row judged. Deliberately not `@references`d: editing a
    // test deletes and re-mints its cases, so an old run legitimately cites an
    // id that no longer resolves. That is history, not a dangling pointer.
    "refTestCase",
    // `earl:outcome` in all but name — `passed` / `failed` / `cantTell`. A
    // boolean cannot carry the third, which is the one a history most needs:
    // "broken since Tuesday" is not "failing since Tuesday".
    "outcome",
    "ranAt",
    // What the run was asked for as: a test IRI for a single run, the tag list
    // for a suite. The label a stored report is identifiable under.
    "suite",
    "passedCount",
    "failedCount",
    "dataGraphVersions",

    // Tags — classification within a library, distinct from the containment
    // `sdo:isPartOf` states. `hasTag` is deliberately its own predicate rather
    // than a third meaning for `isPartOf`.
    "Tag",
    "hasTag",
    "color",

    // Patches — the ground quad diff of one write, kept as an event rather
    // than a version: what changed, on which backend, derived from what, and
    // whether it can be undone. `additions`/`deletions` hold canonical
    // N-Quads; `contentHash` over them is what an optimistic apply checks.
    // See `docs/explanation/rdf-patch.md`.
    "Patch",
    "additions",
    "deletions",
    "additionCount",
    "deletionCount",
    "rawInsertCount",
    "rawDeleteCount",
    "graphScope",
    "graphOps",
    "patchStatus",
    "applyMode",
    "revertible",
    "containsBnodes",
    "netEffectExact",
    "contentHash",
    "sourceKind",
    "sourceRef",
    "updateString",
    "inverseOf",
    "origin",
    "dateApplied",

    // Tuple sets — named tabular assets, the sibling of DataGraph.
    // `contentString` holds a SPARQL Results JSON document; `tupleColumns` is
    // its `head.vars` lifted onto the entity so listings and compatibility
    // verdicts never parse content. Deliberately not the existing `columns`,
    // which ETL uses for a JSON string of column *definitions* — same word,
    // different shape. See `docs/concepts.md`.
    "TupleSet",
    "TupleSetVersion",
    "sourceFormat",
    "tupleSetVersions",
    "tupleColumns",
    "rowCount",
    // Provenance for a version materialized by running an ETL job's SQL
    // (issue #211), alongside the shared `sourceExecutedAt`/`sourceResultHash`
    // above — see TupleSetVersionSchema.ts.
    "sourceEtlJobVersion",
    "sourceColumnMappingVersion",

    // ETL entities
    "EtlJob",
    "EtlJobVersion",
    "EtlColumnMapping",
    "EtlColumnMappingVersion",
    "EtlExecution",
    "etlJobVersion",
    "sql",
    "sparqlTemplate",
    "currentColumnMappingVersion",
    "chunkSize",
    "columns",
    "columnMappingVersion",
    "executionStatus",
    "startedAt",
    "completedAt",
    "totalChunks",
    "completedChunks",
    "totalRows",
    "errorMessage",
    "errorChunk",
    "outputFormat",
    "outputLocation",
    // The other sink an execution can have: a TupleSetVersion rather than a
    // file (issue #211). `outputReused` says the run cut no new version —
    // see EtlExecutionSchema.ts.
    "outputTupleSetVersion",
    "outputReused",
    "executionConfig",

    // Oxigraph backend configuration
    "oxigraphConfig",
    "storeType",
    "loadMethod",
    "sourceConfig",
    "persistPath",
    "filePath",
    "format",
    "remoteEndpoint",
    "importQuery",

    // In-memory Oxigraph backends hydrated from data graphs
    "storeMode",
    "sources",
    "dataGraphSourceId",
    "dataGraphSourceVersionId",

    // Query Node backend configuration
    "backendConfig",
    "storeId",

    // HTTP backend query method
    "queryMethod"
  ]
} as const);

export const sqlibBackendType = createNamespace({
  iri: "https://sparql-query-lib/backend-type/",
  prefix: "sqlibBackendType",
  terms: [
    "http",
    "oxigraphEphemeral",
    "oxigraphMemory"
  ]
} as const);

export const sqlibQueryType = createNamespace({
  iri: "https://sparql-query-lib/query-type/",
  prefix: "sqlibQueryType",
  terms: [
    "select",
    "construct",
    "describe",
    "ask",
    "update",
    "insert",
    "delete",
    "deleteInsert",
    "load",
    "clear",
    "create",
    "drop",
    "copy",
    "move",
    "add"
  ]
} as const);

export const sqlibQueryMethod = createNamespace({
  iri: "https://sparql-query-lib/query-method/",
  prefix: "sqlibQueryMethod",
  terms: [
    "post",
    "get"
  ]
} as const);
