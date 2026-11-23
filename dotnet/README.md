# SparqlQueryLib.Runtime

Run the parameterised SPARQL queries of an exported sqlib bundle from .NET,
with no sqlib server.

The library loads a bundle, takes a query name and a payload, and returns the
query text with the arguments filled in. An optional `SparqlEndpoint` sends
that text to a SPARQL endpoint over HTTP.

For each bundle and payload, it returns the same text as the TypeScript runtime
(`@sparql-query-lib/runtime`), or refuses with the same error type and the same
message. A shared set of golden cases checks this on every build.

## Install

```sh
dotnet add package SparqlQueryLib.Runtime
```

Targets:

- `net8.0` and later.
- `netstandard2.0`, for .NET Framework 4.7.2 and later. This build depends on
  `System.Net.Http`.

## Bundle versions

This release reads bundle format versions 1 and 2. It refuses any other
version. It ignores fields that it does not know, so a bundle from a newer
exporter loads when its version number is 1 or 2.

## Use

Export a bundle from sqlib with `sqlib pull`, with
`pnpm --filter @sparql-query-lib/api export:bundle`, or with
`GET /libraries/:id/export-bundle`. `QueryLibrary.Load` accepts a bare bundle
and the `{ "bundle": ..., "skipped": [...] }` envelope of the route.

```csharp
using SparqlQueryLib.Runtime;

var library = QueryLibrary.LoadFile("library.bundle.json");
var query = library.Query("people-by-city");

// A payload as JSON: the CallPayload of the TypeScript runtime.
var text = query.Text("""
{
  "arguments": [
    { "head": { "vars": ["city"] },
      "results": { "bindings": [
        { "city": { "type": "uri", "value": "http://example.org/Perth" } } ] } }
  ],
  "limits": [ { "name": "1", "value": 20 } ]
}
""");

// The same payload, typed.
var payload = new CallPayload()
    .With(ArgumentSet.Of("city", Term.Iri("http://example.org/Perth")))
    .Limit("1", 20);
text = query.Text(payload);

// No payload: every slot runs open, and each page parameter keeps its placeholder.
text = query.Text();
```

Send the text to an endpoint:

```csharp
var endpoint = new SparqlEndpoint(httpClient, new Uri("https://example.org/ds/query"));
using var response = await endpoint.SendAsync(query, payload, cancellationToken: ct);
using var stream = await response.Content.ReadAsStreamAsync();
```

`SendAsync` sends `application/sparql-query` by default. Set
`SparqlEndpointOptions.Encoding` to `Form` to send `query=` as a form. The
default `Accept` is `application/sparql-results+json` for SELECT and ASK, and
`text/turtle` for CONSTRUCT and DESCRIBE. A status outside 2xx raises
`SparqlEndpointException` with the status and the first 2000 characters of the
body. `OpenReadAsync` returns the body as a stream that disposes the response
when you dispose it.

## Errors

Every exception derives from `SqlibRuntimeException`.
`TypeScriptName` gives the name of the matching TypeScript error.

| C# | TypeScript | Raised when |
| --- | --- | --- |
| `InvalidBundleException` | `InvalidBundleError` | The bundle fails a structural check or a `textHash` check. |
| `InvalidArgumentException` | `InvalidArgumentError` | The payload has the wrong shape, or a cell is a blank node or has an unknown type. |
| `InvalidTermException` | `InvalidTermError` | A value is not a valid IRI, language tag or variable name. |
| `InvalidParameterException` | `InvalidParameterError` | A LIMIT or OFFSET value is not an integer from 0 to 2^53-1. |
| `ReservedSlotException` | `ReservedSlotError` | An argument names `authUser` or `authGroup`. |
| `QueryCallException` | `QueryCallError` | The bundle has no query with that name, or the short form gives more argument sets than the query has slots. |
| `SlotMismatchException` | `Error` | An argument matches no free slot, a `require` slot is empty, a value does not match its `valuePattern`, or an all-UNDEF row is mixed with bound rows. |
| `InvalidValuePatternException` | `Error` | A `valuePattern` is invalid, or uses a construct that this library does not translate. |
| `SparqlEndpointException` | `SparqlEndpointError` | The endpoint answers with a status outside 2xx. |

A payload that is not JSON raises `JsonSyntaxException`, a `FormatException`.

## Limits

- It runs single queries. It validates and hashes the `groups`, `etlJobs`,
  `ruleSets` and `updates` sections of a bundle, but it does not run them.
- It has no authorization. A bundle grants what the endpoint grants its caller.
- A `valuePattern` match times out after 1 s by default and raises
  `RegexMatchTimeoutException`. Change this with
  `BundleLoadOptions.ValuePatternTimeout`.
- Do not edit bundles. Slot positions are offsets into the query text. The
  loader checks each `textHash` and refuses an edited text. Set
  `BundleLoadOptions.VerifyHashes` to `false` to skip this check.

The guide, with the value pattern subset and the differences from the
TypeScript runtime, is
[docs/guides/dotnet-runtime.md](https://github.com/recalcitrantsupplant/sqlib/blob/main/docs/guides/dotnet-runtime.md).
