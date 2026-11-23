# Getting started with SparqlQueryLib.Runtime

This guide takes you from nothing installed to a .NET application that runs
a query from a sqlib bundle against a SPARQL endpoint. Do the steps in order.
Each step says what you should see.

## What the library does

The SPARQL queries for your application are written and tested in sqlib. sqlib
exports them as one JSON file, the **bundle**. Each query in the bundle has
named **inputs**, such as `?city`, and can have page parameters for `LIMIT`
and `OFFSET`.

Your application does three things:

1. Load the bundle with `QueryLibrary.LoadFile`.
2. Give a query its input values. The library returns the complete SPARQL
   text. It checks each value first, so a bad value cannot change the query.
3. Send that text to your SPARQL endpoint, and read the result.

You do not write or edit SPARQL in C#. When a query must change, the query
author changes it in sqlib and sends you a new bundle.

## 1. Install the .NET SDK

You need the .NET 8 SDK or later.

1. Open a terminal and run `dotnet --version`.
2. If it prints `8.0.x` or a higher version, go to step 2.
3. Otherwise, install the SDK from <https://dotnet.microsoft.com/download>,
   then open a new terminal and run `dotnet --version` again.

## 2. Run the example

The example is a console app in `dotnet/examples/QuickStart`. It uses
`sample.bundle.json`, a small bundle with 4 queries.

1. Get the repository:

   ```sh
   git clone https://github.com/recalcitrantsupplant/sqlib.git
   cd sqlib/dotnet/examples/QuickStart
   ```

2. Run the app:

   ```sh
   dotnet run
   ```

The first run downloads packages and builds, which can take a minute. The
output starts like this:

```text
Bundle format version 2, 4 queries.

  people-by-city (SELECT)
    inputs:  ?city
  paged-things (SELECT)
    inputs:  ?type
    limits:  1
    offsets: 2
  ...

Step 3: people-by-city, one city
  PREFIX ex: <http://example.org/>
  SELECT ?name ?city WHERE {
    VALUES ?city { <http://example.org/city/perth> }
    ?person ex:livesIn ?city .
    ?person ex:name ?name .
  }
```

The last line is `Step 8: skipped`, because you gave no endpoint.

## 3. Read the example code

Open `Program.cs`. Each numbered comment matches a "Step" line in the output.

| Step | What it shows |
| --- | --- |
| 1 | Load a bundle from a file. |
| 2 | List the queries, their inputs and their page parameters. |
| 3 | Give one input one value, with the typed classes `CallPayload`, `ArgumentSet` and `Term`. |
| 4 | The same call with the payload as JSON. Both forms give the same text. |
| 5 | Two values for one input, a language-tagged literal, and `LIMIT` and `OFFSET` values. |
| 6 | A bad value raises an exception before anything is sent. |
| 7 | Run the test cases that the bundle carries for each query. |
| 8 | Send a query to an endpoint, and print the response. |

## 4. Send a query to a test endpoint

This step needs Docker. Skip it if you already have a SPARQL endpoint with
data: give its query URL in step 3 below.

1. Start an empty Oxigraph SPARQL server on port 7878:

   ```sh
   docker run -d --name sqlib-test -p 7878:7878 ghcr.io/oxigraph/oxigraph serve --location /data --bind 0.0.0.0:7878
   ```

2. Load the sample data into the default graph:

   ```sh
   curl -X POST -H "Content-Type: text/turtle" --data-binary @sample-data.ttl "http://localhost:7878/store?default"
   ```

3. Run the example with the endpoint:

   ```sh
   dotnet run -- sample.bundle.json http://localhost:7878/query
   ```

The last lines are:

```text
Step 8: http://localhost:7878/query answered 200
{"head":{"vars":["name","city"]},"results":{"bindings":[{"name":{"type":"literal","value":"Alice"},"city":{"type":"uri","value":"http://example.org/city/perth"}}]}}
```

4. When you are done, remove the server: `docker rm -f sqlib-test`.

## 5. Use your own bundle

You get the bundle file from the query author. Treat it as a build input:
commit it to your repository, and replace it as a whole when you get a new
version.

1. Run the example with your bundle:

   ```sh
   dotnet run -- path/to/your.bundle.json
   ```

2. Step 2 of the output lists your query names and their inputs. Use these
   names in your code.
3. Steps 3 to 7 use the queries of the sample bundle, so they are skipped for
   your bundle.

Do not edit the bundle by hand. Each query text has a hash, and the load
refuses a changed text with `InvalidBundleException`. The positions of the
inputs are character offsets into the text, so an edit would put values in
the wrong place.

## 6. Add the library to your application

When the package is on nuget.org, add it to your project:

```sh
dotnet add package SparqlQueryLib.Runtime
```

Until then, build the package from this repository and add it from a local
folder:

```sh
cd sqlib/dotnet
dotnet pack src/SparqlQueryLib.Runtime -c Release -o ~/local-nuget
cd path/to/your/project
dotnet add package SparqlQueryLib.Runtime --source ~/local-nuget
```

The smallest application that runs a query:

```csharp
using SparqlQueryLib.Runtime;

var library = QueryLibrary.LoadFile("my-library.bundle.json");
var query = library.Query("people-by-city");

var payload = new CallPayload()
    .With(ArgumentSet.Of("city", Term.Iri("http://example.org/city/perth")));

using var http = new HttpClient();
var endpoint = new SparqlEndpoint(http, new Uri("http://localhost:7878/query"));
using var response = await endpoint.SendAsync(query, payload);
Console.WriteLine(await response.Content.ReadAsStringAsync());
```

In an ASP.NET Core application:

- Load the bundle once at start-up, and register the `QueryLibrary` as a
  singleton. A loaded library does not change, so threads can share it.
- Get the `HttpClient` from `IHttpClientFactory`. Do not create a new
  `HttpClient` for each request.
- Pass the request's `CancellationToken` to `SendAsync`.

## 7. Give values to inputs

An input value is a `Term`:

| Value | C# | SPARQL that the library writes |
| --- | --- | --- |
| An IRI | `Term.Iri("http://example.org/city/perth")` | `<http://example.org/city/perth>`, or `ex:perth` when the bundle has a prefix for it |
| A plain string | `Term.Literal("Perth")` | `"Perth"` |
| A string in a language | `Term.Literal("Perth", lang: "en")` | `"Perth"@en` |
| A number or date | `Term.Literal("25", datatype: "http://www.w3.org/2001/XMLSchema#integer")` | `"25"^^<http://www.w3.org/2001/XMLSchema#integer>` |

Ways to fill an input:

| You want | C# |
| --- | --- |
| One value | `ArgumentSet.Of("city", Term.Iri(a))` |
| Any of several values | `ArgumentSet.Of("city", Term.Iri(a), Term.Iri(b))` |
| An input with two variables, such as `(?a ?b)` | `new ArgumentSet("a", "b").Row(("a", x), ("b", y)).Row(("a", z), ("b", w))` |
| No limit on the input | Leave it out of the payload. |
| Match nothing | `new ArgumentSet("city")`, with no rows. |
| A page of results | `.Limit("1", 25).Offset("2", 50)`. The names come from step 2 of the example output. |

The query author can mark an input as required. Then leaving it out, or
giving it no rows, raises `SlotMismatchException`. `query.InputPolicies`
shows these marks.

## 8. Handle errors

Every exception from the library derives from `SqlibRuntimeException`. The
message says what is wrong.

| Exception | Usual cause | What to do |
| --- | --- | --- |
| `InvalidBundleException` | The file is not a bundle, was edited, or has a format version this release cannot read. | Get the file again from the query author. Update the package if the message names a version. |
| `QueryCallException` | The query name is wrong. The message lists the names in the bundle. | Use a name from the list. |
| `InvalidTermException` | A value is not a valid IRI (for example, it has a space) or language tag. | Check the value before you send it, or show the message to the user. |
| `SlotMismatchException` | A variable name in the payload is wrong, or a required input has no value. | Use the input names from step 2 of the example output. |
| `InvalidParameterException` | A `LIMIT` or `OFFSET` value is negative or too large. | Pass a whole number from 0. |
| `SparqlEndpointException` | The endpoint answered with an error status. `Status` and `Body` hold its answer. | Read `Body`. It gives the reason from the endpoint. |

## 9. When you get a new bundle

1. Replace the old file with the new one.
2. Run the example with the new file, and compare the query list and inputs
   with the old list.
3. Run your tests.

A new bundle that has the same format version loads with the same package
version. When the format version goes up, update the package first.

## More detail

- [README.md](README.md): the package overview and the API.
- [docs/guides/dotnet-runtime.md](../docs/guides/dotnet-runtime.md): how the
  library is tested against the TypeScript runtime, and where the two differ.
