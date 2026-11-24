// QuickStart: load a sqlib bundle, fill in query parameters, and
// optionally send a query to a SPARQL endpoint.
//
// Run from this folder:
//   dotnet run                                    uses sample.bundle.json
//   dotnet run -- my-library.bundle.json          uses your bundle
//   dotnet run -- sample.bundle.json https://example.org/ds/query
//                                                 also sends one query
//
// dotnet/GETTING-STARTED.md explains each step.

using SparqlQueryLib.Runtime;

var bundlePath = args.Length > 0 ? args[0] : Path.Combine(AppContext.BaseDirectory, "sample.bundle.json");
var endpointUrl = args.Length > 1 ? args[1] : null;

// Step 1. Load the bundle. Loading checks the structure of the file and the
// hash of each query text, so a damaged or edited file fails here.
var library = QueryLibrary.LoadFile(bundlePath);
Console.WriteLine($"Loaded {bundlePath}");
Console.WriteLine($"Bundle format version {library.Version}, {library.Queries.Count} queries.");
Console.WriteLine();

// Step 2. List the queries and the parameters each one takes.
foreach (var q in library.Queries)
{
    var inputs = q.Inputs.Count == 0 ? "none" : string.Join(", ", q.Inputs.Select(vars => "?" + string.Join(" ?", vars)));
    Console.WriteLine($"  {q.Name} ({q.QueryType})");
    Console.WriteLine($"    inputs:  {inputs}");
    if (q.LimitParameters.Count > 0) Console.WriteLine($"    limits:  {string.Join(", ", q.LimitParameters)}");
    if (q.OffsetParameters.Count > 0) Console.WriteLine($"    offsets: {string.Join(", ", q.OffsetParameters)}");
}
Console.WriteLine();

// The remaining steps use the queries of sample.bundle.json. With your own
// bundle, change the query names and the variable names.
if (!library.TryGetQuery("people-by-city", out var peopleByCity))
{
    Console.WriteLine("This bundle has no query 'people-by-city'. Steps 3 to 7 use the sample bundle.");
    return 0;
}

// Step 3. Fill in a parameter with the typed payload classes.
// people-by-city has one input, ?city. Give it one value: an IRI.
var perth = new CallPayload()
    .With(ArgumentSet.Of("city", Term.Iri("http://example.org/city/perth")));
Print("Step 3: people-by-city, one city", peopleByCity.Text(perth));

// Step 4. The same call, with the payload as JSON. This is the format that
// sqlib uses for arguments: a SPARQL results document per input.
var perthJson = """
{
  "arguments": [
    {
      "head": { "vars": ["city"] },
      "results": { "bindings": [
        { "city": { "type": "uri", "value": "http://example.org/city/perth" } }
      ] }
    }
  ]
}
""";
Print("Step 4: the same call as JSON", peopleByCity.Text(perthJson));

// Step 5. More than one value, and page parameters.
// paged-things has the input ?type, a LIMIT named "1" and an OFFSET named "2".
var pagedThings = library.Query("paged-things");
var page = new CallPayload()
    .With(ArgumentSet.Of("type", Term.Iri("http://example.org/City"), Term.Literal("Town", lang: "en")))
    .Limit("1", 10)
    .Offset("2", 20);
Print("Step 5: paged-things, two values, page 3 of 10 rows", pagedThings.Text(page));

// Step 6. A bad value is refused before anything is sent.
// A space is not allowed in an IRI.
try
{
    peopleByCity.Text(new CallPayload().With(ArgumentSet.Of("city", Term.Iri("http://example.org/city/perth wa"))));
}
catch (SqlibRuntimeException error)
{
    Console.WriteLine("Step 6: a bad value");
    Console.WriteLine($"  {error.GetType().Name}: {error.Message}");
    Console.WriteLine();
}

// Step 7. Run the test cases that the bundle carries for each query.
Console.WriteLine("Step 7: the examples in the bundle");
foreach (var q in library.Queries)
{
    foreach (var example in q.Examples)
    {
        var text = q.Text(example.PayloadJson);
        Console.WriteLine($"  {q.Name} / {example.Name}: {text.Length} characters of query text");
    }
}
Console.WriteLine();

// Step 8. Send a query to a SPARQL endpoint. Only when you give a URL.
if (endpointUrl == null)
{
    Console.WriteLine("Step 8: skipped. Give an endpoint URL as the second argument to send a query.");
    return 0;
}

using var http = new HttpClient();
var endpoint = new SparqlEndpoint(http, new Uri(endpointUrl));
try
{
    using var response = await endpoint.SendAsync(peopleByCity, perth);
    Console.WriteLine($"Step 8: {endpointUrl} answered {(int)response.StatusCode}");
    Console.WriteLine(await response.Content.ReadAsStringAsync());
}
catch (SparqlEndpointException error)
{
    Console.WriteLine($"Step 8: the endpoint refused the query with status {error.Status}.");
    Console.WriteLine(error.Body);
    return 1;
}
return 0;

static void Print(string title, string queryText)
{
    Console.WriteLine(title);
    foreach (var line in queryText.Split('\n')) Console.WriteLine("  " + line);
    Console.WriteLine();
}
