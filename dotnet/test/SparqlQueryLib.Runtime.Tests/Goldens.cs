using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using SparqlQueryLib.Runtime.Json;

namespace SparqlQueryLib.Runtime.Tests;

/// <summary>
/// The golden cases that <c>packages/runtime/test/conformance.test.ts</c>
/// writes from the TypeScript runtime.
/// </summary>
internal static class Goldens
{
    private static readonly Lazy<JsValue> Document = new(() => JsonText.Parse(File.ReadAllText(Path.Combine(RuntimeTestDirectory, "conformance", "goldens.json"))));

    /// <summary><c>packages/runtime/test</c>, found by walking up from the test assembly.</summary>
    public static string RuntimeTestDirectory
    {
        get
        {
            var directory = new DirectoryInfo(AppContext.BaseDirectory);
            while (directory != null)
            {
                var candidate = Path.Combine(directory.FullName, "packages", "runtime", "test");
                if (Directory.Exists(candidate)) return candidate;
                directory = directory.Parent;
            }
            throw new DirectoryNotFoundException("packages/runtime/test was not found above the test assembly.");
        }
    }

    public static JsValue Root => Document.Value;

    public static string BundleText(string id)
    {
        var source = Root["bundles"][id];
        if (source["fixture"].IsString) return File.ReadAllText(Path.Combine(RuntimeTestDirectory, "fixtures", source["fixture"].Str!));
        return source["json"].Str!;
    }

    public static IEnumerable<object[]> Names(string section) =>
        Root[section].Items!.Select(item => new object[] { item["name"].Str! });

    public static JsValue Case(string section, string name) =>
        Root[section].Items!.First(item => item["name"].Str == name);

    /// <summary>Null when the outcome matches. Otherwise a description of the difference.</summary>
    public static string? Compare(JsValue expect, Func<string> run, Func<string, JsValue>? success = null)
    {
        string? text = null;
        SqlibRuntimeException? error = null;
        try
        {
            text = run();
        }
        catch (SqlibRuntimeException caught)
        {
            error = caught;
        }

        var expectedError = expect["error"];
        if (expectedError.IsUndefined)
        {
            if (error != null) return $"expected success, got {error.TypeScriptName}: {error.Message}";
            var actual = success != null ? success(text!) : JsValue.FromObject(new JsObject());
            if (expect["text"].IsString && actual["text"].Str != expect["text"].Str)
            {
                return $"expected text\n{expect["text"].Str}\ngot\n{actual["text"].Str}";
            }
            if (!expect["matches"].IsUndefined && actual["matches"].Bool != expect["matches"].Bool)
            {
                return $"expected matches={expect["matches"].Bool}, got {actual["matches"].Bool}";
            }
            return null;
        }

        if (error == null) return $"expected {expectedError["type"].Str}: {expectedError["message"]}{expectedError["messagePrefix"]}, got success: {text}";
        if (error.TypeScriptName != expectedError["type"].Str) return $"expected type {expectedError["type"].Str}, got {error.TypeScriptName}: {error.Message}";
        if (expectedError["message"].IsString && error.Message != expectedError["message"].Str)
        {
            return $"expected message\n{expectedError["message"].Str}\ngot\n{error.Message}";
        }
        if (expectedError["messagePrefix"].IsString && !error.Message.StartsWith(expectedError["messagePrefix"].Str!, StringComparison.Ordinal))
        {
            return $"expected message starting\n{expectedError["messagePrefix"].Str}\ngot\n{error.Message}";
        }
        return null;
    }

    public static string? RunLoad(string name)
    {
        var entry = Case("load", name);
        return Compare(entry["expect"], () =>
        {
            QueryLibrary.Load(BundleText(entry["bundle"].Str!));
            return string.Empty;
        });
    }

    public static string? RunCall(string name)
    {
        var entry = Case("calls", name);
        var library = QueryLibrary.Load(BundleText(entry["bundle"].Str!));
        return Compare(
            entry["expect"],
            () => library.Query(entry["query"].Str!).Text(entry["payload"].Str!),
            text =>
            {
                var result = new JsObject();
                result.Set("text", JsValue.FromString(text));
                return JsValue.FromObject(result);
            });
    }

    public static string? RunPattern(string name)
    {
        var entry = Case("valuePatterns", name);
        return Compare(
            entry["expect"],
            () => ValuePattern.Compile(entry["pattern"].Str!).IsMatch(entry["value"].Str!) ? "true" : "false",
            text =>
            {
                var result = new JsObject();
                result.Set("matches", JsValue.FromBool(text == "true"));
                return JsValue.FromObject(result);
            });
    }
}
