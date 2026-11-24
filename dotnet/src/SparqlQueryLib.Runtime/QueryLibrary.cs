using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using SparqlQueryLib.Runtime.Json;

namespace SparqlQueryLib.Runtime;

/// <summary>Options for <see cref="QueryLibrary.Load(string, BundleLoadOptions?)"/>.</summary>
public sealed class BundleLoadOptions
{
    /// <summary>
    /// Check every <c>textHash</c> on load. Default true. A hand-edited text
    /// moves the slot spans, and the splice then writes into the wrong place.
    /// </summary>
    public bool VerifyHashes { get; set; } = true;

    /// <summary>
    /// The longest time one value pattern match may take. Default 1 second. A
    /// match that takes longer raises <see cref="RegexMatchTimeoutException"/>.
    /// The TypeScript runtime has no limit. Set
    /// <see cref="Regex.InfiniteMatchTimeout"/> to match it.
    /// </summary>
    public TimeSpan ValuePatternTimeout { get; set; } = TimeSpan.FromSeconds(1);
}

/// <summary>A <c>LIMIT</c> or <c>OFFSET</c> placeholder, located in the template text.</summary>
public sealed class PageParameterSpan
{
    internal PageParameterSpan(string name, string kind, int start, int end)
    {
        Name = name;
        Kind = kind;
        Start = start;
        End = end;
    }

    /// <summary>The name a payload's <c>limits</c> or <c>offsets</c> uses.</summary>
    public string Name { get; }

    /// <summary><c>limit</c> or <c>offset</c>.</summary>
    public string Kind { get; }

    /// <summary>The span covers the whole clause, keyword included.</summary>
    public int Start { get; }

    public int End { get; }
}

/// <summary>A runnable payload that the export copied from one of the library's tests.</summary>
public sealed class QueryExample
{
    internal QueryExample(string name, string payloadJson, string? expected, string? expectedFormat, bool dataDependent)
    {
        Name = name;
        PayloadJson = payloadJson;
        Expected = expected;
        ExpectedFormat = expectedFormat;
        DataDependent = dataDependent;
    }

    public string Name { get; }

    /// <summary>The example as a payload: <c>arguments</c>, and <c>limits</c> and <c>offsets</c> when it has them.</summary>
    public string PayloadJson { get; }

    /// <summary>The test's recorded answer, when the bundle was exported with it. Reference only.</summary>
    public string? Expected { get; }

    public string? ExpectedFormat { get; }

    /// <summary>True when the source test seeded its own data, so <see cref="Expected"/> does not apply to other data.</summary>
    public bool DataDependent { get; }
}

/// <summary>
/// A loaded export bundle. Port of <c>fromBundle</c> and <c>QueryLibrary</c>
/// in <c>@sparql-query-lib/runtime</c>.
/// </summary>
public sealed class QueryLibrary
{
    private readonly Dictionary<string, QueryHandle> handles;

    private QueryLibrary(string libraryId, string? libraryName, int version, List<QueryHandle> queries)
    {
        LibraryId = libraryId;
        LibraryName = libraryName;
        Version = version;
        Queries = queries;
        handles = new Dictionary<string, QueryHandle>(StringComparer.Ordinal);
        foreach (var query in queries) handles[query.Name] = query;
    }

    /// <summary>The bundle format versions this library reads.</summary>
    public static IReadOnlyList<int> ReadableVersions { get; } = new[] { 1, 2 };

    public string LibraryId { get; }
    public string? LibraryName { get; }

    /// <summary>The bundle format version, 1 or 2.</summary>
    public int Version { get; }

    /// <summary>The queries, in bundle order.</summary>
    public IReadOnlyList<QueryHandle> Queries { get; }

    /// <summary>Every query name, in bundle order.</summary>
    public IReadOnlyList<string> Names => Queries.Select(q => q.Name).ToList();

    /// <summary>
    /// Load a bundle from JSON text. Accepts a bare bundle, or the
    /// <c>{ "bundle": ..., "skipped": ... }</c> answer of the export route.
    /// </summary>
    /// <exception cref="JsonSyntaxException">The text is not JSON.</exception>
    /// <exception cref="InvalidBundleException">The bundle is malformed, edited, or of another format version.</exception>
    public static QueryLibrary Load(string json, BundleLoadOptions? options = null)
    {
        if (json == null) throw new ArgumentNullException(nameof(json));
        options ??= new BundleLoadOptions();
        var root = JsonText.Parse(json);
        if (root.Kind == JsKind.Object && root["version"].IsUndefined && root["bundle"].IsObjectLike) root = root["bundle"];

        BundleValidation.AssertValidBundle(root);
        if (options.VerifyHashes) BundleValidation.VerifyIntegrity(root);

        var queries = new List<QueryHandle>();
        foreach (var entry in root["queries"].Entries())
        {
            queries.Add(QueryHandle.FromJs(entry.Key, entry.Value, options.ValuePatternTimeout));
        }
        var library = root["library"];
        var name = library["name"];
        return new QueryLibrary(library["id"].Str!, name.IsString ? name.Str : null, (int)root["version"].Number, queries);
    }

    /// <summary>Load a bundle from a UTF-8 stream.</summary>
    public static QueryLibrary Load(Stream utf8Json, BundleLoadOptions? options = null)
    {
        using var reader = new StreamReader(utf8Json, new UTF8Encoding(false), detectEncodingFromByteOrderMarks: false);
        return Load(reader.ReadToEnd(), options);
    }

    /// <summary>Load a bundle from a UTF-8 file.</summary>
    public static QueryLibrary LoadFile(string path, BundleLoadOptions? options = null)
    {
        using var stream = File.OpenRead(path);
        return Load(stream, options);
    }

    /// <summary>Look up a query by name.</summary>
    /// <exception cref="QueryCallException">The bundle carries no query of that name.</exception>
    public QueryHandle Query(string name)
    {
        if (handles.TryGetValue(name, out var handle)) return handle;
        var available = Queries.Count > 0 ? string.Join(", ", Names) : "(none)";
        throw new QueryCallException($"Bundle has no query named '{name}'. Available: {available}.");
    }

    public bool TryGetQuery(string name, out QueryHandle query) => handles.TryGetValue(name, out query!);
}

/// <summary>One exported query. <see cref="Text(string)"/> is the port of <c>QueryHandle.text</c>.</summary>
public sealed class QueryHandle
{
    private readonly TimeSpan patternTimeout;

    private QueryHandle(
        string name,
        string queryType,
        QueryTemplate template,
        IReadOnlyList<PageParameterSpan> pageParameters,
        IReadOnlyList<SlotPolicy> inputPolicies,
        IReadOnlyList<IReadOnlyList<string>> inputs,
        IReadOnlyList<string> limitParameters,
        IReadOnlyList<string> offsetParameters,
        IReadOnlyList<QueryExample> examples,
        IReadOnlyList<string> tags,
        string? description,
        TimeSpan patternTimeout)
    {
        Name = name;
        QueryType = queryType;
        Template = template;
        PageParameters = pageParameters;
        InputPolicies = inputPolicies;
        Inputs = inputs;
        LimitParameters = limitParameters;
        OffsetParameters = offsetParameters;
        Examples = examples;
        Tags = tags;
        Description = description;
        this.patternTimeout = patternTimeout;
    }

    public string Name { get; }

    /// <summary><c>SELECT</c>, <c>ASK</c>, <c>CONSTRUCT</c> or <c>DESCRIBE</c>.</summary>
    public string QueryType { get; }

    public QueryTemplate Template { get; }
    public IReadOnlyList<PageParameterSpan> PageParameters { get; }
    public IReadOnlyList<SlotPolicy> InputPolicies { get; }

    /// <summary>The declared variables of each slot, in slot order, each sorted.</summary>
    public IReadOnlyList<IReadOnlyList<string>> Inputs { get; }

    public IReadOnlyList<string> LimitParameters { get; }
    public IReadOnlyList<string> OffsetParameters { get; }
    public IReadOnlyList<QueryExample> Examples { get; }
    public IReadOnlyList<string> Tags { get; }
    public string? Description { get; }

    private static List<string> Strings(JsValue value) =>
        value.IsArray ? value.Items!.Where(v => v.IsString).Select(v => v.Str!).ToList() : new List<string>();

    internal static QueryHandle FromJs(string name, JsValue query, TimeSpan patternTimeout)
    {
        var where = $"Query '{name}'";
        var template = query["template"];
        var prefixes = new List<KeyValuePair<string, string>>();
        var prefixItems = template["prefixes"].Items!;
        for (var i = 0; i < prefixItems.Count; i++)
        {
            var pair = prefixItems[i];
            if (!pair.IsArray || !pair["0"].IsString || !pair["1"].IsString)
            {
                throw new InvalidBundleException($"{where}: template.prefixes[{i}] must be a [prefix, namespace] pair of strings.");
            }
            prefixes.Add(new KeyValuePair<string, string>(pair["0"].Str!, pair["1"].Str!));
        }
        var slots = template["slots"].Items!
            .Select(slot => new TemplateSlot((int)slot["start"].Number, (int)slot["end"].Number, slot["vars"].Items!.Select(Js.ToJsString).ToList()))
            .ToList();
        var compiled = new QueryTemplate(template["text"].Str!, slots, prefixes);

        var spans = new List<PageParameterSpan>();
        if (query["pageParameters"].IsArray)
        {
            foreach (var span in query["pageParameters"].Items!)
            {
                spans.Add(new PageParameterSpan(Js.ToJsString(span["name"]), span["kind"].Str!, (int)span["start"].Number, (int)span["end"].Number));
            }
        }

        var policies = new List<SlotPolicy>();
        if (query["inputPolicies"].IsArray)
        {
            foreach (var policy in query["inputPolicies"].Items!)
            {
                var whenEmpty = policy["whenEmpty"];
                var pattern = policy["valuePattern"];
                policies.Add(new SlotPolicy(
                    policy["vars"].Items!.Select(v => v.Str!).ToList(),
                    whenEmpty.IsString ? whenEmpty.Str : null,
                    pattern.IsString ? pattern.Str : null));
            }
        }

        var examples = new List<QueryExample>();
        if (query["examples"].IsArray)
        {
            foreach (var example in query["examples"].Items!)
            {
                var payload = new JsObject();
                payload.Set("arguments", example["arguments"]);
                if (!example["limits"].IsUndefined) payload.Set("limits", example["limits"]);
                if (!example["offsets"].IsUndefined) payload.Set("offsets", example["offsets"]);
                examples.Add(new QueryExample(
                    example["name"].Str!,
                    Js.Stringify(JsValue.FromObject(payload))!,
                    example["expected"].IsString ? example["expected"].Str : null,
                    example["expectedFormat"].IsString ? example["expectedFormat"].Str : null,
                    example["dataDependent"].Kind == JsKind.Boolean && example["dataDependent"].Bool));
            }
        }

        var inputs = query["inferredInputs"].Items!.Select(item => (IReadOnlyList<string>)Strings(item)).ToList();
        var description = query["description"];
        return new QueryHandle(
            name,
            query["queryType"].Str!,
            compiled,
            spans,
            policies,
            inputs,
            Strings(query["limitParameters"]),
            Strings(query["offsetParameters"]),
            examples,
            Strings(query["tags"]),
            description.IsString ? description.Str : null,
            patternTimeout);
    }

    /// <summary>The query text with no arguments: every slot runs by its empty-input rule.</summary>
    public string Text() => Text(JsValue.FromObject(new JsObject()));

    /// <summary>
    /// Substitute a payload and return the query text. The payload is the JSON
    /// that <c>QueryHandle.text</c> takes in the TypeScript runtime.
    /// </summary>
    /// <exception cref="JsonSyntaxException">The payload is not JSON.</exception>
    /// <exception cref="SqlibRuntimeException">The payload does not fit the query.</exception>
    public string Text(string payloadJson) => Text(JsonText.Parse(payloadJson ?? throw new ArgumentNullException(nameof(payloadJson))));

    /// <summary>Substitute a payload built in code.</summary>
    public string Text(CallPayload payload) => Text((payload ?? throw new ArgumentNullException(nameof(payload))).ToJs());

    internal string Text(JsValue payload)
    {
        var inputs = payload["arguments"];
        List<JsValue> argumentInputs;
        if (inputs.IsNullish) argumentInputs = new List<JsValue>();
        else if (inputs.IsArray) argumentInputs = inputs.Items!;
        else throw new InvalidArgumentException("arguments must be an array of SPARQL Results JSON documents.");

        var wire = ToWireArgumentSets(argumentInputs);
        var argumentSets = Arguments.Normalize(wire);
        var limits = ToExecutionParameters(payload["limits"]);
        var offsets = ToExecutionParameters(payload["offsets"]);
        var template = WithPageParameters(limits, offsets);
        return Substitution.Apply(template, argumentSets, InputPolicies, patternTimeout);
    }

    /// <summary>The short form <c>{ "bindings": [...] }</c> takes its variables from the slot at the same position.</summary>
    private List<JsValue> ToWireArgumentSets(List<JsValue> inputs)
    {
        var result = new List<JsValue>(inputs.Count);
        for (var index = 0; index < inputs.Count; index++)
        {
            var input = inputs[index];
            if (!input["bindings"].IsArray)
            {
                result.Add(input);
                continue;
            }
            if (index >= Template.Slots.Count)
            {
                throw new QueryCallException(
                    $"Received {inputs.Count} argument sets but the query has {Template.Slots.Count} parameter slots.");
            }
            var head = new JsObject();
            head.Set("vars", JsValue.FromArray(Template.Slots[index].Vars.Select(JsValue.FromString).ToList()));
            var results = new JsObject();
            results.Set("bindings", JsValue.FromArray(input["bindings"].Items!.ToList()));
            var wire = new JsObject();
            wire.Set("head", JsValue.FromObject(head));
            wire.Set("results", JsValue.FromObject(results));
            result.Add(JsValue.FromObject(wire));
        }
        return result;
    }

    /// <summary>An array of <c>{ name, value }</c>, or a <c>{ name: value }</c> map.</summary>
    private static List<(string Name, JsValue Value)> ToExecutionParameters(JsValue parameters)
    {
        var result = new List<(string, JsValue)>();
        if (!parameters.Truthy) return result;
        if (parameters.IsArray)
        {
            foreach (var item in parameters.Items!) result.Add((Js.ToJsString(item["name"]), item["value"]));
            return result;
        }
        foreach (var entry in parameters.Entries()) result.Add((entry.Key, entry.Value));
        return result;
    }

    /// <summary>
    /// Splice page parameters first, then move each slot span by the length
    /// change before it. Port of <c>withPageParameters</c>.
    /// </summary>
    private QueryTemplate WithPageParameters(List<(string Name, JsValue Value)> limits, List<(string Name, JsValue Value)> offsets)
    {
        var supplied = new Dictionary<string, JsValue>(StringComparer.Ordinal);
        foreach (var (name, value) in limits) supplied["limit:" + name] = value;
        foreach (var (name, value) in offsets) supplied["offset:" + name] = value;
        if (supplied.Count == 0 || PageParameters.Count == 0) return Template;

        var edits = PageParameters
            .Where(span => supplied.ContainsKey(span.Kind + ":" + span.Name))
            .OrderBy(span => span.Start)
            .Select(span =>
            {
                var value = supplied[span.Kind + ":" + span.Name];
                var number = PageParameterValue(span.Kind, span.Name, value);
                return (Span: span, Replacement: (span.Kind == "limit" ? "LIMIT " : "OFFSET ") + number);
            })
            .ToList();
        if (edits.Count == 0) return Template;

        var text = new StringBuilder(Template.Text.Length + 16);
        var cursor = 0;
        var delta = 0;
        var shifts = new List<(int Before, int Delta)>();
        foreach (var (span, replacement) in edits)
        {
            text.Append(Template.Text, cursor, span.Start - cursor).Append(replacement);
            delta += replacement.Length - (span.End - span.Start);
            shifts.Add((span.End, delta));
            cursor = span.End;
        }
        text.Append(Template.Text, cursor, Template.Text.Length - cursor);

        int Shift(int position)
        {
            var applied = 0;
            foreach (var (before, cumulative) in shifts)
            {
                if (before <= position) applied = cumulative;
            }
            return position + applied;
        }

        var slots = Template.Slots.Select(slot => new TemplateSlot(Shift(slot.Start), Shift(slot.End), slot.Vars)).ToList();
        return new QueryTemplate(text.ToString(), slots, Template.Prefixes);
    }

    private const double MaxSafeInteger = 9007199254740991;

    /// <summary>Port of <c>assertPageParameterValue</c>. Returns the value as JavaScript writes it.</summary>
    private static string PageParameterValue(string kind, string name, JsValue value)
    {
        if (!value.IsNumber)
        {
            throw new InvalidParameterException($"Invalid {kind} parameter: name must be string, value must be number.");
        }
        var number = value.Number;
        if (!value.IsInteger || Math.Abs(number) > MaxSafeInteger || number < 0)
        {
            throw new InvalidParameterException(
                $"Invalid {kind} value for '{name}': expected a non-negative integer, received {Js.NumberToString(number)}.");
        }
        return Js.NumberToString(number);
    }
}
