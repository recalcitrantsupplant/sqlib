using System.Collections.Generic;
using System.Globalization;
using SparqlQueryLib.Runtime.Json;

namespace SparqlQueryLib.Runtime;

/// <summary>An argument set ready to substitute: declared variables, rows, and the empty-input mode the runtime attaches.</summary>
internal sealed class ArgSet
{
    public ArgSet(IReadOnlyList<string> vars, IReadOnlyList<IReadOnlyDictionary<string, TermValue>> rows, string? whenEmpty = null)
    {
        Vars = vars;
        Rows = rows;
        WhenEmpty = whenEmpty;
    }

    public IReadOnlyList<string> Vars { get; }

    /// <summary>Each row maps a variable to its term. An absent variable is UNDEF.</summary>
    public IReadOnlyList<IReadOnlyDictionary<string, TermValue>> Rows { get; }

    public string? WhenEmpty { get; }

    public ArgSet WithWhenEmpty(string? whenEmpty) => new(Vars, Rows, whenEmpty);
}

/// <summary>Reads argument documents off the wire. Port of <c>arguments.ts</c>.</summary>
internal static class Arguments
{
    private const string XsdString = "http://www.w3.org/2001/XMLSchema#string";

    private static TermValue? NormalizeTerm(JsValue term, string where)
    {
        if (term.IsNullish) return null;
        if (!term.IsObjectLike) throw new InvalidArgumentException($"{where} is not an RDF term object.");
        var type = term["type"];
        var value = term["value"];
        var datatype = term["datatype"];
        var lang = term["xml:lang"];
        if (!value.IsString) throw new InvalidArgumentException($"{where} has no string value.");
        if (type.StrictEquals("bnode"))
        {
            throw new InvalidArgumentException(
                $"{where} is a blank node. A blank node label only means something inside the document it came from, so it cannot be passed as an argument; use an IRI.");
        }
        if (type.StrictEquals("uri")) return new TermValue("uri", value.Str!);
        if (type.StrictEquals("literal") || type.StrictEquals("typed-literal"))
        {
            if (lang.IsString) return new TermValue("literal", value.Str!, lang: lang.Str);
            if (datatype.IsString) return new TermValue("literal", value.Str!, datatype: datatype.Str);
            if (type.StrictEquals("typed-literal")) return new TermValue("literal", value.Str!, datatype: XsdString);
            return new TermValue("literal", value.Str!);
        }
        throw new InvalidArgumentException(
            $"{where} has type {Js.Stringify(type) ?? "undefined"}; an argument term is a \"uri\" or a \"literal\".");
    }

    /// <summary>Validate argument documents and bring them to the runtime shape.</summary>
    public static List<ArgSet> Normalize(IReadOnlyList<JsValue> argumentSets)
    {
        var result = new List<ArgSet>(argumentSets.Count);
        for (var index = 0; index < argumentSets.Count; index++)
        {
            var at = $"Argument {index.ToString(CultureInfo.InvariantCulture)}";
            var record = argumentSets[index].IsNullish ? JsValue.FromObject(new JsObject()) : argumentSets[index];
            var head = record["head"];
            var results = record["results"];
            var vars = head["vars"];
            var varsOk = head.Truthy && vars.IsArray && vars.Items!.TrueForAll(v => v.IsString);
            if (!varsOk) throw new InvalidArgumentException($"{at} has no head.vars naming the variables it binds.");
            var bindings = results["bindings"];
            if (!results.Truthy || !bindings.IsArray)
            {
                throw new InvalidArgumentException(
                    record.Has("arguments")
                        ? $"{at} puts its rows under \"arguments\"; an argument is a SPARQL Results JSON document, so they go under \"results\"."
                        : $"{at} has no results.bindings array.");
            }

            var rows = new List<IReadOnlyDictionary<string, TermValue>>(bindings.Items!.Count);
            for (var rowIndex = 0; rowIndex < bindings.Items.Count; rowIndex++)
            {
                var row = bindings.Items[rowIndex];
                var output = new Dictionary<string, TermValue>(System.StringComparer.Ordinal);
                if (!row.IsNullish)
                {
                    if (!row.IsObjectLike || row.IsArray)
                    {
                        throw new InvalidArgumentException($"{at}, row {rowIndex.ToString(CultureInfo.InvariantCulture)} is not an object.");
                    }
                    foreach (var entry in row.Entries())
                    {
                        var normalized = NormalizeTerm(entry.Value, $"{at}, row {rowIndex.ToString(CultureInfo.InvariantCulture)}, ?{entry.Key}");
                        if (normalized != null) output[entry.Key] = normalized;
                    }
                }
                rows.Add(output);
            }
            result.Add(new ArgSet(vars.Items!.ConvertAll(v => v.Str!), rows));
        }
        return result;
    }
}
