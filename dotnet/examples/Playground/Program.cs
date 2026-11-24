// Playground: a web page on top of SparqlQueryLib.Runtime.
// Pick a query, fill in its inputs, see the query text that the library
// writes, and send it to a SPARQL endpoint. Every call is logged on the page
// and on the console.
//
// Settings (environment variables):
//   BUNDLE     the bundle file to load at start (default: sample.bundle.json)
//   ENDPOINT   the default SPARQL query URL (default: http://localhost:7878/query)
//   SEED_STORE a Graph Store URL. When set, sample-data.ttl is loaded into
//              its default graph at start, for the sample bundle.

using System.Diagnostics;
using System.Text;
using System.Text.Json;
using SparqlQueryLib.Runtime;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddHttpClient();
var app = builder.Build();

var bundlePath = Environment.GetEnvironmentVariable("BUNDLE") ?? Path.Combine(AppContext.BaseDirectory, "sample.bundle.json");
var defaultEndpoint = Environment.GetEnvironmentVariable("ENDPOINT") ?? "http://localhost:7878/query";
var state = new PlaygroundState(QueryLibrary.LoadFile(bundlePath), Path.GetFileName(bundlePath));
Console.WriteLine($"Loaded {bundlePath}: {state.Library.Queries.Count} queries");

var seedStore = Environment.GetEnvironmentVariable("SEED_STORE");
if (!string.IsNullOrEmpty(seedStore)) _ = SeedAsync(seedStore, app.Services.GetRequiredService<IHttpClientFactory>());

app.UseDefaultFiles();
app.UseStaticFiles();

app.MapGet("/api/library", () => Results.Json(new
{
    source = state.Source,
    version = state.Library.Version,
    endpoint = defaultEndpoint,
    queries = state.Library.Queries.Select(q => new
    {
        name = q.Name,
        queryType = q.QueryType,
        description = q.Description,
        template = q.Template.Text,
        inputs = q.Inputs,
        policies = q.InputPolicies.Select(p => new { vars = p.Vars, whenEmpty = p.WhenEmpty, valuePattern = p.ValuePattern }),
        limits = q.LimitParameters,
        offsets = q.OffsetParameters,
        examples = q.Examples.Select(e => new { name = e.Name, payload = e.PayloadJson }),
    }),
}));

// Replace the loaded bundle with one sent by the page.
app.MapPost("/api/library", async (HttpRequest request) =>
{
    var log = new List<string>();
    var name = request.Query["name"].ToString();
    using var reader = new StreamReader(request.Body, Encoding.UTF8);
    var json = await reader.ReadToEndAsync();
    log.Add($"QueryLibrary.Load({json.Length} characters from {(name.Length > 0 ? name : "upload")})");
    try
    {
        var library = QueryLibrary.Load(json);
        state = new PlaygroundState(library, name.Length > 0 ? name : "upload");
        log.Add($"Loaded: format version {library.Version}, {library.Queries.Count} queries: {string.Join(", ", library.Names)}");
        Console.WriteLine(string.Join("\n", log));
        return Results.Json(new { log });
    }
    catch (SqlibRuntimeException error)
    {
        log.Add($"{error.GetType().Name}: {error.Message}");
        Console.WriteLine(string.Join("\n", log));
        return Results.Json(new { log, error = Describe(error) });
    }
});

// Fill in a query, and send it when an endpoint is given.
app.MapPost("/api/call", async (CallRequest call, IHttpClientFactory httpFactory, CancellationToken ct) =>
{
    var log = new List<string>();
    if (!state.Library.TryGetQuery(call.Query, out var query))
    {
        return Results.Json(new { log, error = new { type = "QueryCallException", message = $"No query named '{call.Query}'." } });
    }

    log.Add($"library.Query(\"{query.Name}\")");
    log.Add($"payload: {Compact(call.Payload)}");
    string text;
    var timer = Stopwatch.StartNew();
    try
    {
        text = query.Text(call.Payload);
    }
    catch (Exception error) when (error is SqlibRuntimeException or SparqlQueryLib.Runtime.Json.JsonSyntaxException)
    {
        log.Add($"query.Text(payload) refused after {timer.Elapsed.TotalMilliseconds:0.0} ms");
        log.Add($"{error.GetType().Name}: {error.Message}");
        Console.WriteLine(string.Join("\n", log));
        return Results.Json(new { log, error = Describe(error) });
    }
    log.Add($"query.Text(payload) gave {text.Length} characters in {timer.Elapsed.TotalMilliseconds:0.0} ms");

    if (string.IsNullOrWhiteSpace(call.Endpoint))
    {
        Console.WriteLine(string.Join("\n", log));
        return Results.Json(new { log, text });
    }

    var endpoint = new SparqlEndpoint(httpFactory.CreateClient(), new Uri(call.Endpoint));
    var accept = endpoint.DefaultAccept(query.QueryType);
    log.Add($"POST {call.Endpoint} (Content-Type: application/sparql-query, Accept: {accept})");
    timer.Restart();
    try
    {
        using var response = await endpoint.SendAsync(text, accept, ct);
        var body = await response.Content.ReadAsStringAsync(ct);
        log.Add($"{(int)response.StatusCode} {response.ReasonPhrase}, {response.Content.Headers.ContentType}, {body.Length} characters in {timer.Elapsed.TotalMilliseconds:0} ms");
        Console.WriteLine(string.Join("\n", log));
        return Results.Json(new { log, text, status = (int)response.StatusCode, contentType = response.Content.Headers.ContentType?.MediaType, body });
    }
    catch (SparqlEndpointException error)
    {
        log.Add($"SparqlEndpointException: {error.Message}");
        Console.WriteLine(string.Join("\n", log));
        return Results.Json(new { log, text, error = Describe(error), status = error.Status, body = error.Body });
    }
    catch (HttpRequestException error)
    {
        log.Add($"HttpRequestException: {error.Message}");
        Console.WriteLine(string.Join("\n", log));
        return Results.Json(new { log, text, error = new { type = "HttpRequestException", message = error.Message } });
    }
});

app.Run();

// The payload on one line for the log. Text that is not JSON is logged as sent.
static string Compact(string payload)
{
    try
    {
        using var document = JsonDocument.Parse(payload);
        return JsonSerializer.Serialize(document.RootElement);
    }
    catch (JsonException)
    {
        return payload;
    }
}

static object Describe(Exception error) => new
{
    type = error.GetType().Name,
    typeScriptName = (error as SqlibRuntimeException)?.TypeScriptName,
    message = error.Message,
};

static async Task SeedAsync(string store, IHttpClientFactory factory)
{
    var data = await File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory, "sample-data.ttl"));
    var http = factory.CreateClient();
    for (var attempt = 1; attempt <= 30; attempt++)
    {
        try
        {
            using var content = new StringContent(data, Encoding.UTF8, "text/turtle");
            using var response = await http.PutAsync(store + "?default", content);
            Console.WriteLine($"Loaded sample-data.ttl into {store}: {(int)response.StatusCode}");
            return;
        }
        catch (HttpRequestException)
        {
            await Task.Delay(1000);
        }
    }
    Console.WriteLine($"Could not reach {store} to load sample-data.ttl.");
}

internal sealed record PlaygroundState(QueryLibrary Library, string Source);

internal sealed record CallRequest(string Query, string Payload, string? Endpoint);
