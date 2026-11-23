using System;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using SparqlQueryLib.Runtime.Json;
using Xunit;

namespace SparqlQueryLib.Runtime.Tests;

public class LibraryTests
{
    private static string Fixture(string name) => File.ReadAllText(Path.Combine(Goldens.RuntimeTestDirectory, "fixtures", name));

    [Fact]
    public void LoadsTheExportRouteEnvelope()
    {
        var bundle = Fixture("bundle-v2.json");
        var library = QueryLibrary.Load($"{{\"bundle\":{bundle},\"skipped\":[]}}");
        Assert.Equal("urn:sqlib:library:golden", library.LibraryId);
        Assert.Equal(2, library.Version);
        Assert.Equal(new[] { "people-by-city", "paged-things", "labels", "cities-in-region" }, library.Names);
    }

    [Fact]
    public void LoadsFromAFile()
    {
        var path = Path.Combine(Goldens.RuntimeTestDirectory, "fixtures", "bundle-v1-minimal.json");
        var library = QueryLibrary.LoadFile(path);
        Assert.Equal(1, library.Version);
        Assert.Equal("SELECT", library.Query("people").QueryType);
    }

    [Fact]
    public void ExposesTheQuerySignature()
    {
        var query = QueryLibrary.Load(Fixture("bundle-v2.json")).Query("paged-things");
        Assert.Equal(new[] { "1" }, query.LimitParameters);
        Assert.Equal(new[] { "2" }, query.OffsetParameters);
        Assert.Equal(new[] { "type" }, query.Inputs.Single());
        Assert.Equal("propagateEmpty", query.InputPolicies.Single().WhenEmpty);
        Assert.Equal(2, query.PageParameters.Count);
    }

    [Fact]
    public void ExamplesRunAsPayloads()
    {
        var library = QueryLibrary.Load(Fixture("bundle-v2.json"));
        var examples = library.Queries.SelectMany(q => q.Examples.Select(e => (q, e))).ToList();
        Assert.NotEmpty(examples);
        foreach (var (query, example) in examples) Assert.False(string.IsNullOrEmpty(query.Text(example.PayloadJson)));
    }

    [Fact]
    public void TypedPayloadMatchesTheJsonPayload()
    {
        var query = QueryLibrary.Load(Fixture("bundle-v2.json")).Query("paged-things");
        var typed = new CallPayload()
            .With(ArgumentSet.Of("type", Term.Iri("http://example.org/City"), Term.Literal("Town", lang: "en")))
            .Limit("1", 10)
            .Offset("2", 20);
        const string json = "{\"arguments\":[{\"head\":{\"vars\":[\"type\"]},\"results\":{\"bindings\":["
            + "{\"type\":{\"type\":\"uri\",\"value\":\"http://example.org/City\"}},"
            + "{\"type\":{\"type\":\"literal\",\"value\":\"Town\",\"xml:lang\":\"en\"}}]}}],"
            + "\"limits\":[{\"name\":\"1\",\"value\":10}],\"offsets\":[{\"name\":\"2\",\"value\":20}]}";
        Assert.Equal(query.Text(json), query.Text(typed));
        Assert.Contains("VALUES ?type { ex:City \"Town\"@en }", query.Text(typed));
        Assert.Contains("LIMIT 10 OFFSET 20", query.Text(typed));
    }

    [Fact]
    public void ANullCellInATypedRowIsUndef()
    {
        var query = QueryLibrary.Load(Fixture("bundle-v2.json")).Query("people-by-city");
        var payload = new CallPayload().With(new ArgumentSet("city").Row(("city", Term.Iri("http://example.org/a"))).Row(("city", null)));
        var error = Assert.Throws<SlotMismatchException>(() => query.Text(payload));
        Assert.Contains("all-UNDEF row cannot be mixed", error.Message);
    }

    [Fact]
    public void HashCheckCanBeTurnedOff()
    {
        var edited = Fixture("bundle-v2.json").Replace("?person ex:name ?name .\\n}", "?person ex:name ?name . \\n}");
        Assert.Throws<InvalidBundleException>(() => QueryLibrary.Load(edited));
        var library = QueryLibrary.Load(edited, new BundleLoadOptions { VerifyHashes = false });
        Assert.NotNull(library.Query("people-by-city"));
    }

    [Fact]
    public void RefusesAPrefixEntryThatIsNotTwoStrings()
    {
        var bundle = Fixture("bundle-v1-minimal.json").Replace("\"prefixes\": []", "\"prefixes\": [[\"ex\"]]");
        Assert.Contains("[[\"ex\"]]", bundle);
        var error = Assert.Throws<InvalidBundleException>(() => QueryLibrary.Load(bundle));
        Assert.Equal("Query 'people': template.prefixes[0] must be a [prefix, namespace] pair of strings.", error.Message);
    }

    [Fact]
    public void RefusesTextThatIsNotJson()
    {
        Assert.Throws<JsonSyntaxException>(() => QueryLibrary.Load("{\"version\":"));
        var query = QueryLibrary.Load(Fixture("bundle-v1-minimal.json")).Query("people");
        Assert.Throws<JsonSyntaxException>(() => query.Text("{arguments:[]}"));
    }

    [Fact]
    public void RefusesArgumentsThatAreNotAnArray()
    {
        var query = QueryLibrary.Load(Fixture("bundle-v1-minimal.json")).Query("people");
        var error = Assert.Throws<InvalidArgumentException>(() => query.Text("{\"arguments\":{}}"));
        Assert.Equal("arguments must be an array of SPARQL Results JSON documents.", error.Message);
    }

    [Fact]
    public void TextWithNoPayloadRunsEverySlotOpen()
    {
        var query = QueryLibrary.Load(Fixture("bundle-v1-minimal.json")).Query("people");
        Assert.Equal(query.Text("{}"), query.Text());
        Assert.DoesNotContain("VALUES", query.Text());
    }
}

public class ValuePatternTests
{
    [Theory]
    [InlineData("\\p{L}", "a Unicode property escape")]
    [InlineData("[\\p{L}]", "a Unicode property escape")]
    [InlineData("(a)\\1", "a back-reference")]
    [InlineData("(?<n>a)\\k<n>", "a back-reference")]
    [InlineData("[😀]", "outside the Basic Multilingual Plane")]
    [InlineData("[\\u{1F600}]", "outside the Basic Multilingual Plane")]
    [InlineData("[\\uD800]", "a surrogate code point")]
    [InlineData("\\uD800", "a lone surrogate")]
    [InlineData("[\\D]", "a negated class escape")]
    [InlineData("(?i:a)", "a modifier group")]
    [InlineData("(?<é>a)", "a group name")]
    public void RefusesConstructsOutsideTheSubset(string pattern, string construct)
    {
        var error = Assert.Throws<InvalidValuePatternException>(() => ValuePattern.Compile(pattern));
        Assert.Contains("which this runtime does not translate", error.Message);
        Assert.Contains(construct, error.Message);
    }

    [Fact]
    public void ABundleWithAnUnsupportedPatternIsRefusedOnLoad()
    {
        var bundle = File.ReadAllText(Path.Combine(Goldens.RuntimeTestDirectory, "fixtures", "bundle-v2.json"))
            .Replace("\"whenEmpty\": \"propagateEmpty\"", "\"whenEmpty\": \"propagateEmpty\", \"valuePattern\": \"\\\\p{L}+\"");
        Assert.Contains("\\\\p{L}+", bundle);
        var error = Assert.Throws<InvalidBundleException>(() => QueryLibrary.Load(bundle));
        Assert.StartsWith("Query 'paged-things' inputPolicies[0]: Value pattern \"\\\\p{L}+\" uses a Unicode property escape", error.Message);
    }

    [Fact]
    public void TranslatesEndOfInputAndAsciiClasses()
    {
        Assert.Equal("^\\u0061\\z", ValuePattern.Translate("^a$"));
        Assert.Equal("[\\u0030-\\u0039]", ValuePattern.Translate("\\d"));
    }

    [Fact]
    public void AMatchThatRunsTooLongTimesOut()
    {
        var regex = ValuePattern.Compile("^(?:a|aa)+(?=b)c", TimeSpan.FromMilliseconds(50));
        Assert.Throws<RegexMatchTimeoutException>(() => regex.IsMatch(new string('a', 60) + "b"));
    }
}

public class JsonTests
{
    [Theory]
    [InlineData(25.0, "25")]
    [InlineData(1.5, "1.5")]
    [InlineData(-1, "-1")]
    [InlineData(1e21, "1e+21")]
    [InlineData(1e-7, "1e-7")]
    [InlineData(123456.789, "123456.789")]
    [InlineData(9007199254740992, "9007199254740992")]
    [InlineData(0.000001, "0.000001")]
    [InlineData(1.2345e-10, "1.2345e-10")]
    [InlineData(5e-324, "5e-324")]
    [InlineData(1.7976931348623157e308, "1.7976931348623157e+308")]
    [InlineData(100, "100")]
    [InlineData(1e20, "100000000000000000000")]
    public void WritesNumbersAsJavaScriptDoes(double value, string expected) => Assert.Equal(expected, Js.NumberToString(value));

    [Fact]
    public void OrdersIndexKeysFirst()
    {
        var value = JsonText.Parse("{\"b\":1,\"2\":2,\"a\":3,\"1\":4,\"01\":5,\"b\":6}");
        Assert.Equal(new[] { "1", "2", "b", "a", "01" }, value.Entries().Select(e => e.Key));
        Assert.Equal(6, value["b"].Number);
    }

    [Fact]
    public void KeepsALoneSurrogate()
    {
        var value = JsonText.Parse("\"\\ud800x\"");
        Assert.Equal("\ud800x", value.Str);
        Assert.Equal("\"\\ud800x\"", Js.Quote(value.Str!));
    }

    [Fact]
    public void CompareReportsADifference()
    {
        var expect = JsonText.Parse("{\"text\":\"a\"}");
        Assert.NotNull(Goldens.Compare(expect, () => "b", text =>
        {
            var obj = new JsObject();
            obj.Set("text", JsValue.FromString(text));
            return JsValue.FromObject(obj);
        }));
    }
}
