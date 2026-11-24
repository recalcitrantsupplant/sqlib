using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace SparqlQueryLib.Runtime;

/// <summary>How the query text goes in the POST body.</summary>
public enum SparqlPostEncoding
{
    /// <summary><c>Content-Type: application/sparql-query</c>, the text as the body. The TypeScript runtime sends this.</summary>
    Direct,

    /// <summary><c>Content-Type: application/x-www-form-urlencoded</c>, the text as <c>query=</c>.</summary>
    Form,
}

/// <summary>Options for <see cref="SparqlEndpoint"/>.</summary>
public sealed class SparqlEndpointOptions
{
    public SparqlPostEncoding Encoding { get; set; } = SparqlPostEncoding.Direct;

    /// <summary>Headers added to every request, such as an API key. A header named here replaces the default <c>Accept</c>.</summary>
    public IDictionary<string, string> Headers { get; } = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

    /// <summary>The <c>Accept</c> for CONSTRUCT and DESCRIBE. Default <c>text/turtle</c>.</summary>
    public string RdfAccept { get; set; } = "text/turtle";
}

/// <summary>
/// Sends query text to a SPARQL endpoint over HTTP POST and returns the
/// response with its body unread.
/// </summary>
/// <remarks>
/// The endpoint applies its own access control. A bundle has none: the
/// queries run with whatever rights the request carries.
/// </remarks>
public sealed class SparqlEndpoint
{
    private const string ResultsAccept = "application/sparql-results+json";
    private const int BodyExcerptLength = 2000;

    private readonly HttpClient http;
    private readonly Uri endpoint;
    private readonly SparqlEndpointOptions options;

    /// <param name="http">The client to send with. The caller owns it and sets its timeout.</param>
    /// <param name="endpoint">The query endpoint, such as <c>http://localhost:3030/ds/query</c>.</param>
    /// <param name="options">Encoding, extra headers and the RDF <c>Accept</c>.</param>
    public SparqlEndpoint(HttpClient http, Uri endpoint, SparqlEndpointOptions? options = null)
    {
        this.http = http ?? throw new ArgumentNullException(nameof(http));
        this.endpoint = endpoint ?? throw new ArgumentNullException(nameof(endpoint));
        this.options = options ?? new SparqlEndpointOptions();
    }

    /// <summary>The <c>Accept</c> the TypeScript runtime sends for a query type.</summary>
    public string DefaultAccept(string queryType) =>
        queryType is "CONSTRUCT" or "DESCRIBE" ? options.RdfAccept : ResultsAccept;

    /// <summary>
    /// POST query text. Returns the response once its headers arrive, with
    /// the body unread. The caller disposes it.
    /// </summary>
    /// <param name="queryText">The text to send, usually from <see cref="QueryHandle.Text(string)"/>.</param>
    /// <param name="accept">The <c>Accept</c> header, such as <c>text/csv</c>.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <exception cref="SparqlEndpointException">The status is outside 200 to 299.</exception>
    public async Task<HttpResponseMessage> SendAsync(string queryText, string accept, CancellationToken cancellationToken = default)
    {
        if (queryText == null) throw new ArgumentNullException(nameof(queryText));
        using var request = new HttpRequestMessage(HttpMethod.Post, endpoint);
        if (options.Encoding == SparqlPostEncoding.Form)
        {
            request.Content = new StringContent("query=" + FormEncode(queryText), System.Text.Encoding.ASCII, "application/x-www-form-urlencoded");
        }
        else
        {
            request.Content = new StringContent(queryText, System.Text.Encoding.UTF8, "application/sparql-query");
        }
        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) { ["Accept"] = accept };
        foreach (var header in options.Headers) headers[header.Key] = header.Value;
        foreach (var header in headers)
        {
            if (!request.Headers.TryAddWithoutValidation(header.Key, header.Value))
            {
                request.Content.Headers.Remove(header.Key);
                request.Content.Headers.TryAddWithoutValidation(header.Key, header.Value);
            }
        }

        var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken).ConfigureAwait(false);
        if (response.IsSuccessStatusCode) return response;

        using (response)
        {
            var body = string.Empty;
            try
            {
                body = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
            }
            catch (Exception error) when (error is HttpRequestException or IOException)
            {
                // The status is the error. An unreadable body leaves the excerpt empty.
            }
            if (body.Length > BodyExcerptLength) body = body.Substring(0, BodyExcerptLength);
            var status = (int)response.StatusCode;
            throw new SparqlEndpointException($"SPARQL endpoint returned {status} {response.ReasonPhrase}.", status, body);
        }
    }

    /// <summary>Substitute a payload into a query and POST it, with the default <c>Accept</c> for its type unless one is given.</summary>
    public Task<HttpResponseMessage> SendAsync(QueryHandle query, string payloadJson, string? accept = null, CancellationToken cancellationToken = default) =>
        SendAsync(query.Text(payloadJson), accept ?? DefaultAccept(query.QueryType), cancellationToken);

    /// <summary>Substitute a payload built in code and POST it.</summary>
    public Task<HttpResponseMessage> SendAsync(QueryHandle query, CallPayload payload, string? accept = null, CancellationToken cancellationToken = default) =>
        SendAsync(query.Text(payload), accept ?? DefaultAccept(query.QueryType), cancellationToken);

    /// <summary>
    /// POST query text and return the response body as a stream. Disposing
    /// the stream disposes the response.
    /// </summary>
    public async Task<Stream> OpenReadAsync(string queryText, string accept, CancellationToken cancellationToken = default)
    {
        var response = await SendAsync(queryText, accept, cancellationToken).ConfigureAwait(false);
        try
        {
#if NET5_0_OR_GREATER
            var body = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
#else
            var body = await response.Content.ReadAsStreamAsync().ConfigureAwait(false);
#endif
            return new ResponseStream(body, response);
        }
        catch
        {
            response.Dispose();
            throw;
        }
    }

    /// <summary>Form-encode with <c>%20</c> for a space, in chunks, so a long query does not hit an escaping limit of older frameworks.</summary>
    private static string FormEncode(string text)
    {
        const int Chunk = 30000;
        var builder = new StringBuilder(text.Length + 64);
        var at = 0;
        while (at < text.Length)
        {
            var length = Math.Min(Chunk, text.Length - at);
            if (at + length < text.Length && char.IsHighSurrogate(text[at + length - 1])) length--;
            builder.Append(Uri.EscapeDataString(text.Substring(at, length)));
            at += length;
        }
        return builder.ToString();
    }

    private sealed class ResponseStream : Stream
    {
        private readonly Stream inner;
        private readonly HttpResponseMessage response;

        public ResponseStream(Stream inner, HttpResponseMessage response)
        {
            this.inner = inner;
            this.response = response;
        }

        public override bool CanRead => inner.CanRead;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
        public override void Flush() { }
        public override int Read(byte[] buffer, int offset, int count) => inner.Read(buffer, offset, count);
        public override Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken) =>
            inner.ReadAsync(buffer, offset, count, cancellationToken);
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                inner.Dispose();
                response.Dispose();
            }
            base.Dispose(disposing);
        }
    }
}
