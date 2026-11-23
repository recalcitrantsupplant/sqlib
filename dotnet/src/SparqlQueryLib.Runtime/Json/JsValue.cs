using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace SparqlQueryLib.Runtime.Json;

/// <summary>The kinds of value that <c>JSON.parse</c> produces, plus <c>undefined</c>.</summary>
internal enum JsKind
{
    Undefined,
    Null,
    Boolean,
    Number,
    String,
    Array,
    Object,
}

/// <summary>
/// A parsed JSON value that reads as JavaScript reads it.
/// </summary>
/// <remarks>
/// The TypeScript runtime validates a bundle by property access on the output
/// of <c>JSON.parse</c>. This model gives the same answers: a missing member is
/// <c>undefined</c>, an array is an object, and object keys enumerate in the
/// order <c>Object.entries</c> gives.
/// </remarks>
internal sealed class JsValue
{
    public static readonly JsValue Undefined = new(JsKind.Undefined);
    public static readonly JsValue Null = new(JsKind.Null);
    public static readonly JsValue True = new(JsKind.Boolean) { Bool = true };
    public static readonly JsValue False = new(JsKind.Boolean) { Bool = false };

    private JsValue(JsKind kind) => Kind = kind;

    public JsKind Kind { get; }
    public bool Bool { get; private init; }
    public double Number { get; private init; }
    public string? Str { get; private init; }
    public List<JsValue>? Items { get; private init; }
    public JsObject? Obj { get; private init; }

    public static JsValue FromNumber(double value) => new(JsKind.Number) { Number = value };
    public static JsValue FromString(string value) => new(JsKind.String) { Str = value };
    public static JsValue FromBool(bool value) => value ? True : False;
    public static JsValue FromArray(List<JsValue> items) => new(JsKind.Array) { Items = items };
    public static JsValue FromObject(JsObject obj) => new(JsKind.Object) { Obj = obj };

    public bool IsUndefined => Kind == JsKind.Undefined;
    public bool IsNullish => Kind is JsKind.Undefined or JsKind.Null;
    public bool IsString => Kind == JsKind.String;
    public bool IsNumber => Kind == JsKind.Number;
    public bool IsArray => Kind == JsKind.Array;

    /// <summary><c>typeof v === 'object' &amp;&amp; v !== null</c>.</summary>
    public bool IsObjectLike => Kind is JsKind.Object or JsKind.Array;

    /// <summary>JavaScript truthiness.</summary>
    public bool Truthy => Kind switch
    {
        JsKind.Undefined or JsKind.Null => false,
        JsKind.Boolean => Bool,
        JsKind.Number => Number != 0 && !double.IsNaN(Number),
        JsKind.String => Str!.Length > 0,
        _ => true,
    };

    /// <summary><c>Number.isInteger(v)</c>.</summary>
    public bool IsInteger => Kind == JsKind.Number && !double.IsInfinity(Number) && !double.IsNaN(Number) && Math.Floor(Number) == Number;

    /// <summary>
    /// <c>v[key]</c>. Reading a member of <c>null</c> or <c>undefined</c> is a
    /// TypeError in JavaScript. Here it gives <c>undefined</c>.
    /// </summary>
    public JsValue Get(string key)
    {
        switch (Kind)
        {
            case JsKind.Object:
                return Obj!.TryGet(key, out var value) ? value : Undefined;
            case JsKind.Array:
                if (key == "length") return FromNumber(Items!.Count);
                return JsObject.TryArrayIndex(key, out var index) && index < Items!.Count ? Items[(int)index] : Undefined;
            case JsKind.String:
                if (key == "length") return FromNumber(Str!.Length);
                return JsObject.TryArrayIndex(key, out var at) && at < Str!.Length ? FromString(Str[(int)at].ToString()) : Undefined;
            default:
                return Undefined;
        }
    }

    public JsValue this[string key] => Get(key);

    /// <summary><c>key in v</c> for an object or an array.</summary>
    public bool Has(string key) => Kind switch
    {
        JsKind.Object => Obj!.TryGet(key, out _),
        JsKind.Array => key == "length" || (JsObject.TryArrayIndex(key, out var index) && index < Items!.Count),
        _ => false,
    };

    /// <summary><c>Object.entries(v)</c>.</summary>
    public IEnumerable<KeyValuePair<string, JsValue>> Entries()
    {
        switch (Kind)
        {
            case JsKind.Object:
                foreach (var entry in Obj!.Entries()) yield return entry;
                break;
            case JsKind.Array:
                for (var i = 0; i < Items!.Count; i++) yield return new(i.ToString(CultureInfo.InvariantCulture), Items[i]);
                break;
            case JsKind.String:
                for (var i = 0; i < Str!.Length; i++) yield return new(i.ToString(CultureInfo.InvariantCulture), FromString(Str[i].ToString()));
                break;
        }
    }

    /// <summary><c>SameValueZero</c>, the equality a <c>Set</c> and <c>Array.prototype.includes</c> use.</summary>
    public bool SameValueZero(JsValue other)
    {
        if (Kind != other.Kind) return false;
        return Kind switch
        {
            JsKind.Undefined or JsKind.Null => true,
            JsKind.Boolean => Bool == other.Bool,
            JsKind.Number => Number == other.Number || (double.IsNaN(Number) && double.IsNaN(other.Number)),
            JsKind.String => string.Equals(Str, other.Str, StringComparison.Ordinal),
            _ => ReferenceEquals(this, other),
        };
    }

    /// <summary><c>v === other</c> for primitives.</summary>
    public bool StrictEquals(JsValue other) =>
        Kind == other.Kind && (Kind == JsKind.Number ? Number == other.Number : SameValueZero(other));

    public bool StrictEquals(string text) => Kind == JsKind.String && string.Equals(Str, text, StringComparison.Ordinal);

    /// <summary><c>String(v)</c>, the conversion a template literal applies.</summary>
    public override string ToString() => Js.ToJsString(this);
}

/// <summary>An object, with JavaScript property order.</summary>
internal sealed class JsObject
{
    private readonly Dictionary<string, JsValue> values = new(StringComparer.Ordinal);
    private readonly List<string> order = new();

    /// <summary>Assign a member. A repeated key keeps its first position and takes the last value, as <c>JSON.parse</c> does.</summary>
    public void Set(string key, JsValue value)
    {
        if (!values.ContainsKey(key)) order.Add(key);
        values[key] = value;
    }

    public bool TryGet(string key, out JsValue value) => values.TryGetValue(key, out value!);

    /// <summary>
    /// Members in <c>Object.entries</c> order: array index keys in ascending
    /// numeric order, then the other keys in insertion order.
    /// </summary>
    public IEnumerable<KeyValuePair<string, JsValue>> Entries()
    {
        var indices = new List<(uint Index, string Key)>();
        foreach (var key in order)
        {
            if (TryArrayIndex(key, out var index)) indices.Add((index, key));
        }
        indices.Sort((a, b) => a.Index.CompareTo(b.Index));
        foreach (var (_, key) in indices) yield return new(key, values[key]);
        foreach (var key in order)
        {
            if (!TryArrayIndex(key, out _)) yield return new(key, values[key]);
        }
    }

    /// <summary>True when <paramref name="key"/> is a canonical array index, 0 to 2^32-2.</summary>
    public static bool TryArrayIndex(string key, out uint index)
    {
        index = 0;
        if (key.Length == 0 || key.Length > 10) return false;
        if (key.Length > 1 && key[0] == '0') return false;
        ulong value = 0;
        foreach (var c in key)
        {
            if (c < '0' || c > '9') return false;
            value = (value * 10) + (ulong)(c - '0');
        }
        if (value >= uint.MaxValue) return false;
        index = (uint)value;
        return true;
    }
}

/// <summary>JavaScript conversions that error messages depend on.</summary>
internal static class Js
{
    /// <summary><c>String(v)</c>.</summary>
    public static string ToJsString(JsValue value) => value.Kind switch
    {
        JsKind.Undefined => "undefined",
        JsKind.Null => "null",
        JsKind.Boolean => value.Bool ? "true" : "false",
        JsKind.Number => NumberToString(value.Number),
        JsKind.String => value.Str!,
        JsKind.Array => string.Join(",", value.Items!.ConvertAll(item => item.IsNullish ? string.Empty : ToJsString(item))),
        _ => "[object Object]",
    };

    /// <summary><c>Number.prototype.toString()</c> with radix 10.</summary>
    public static string NumberToString(double value)
    {
        if (double.IsNaN(value)) return "NaN";
        if (value == 0) return "0";
        if (double.IsPositiveInfinity(value)) return "Infinity";
        if (double.IsNegativeInfinity(value)) return "-Infinity";
        if (value < 0) return "-" + NumberToString(-value);

        // "R" gives the shortest digits that round-trip, as ECMAScript requires.
        var round = value.ToString("R", CultureInfo.InvariantCulture);
        var exponentAt = round.IndexOfAny(new[] { 'E', 'e' });
        var mantissa = exponentAt < 0 ? round : round.Substring(0, exponentAt);
        var exponent = exponentAt < 0 ? 0 : int.Parse(round.Substring(exponentAt + 1), NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture);
        var dot = mantissa.IndexOf('.');
        var digits = dot < 0 ? mantissa : mantissa.Remove(dot, 1);
        var pointAt = (dot < 0 ? mantissa.Length : dot) + exponent;
        var leading = 0;
        while (leading < digits.Length - 1 && digits[leading] == '0') leading++;
        digits = digits.Substring(leading);
        pointAt -= leading;
        digits = digits.TrimEnd('0');
        if (digits.Length == 0) return "0";

        var k = digits.Length;
        var n = pointAt;
        if (k <= n && n <= 21) return digits + new string('0', n - k);
        if (0 < n && n <= 21) return digits.Substring(0, n) + "." + digits.Substring(n);
        if (-6 < n && n <= 0) return "0." + new string('0', -n) + digits;
        var e = n - 1;
        var sign = e >= 0 ? "+" : "-";
        var head = k == 1 ? digits : digits.Substring(0, 1) + "." + digits.Substring(1);
        return head + "e" + sign + Math.Abs(e).ToString(CultureInfo.InvariantCulture);
    }

    /// <summary><c>JSON.stringify(s)</c> for a string.</summary>
    public static string Quote(string value)
    {
        var builder = new StringBuilder(value.Length + 2);
        builder.Append('"');
        for (var i = 0; i < value.Length; i++)
        {
            var c = value[i];
            switch (c)
            {
                case '"': builder.Append("\\\""); break;
                case '\\': builder.Append("\\\\"); break;
                case '\b': builder.Append("\\b"); break;
                case '\f': builder.Append("\\f"); break;
                case '\n': builder.Append("\\n"); break;
                case '\r': builder.Append("\\r"); break;
                case '\t': builder.Append("\\t"); break;
                default:
                    if (c < 0x20)
                    {
                        builder.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                    }
                    else if (char.IsHighSurrogate(c) && i + 1 < value.Length && char.IsLowSurrogate(value[i + 1]))
                    {
                        builder.Append(c).Append(value[i + 1]);
                        i++;
                    }
                    else if (char.IsSurrogate(c))
                    {
                        builder.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                    }
                    else
                    {
                        builder.Append(c);
                    }
                    break;
            }
        }
        return builder.Append('"').ToString();
    }

    /// <summary><c>JSON.stringify(v)</c>, compact. Returns null where JavaScript returns <c>undefined</c>.</summary>
    public static string? Stringify(JsValue value)
    {
        switch (value.Kind)
        {
            case JsKind.Undefined:
                return null;
            case JsKind.Null:
                return "null";
            case JsKind.Boolean:
                return value.Bool ? "true" : "false";
            case JsKind.Number:
                return double.IsNaN(value.Number) || double.IsInfinity(value.Number) ? "null" : NumberToString(value.Number);
            case JsKind.String:
                return Quote(value.Str!);
            case JsKind.Array:
                return "[" + string.Join(",", value.Items!.ConvertAll(item => Stringify(item) ?? "null")) + "]";
            default:
                var parts = new List<string>();
                foreach (var entry in value.Entries())
                {
                    var text = Stringify(entry.Value);
                    if (text != null) parts.Add(Quote(entry.Key) + ":" + text);
                }
                return "{" + string.Join(",", parts) + "}";
        }
    }

    /// <summary>True for a character that <c>String.prototype.trim</c> removes.</summary>
    public static bool IsJsWhiteSpace(char c) =>
        c is '\t' or '\n' or '\u000B' or '\f' or '\r' or ' ' or '\u00A0' or '\u1680' or '\u2028' or '\u2029'
            or '\u202F' or '\u205F' or '\u3000' or '\uFEFF' || (c >= '\u2000' && c <= '\u200A');

    /// <summary><c>String.prototype.trim</c>.</summary>
    public static string Trim(string value)
    {
        var start = 0;
        var end = value.Length;
        while (start < end && IsJsWhiteSpace(value[start])) start++;
        while (end > start && IsJsWhiteSpace(value[end - 1])) end--;
        return value.Substring(start, end - start);
    }

    /// <summary>The default comparison of <c>Array.prototype.sort</c> for strings: UTF-16 code units.</summary>
    public static int CompareCodeUnits(string a, string b) => string.CompareOrdinal(a, b);
}
