using System;
using System.Collections.Generic;
using System.Linq;
using SparqlQueryLib.Runtime.Json;

namespace SparqlQueryLib.Runtime;

/// <summary>An RDF term for an argument cell: an IRI or a literal.</summary>
public sealed class Term
{
    private Term(string type, string value, string? datatype, string? lang)
    {
        Type = type;
        Value = value;
        Datatype = datatype;
        Lang = lang;
    }

    /// <summary><c>uri</c> or <c>literal</c>.</summary>
    public string Type { get; }
    public string Value { get; }
    public string? Datatype { get; }
    public string? Lang { get; }

    public static Term Iri(string value) => new("uri", value ?? throw new ArgumentNullException(nameof(value)), null, null);

    /// <summary>A plain literal, or one with a datatype IRI, or one with a language tag. A language tag wins over a datatype.</summary>
    public static Term Literal(string value, string? datatype = null, string? lang = null) =>
        new("literal", value ?? throw new ArgumentNullException(nameof(value)), datatype, lang);

    internal JsValue ToJs()
    {
        var obj = new JsObject();
        obj.Set("type", JsValue.FromString(Type));
        obj.Set("value", JsValue.FromString(Value));
        if (Datatype != null) obj.Set("datatype", JsValue.FromString(Datatype));
        if (Lang != null) obj.Set("xml:lang", JsValue.FromString(Lang));
        return JsValue.FromObject(obj);
    }
}

/// <summary>
/// One argument: the variables it binds and its rows. It fills the slot that
/// declares the same variables, in any order.
/// </summary>
public sealed class ArgumentSet
{
    private readonly List<IReadOnlyDictionary<string, Term?>> rows = new();

    public ArgumentSet(params string[] vars)
    {
        if (vars == null || vars.Length == 0) throw new ArgumentException("An argument set binds at least one variable.", nameof(vars));
        Vars = vars.ToList();
    }

    public IReadOnlyList<string> Vars { get; }

    /// <summary>Each row maps a variable to its term. A missing or null cell is UNDEF.</summary>
    public IReadOnlyList<IReadOnlyDictionary<string, Term?>> Rows => rows;

    /// <summary>Add a row. Returns this set, so calls can be chained.</summary>
    public ArgumentSet Row(IReadOnlyDictionary<string, Term?> cells)
    {
        if (cells == null) throw new ArgumentNullException(nameof(cells));
        var row = new Dictionary<string, Term?>(StringComparer.Ordinal);
        foreach (var cell in cells) row[cell.Key] = cell.Value;
        rows.Add(row);
        return this;
    }

    /// <summary>Add a row from variable and term pairs.</summary>
    public ArgumentSet Row(params (string Variable, Term? Value)[] cells)
    {
        var row = new Dictionary<string, Term?>(StringComparer.Ordinal);
        foreach (var (variable, value) in cells) row[variable] = value;
        rows.Add(row);
        return this;
    }

    /// <summary>A one-variable set with one row per value.</summary>
    public static ArgumentSet Of(string variable, params Term[] values)
    {
        var set = new ArgumentSet(variable);
        foreach (var value in values) set.Row((variable, value));
        return set;
    }

    internal JsValue ToJs()
    {
        var head = new JsObject();
        head.Set("vars", JsValue.FromArray(Vars.Select(JsValue.FromString).ToList()));
        var bindings = new List<JsValue>();
        foreach (var row in rows)
        {
            var obj = new JsObject();
            foreach (var cell in row) obj.Set(cell.Key, cell.Value?.ToJs() ?? JsValue.Null);
            bindings.Add(JsValue.FromObject(obj));
        }
        var results = new JsObject();
        results.Set("bindings", JsValue.FromArray(bindings));
        var wire = new JsObject();
        wire.Set("head", JsValue.FromObject(head));
        wire.Set("results", JsValue.FromObject(results));
        return JsValue.FromObject(wire);
    }
}

/// <summary>A call built in code. It is the same payload as the JSON form of <see cref="QueryHandle.Text(string)"/>.</summary>
public sealed class CallPayload
{
    /// <summary>At most one argument set per slot. A slot with no set runs by its empty-input rule.</summary>
    public IList<ArgumentSet> Arguments { get; } = new List<ArgumentSet>();

    /// <summary>LIMIT parameters by name, in the order given. A repeated name takes the last value.</summary>
    public IList<KeyValuePair<string, long>> Limits { get; } = new List<KeyValuePair<string, long>>();

    /// <summary>OFFSET parameters by name, in the order given.</summary>
    public IList<KeyValuePair<string, long>> Offsets { get; } = new List<KeyValuePair<string, long>>();

    public CallPayload With(ArgumentSet argument)
    {
        Arguments.Add(argument ?? throw new ArgumentNullException(nameof(argument)));
        return this;
    }

    public CallPayload Limit(string name, long value)
    {
        Limits.Add(new KeyValuePair<string, long>(name, value));
        return this;
    }

    public CallPayload Offset(string name, long value)
    {
        Offsets.Add(new KeyValuePair<string, long>(name, value));
        return this;
    }

    internal JsValue ToJs()
    {
        static JsValue Parameters(IEnumerable<KeyValuePair<string, long>> items) =>
            JsValue.FromArray(items.Select(item =>
            {
                var obj = new JsObject();
                obj.Set("name", JsValue.FromString(item.Key));
                obj.Set("value", JsValue.FromNumber(item.Value));
                return JsValue.FromObject(obj);
            }).ToList());

        var payload = new JsObject();
        payload.Set("arguments", JsValue.FromArray(Arguments.Select(a => a.ToJs()).ToList()));
        payload.Set("limits", Parameters(Limits));
        payload.Set("offsets", Parameters(Offsets));
        return JsValue.FromObject(payload);
    }
}
