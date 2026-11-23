using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Xunit;

namespace SparqlQueryLib.Runtime.Tests;

public class SparqlEndpointTests
{
    private sealed class RecordingHandler : HttpMessageHandler
    {
        private readonly HttpStatusCode status;
        private readonly string body;

        public RecordingHandler(HttpStatusCode status, string body)
        {
            this.status = status;
            this.body = body;
        }

        public List<(HttpRequestMessage Request, string Body)> Seen { get; } = new();
        public bool ResponseDisposed => response?.Content is TrackingContent { Disposed: true };
        private HttpResponseMessage? response;

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Seen.Add((request, await request.Content!.ReadAsStringAsync(cancellationToken)));
            response = new HttpResponseMessage(status) { Content = new TrackingContent(body), ReasonPhrase = status.ToString() };
            return response;
        }
    }

    private sealed class TrackingContent : StringContent
    {
        public TrackingContent(string body) : base(body, Encoding.UTF8, "text/csv") { }
        public bool Disposed { get; private set; }

        protected override void Dispose(bool disposing)
        {
            Disposed = true;
            base.Dispose(disposing);
        }
    }

    private static QueryHandle People() =>
        QueryLibrary.LoadFile(Path.Combine(Goldens.RuntimeTestDirectory, "fixtures", "bundle-v2.json")).Query("people-by-city");

    [Fact]
    public async Task PostsTheQueryTextWithTheDefaultAccept()
    {
        var handler = new RecordingHandler(HttpStatusCode.OK, "{}");
        var endpoint = new SparqlEndpoint(new HttpClient(handler), new Uri("http://localhost/ds/query"));
        using var response = await endpoint.SendAsync(People(), "{}");
        var (request, body) = handler.Seen.Single();
        Assert.Equal(HttpMethod.Post, request.Method);
        Assert.Equal("application/sparql-query", request.Content!.Headers.ContentType!.MediaType);
        Assert.Equal("application/sparql-results+json", request.Headers.Accept.Single().MediaType);
        Assert.Equal(People().Text(), body);
    }

    [Fact]
    public async Task SendsAFormWithACallerAcceptAndHeaders()
    {
        var handler = new RecordingHandler(HttpStatusCode.OK, "a,b\n");
        var options = new SparqlEndpointOptions { Encoding = SparqlPostEncoding.Form };
        options.Headers["Authorization"] = "Bearer t";
        var endpoint = new SparqlEndpoint(new HttpClient(handler), new Uri("http://localhost/ds/query"), options);
        var query = People();
        using var stream = await endpoint.OpenReadAsync(query.Text(), "text/csv");
        using var reader = new StreamReader(stream);
        Assert.Equal("a,b\n", await reader.ReadToEndAsync());
        var (request, body) = handler.Seen.Single();
        Assert.Equal("application/x-www-form-urlencoded", request.Content!.Headers.ContentType!.MediaType);
        Assert.Equal("text/csv", request.Headers.Accept.Single().MediaType);
        Assert.Equal("Bearer t", request.Headers.Authorization!.ToString());
        Assert.Equal("query=" + Uri.EscapeDataString(query.Text()), body);
    }

    [Fact]
    public async Task DisposingTheStreamDisposesTheResponse()
    {
        var handler = new RecordingHandler(HttpStatusCode.OK, "x");
        var endpoint = new SparqlEndpoint(new HttpClient(handler), new Uri("http://localhost/q"));
        var stream = await endpoint.OpenReadAsync("ASK {}", "text/csv");
        Assert.False(handler.ResponseDisposed);
        stream.Dispose();
        Assert.True(handler.ResponseDisposed);
    }

    [Fact]
    public async Task AFailedStatusRaisesWithABodyExcerpt()
    {
        var handler = new RecordingHandler(HttpStatusCode.BadRequest, new string('e', 3000));
        var endpoint = new SparqlEndpoint(new HttpClient(handler), new Uri("http://localhost/q"));
        var error = await Assert.ThrowsAsync<SparqlEndpointException>(() => endpoint.SendAsync("SELECT * {}", "text/csv"));
        Assert.Equal(400, error.Status);
        Assert.Equal(2000, error.Body.Length);
        Assert.Equal("SPARQL endpoint returned 400 BadRequest.", error.Message);
        Assert.True(handler.ResponseDisposed);
    }

    [Fact]
    public void ConstructAndDescribeAskForTurtle()
    {
        var endpoint = new SparqlEndpoint(new HttpClient(), new Uri("http://localhost/q"));
        Assert.Equal("text/turtle", endpoint.DefaultAccept("CONSTRUCT"));
        Assert.Equal("text/turtle", endpoint.DefaultAccept("DESCRIBE"));
        Assert.Equal("application/sparql-results+json", endpoint.DefaultAccept("ASK"));
    }

    [Fact]
    public async Task EncodesALongQueryInChunks()
    {
        var query = "SELECT * { ?s ?p \"" + string.Concat(Enumerable.Repeat("😀 a&b=c", 20000)) + "\" }";
        var handler = new RecordingHandler(HttpStatusCode.OK, "");
        var endpoint = new SparqlEndpoint(new HttpClient(handler), new Uri("http://localhost/q"), new SparqlEndpointOptions { Encoding = SparqlPostEncoding.Form });
        (await endpoint.SendAsync(query, "text/csv")).Dispose();
        Assert.Equal("query=" + Uri.EscapeDataString(query), handler.Seen.Single().Body);
    }
}
