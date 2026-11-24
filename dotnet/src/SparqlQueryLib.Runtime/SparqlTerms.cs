using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace SparqlQueryLib.Runtime;

/// <summary>One argument value after normalisation: an IRI, or a literal with an optional datatype or language tag.</summary>
internal sealed class TermValue
{
    public TermValue(string type, string value, string? datatype = null, string? lang = null)
    {
        Type = type;
        Value = value;
        Datatype = datatype;
        Lang = lang;
    }

    public string Type { get; }
    public string Value { get; }
    public string? Datatype { get; }
    public string? Lang { get; }
}

/// <summary>
/// Writes RDF terms in SPARQL syntax. Port of <c>sparql-terms.ts</c>.
/// </summary>
/// <remarks>
/// Every value is checked against its SPARQL production or refused. String
/// literals are the one production with an escape mechanism. The checks are
/// written as loops over UTF-16 code units, so that culture and .NET regular
/// expression semantics cannot change them.
/// </remarks>
internal static class SparqlTerms
{
    private static bool IsAsciiLetter(char c) => (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z');
    private static bool IsAsciiDigit(char c) => c >= '0' && c <= '9';
    private static bool IsAsciiAlnum(char c) => IsAsciiLetter(c) || IsAsciiDigit(c);

    /// <summary><c>IRIREF</c> forbids <c>&lt;&gt;"{}|^`\</c> and U+0000 to U+0020.</summary>
    private static bool ForbiddenInIri(char c) =>
        c <= ' ' || c is '<' or '>' or '"' or '{' or '}' or '|' or '^' or '`' or '\\';

    /// <summary><c>^[a-zA-Z]+(-[a-zA-Z0-9]+)*$</c>.</summary>
    public static bool IsLangTag(string value)
    {
        var i = 0;
        while (i < value.Length && IsAsciiLetter(value[i])) i++;
        if (i == 0) return false;
        while (i < value.Length)
        {
            if (value[i] != '-') return false;
            i++;
            var start = i;
            while (i < value.Length && IsAsciiAlnum(value[i])) i++;
            if (i == start) return false;
        }
        return true;
    }

    /// <summary><c>^[A-Za-z_][A-Za-z0-9_]*$</c>.</summary>
    public static bool IsSafeVariableName(string name)
    {
        if (name.Length == 0) return false;
        if (!(IsAsciiLetter(name[0]) || name[0] == '_')) return false;
        for (var i = 1; i < name.Length; i++)
        {
            if (!(IsAsciiAlnum(name[i]) || name[i] == '_')) return false;
        }
        return true;
    }

    /// <summary><c>^[A-Za-z0-9_][A-Za-z0-9_.-]*$</c>.</summary>
    private static bool IsSafeLocalName(string local)
    {
        if (local.Length == 0) return false;
        if (!(IsAsciiAlnum(local[0]) || local[0] == '_')) return false;
        for (var i = 1; i < local.Length; i++)
        {
            var c = local[i];
            if (!(IsAsciiAlnum(c) || c is '_' or '.' or '-')) return false;
        }
        return true;
    }

    /// <summary><c>^[A-Za-z][A-Za-z0-9_.-]*$</c>.</summary>
    private static bool IsSafePrefix(string prefix)
    {
        if (prefix.Length == 0 || !IsAsciiLetter(prefix[0])) return false;
        for (var i = 1; i < prefix.Length; i++)
        {
            var c = prefix[i];
            if (!(IsAsciiAlnum(c) || c is '_' or '.' or '-')) return false;
        }
        return true;
    }

    public static string SerializeIri(string iri, IReadOnlyList<KeyValuePair<string, string>>? prefixes = null)
    {
        if (iri.Length == 0) throw new InvalidTermException("IRI must be a non-empty string.");
        for (var i = 0; i < iri.Length; i++)
        {
            if (!ForbiddenInIri(iri[i])) continue;
            var code = ((int)iri[i]).ToString("X4", CultureInfo.InvariantCulture);
            throw new InvalidTermException(
                $"IRI contains a character SPARQL forbids in an IRIREF (U+{code}) at index {i.ToString(CultureInfo.InvariantCulture)}.");
        }
        if (prefixes != null)
        {
            foreach (var entry in prefixes)
            {
                var prefix = entry.Key;
                var ns = entry.Value;
                if (ns.Length == 0 || !iri.StartsWith(ns, StringComparison.Ordinal)) continue;
                if (!IsSafePrefix(prefix)) continue;
                var local = iri.Substring(ns.Length);
                if (local.Length > 0 && IsSafeLocalName(local) && local[local.Length - 1] != '.')
                {
                    return prefix + ":" + local;
                }
            }
        }
        return "<" + iri + ">";
    }

    /// <summary>Escape exactly <c>\</c>, <c>"</c>, LF and CR. Every other character is legal in a quoted literal.</summary>
    public static string EscapeLiteralLexical(string value)
    {
        StringBuilder? builder = null;
        for (var i = 0; i < value.Length; i++)
        {
            var c = value[i];
            string? replacement = c switch
            {
                '\\' => "\\\\",
                '"' => "\\\"",
                '\n' => "\\n",
                '\r' => "\\r",
                _ => null,
            };
            if (replacement == null)
            {
                builder?.Append(c);
                continue;
            }
            builder ??= new StringBuilder(value, 0, i, value.Length + 8);
            builder.Append(replacement);
        }
        return builder?.ToString() ?? value;
    }

    public static string SerializeVariable(string name)
    {
        if (!IsSafeVariableName(name)) throw new InvalidTermException($"Unsupported variable name '{name}'.");
        return "?" + name;
    }

    public static string SerializeTerm(TermValue term, string context, IReadOnlyList<KeyValuePair<string, string>> prefixes)
    {
        if (term.Type == "uri")
        {
            try
            {
                return SerializeIri(term.Value, prefixes);
            }
            catch (InvalidTermException error)
            {
                throw new InvalidTermException($"Invalid IRI {context}. {error.Message}");
            }
        }
        if (term.Type == "literal")
        {
            var lexical = "\"" + EscapeLiteralLexical(term.Value) + "\"";
            if (term.Datatype != null)
            {
                try
                {
                    return lexical + "^^" + SerializeIri(term.Datatype);
                }
                catch (InvalidTermException error)
                {
                    throw new InvalidTermException($"Invalid datatype IRI {context}. {error.Message}");
                }
            }
            if (term.Lang != null)
            {
                if (!IsLangTag(term.Lang)) throw new InvalidTermException($"Invalid language tag '{term.Lang}' {context}.");
                return lexical + "@" + term.Lang;
            }
            return lexical;
        }
        throw new InvalidTermException($"Invalid argument type '{term.Type}' {context}. Only 'uri' and 'literal' are supported.");
    }

    /// <summary>
    /// A complete VALUES block, spelled as Traqula's generator spells it:
    /// <c>VALUES ?v { a b }</c> for one variable, <c>VALUES( ?a ?b ){ ( x y ) }</c> for more.
    /// </summary>
    public static string RenderValuesBlock(
        IReadOnlyList<string> vars,
        IReadOnlyList<IReadOnlyDictionary<string, TermValue>> rows,
        int argSetIndex,
        IReadOnlyList<KeyValuePair<string, string>> prefixes)
    {
        string CellOf(IReadOnlyDictionary<string, TermValue> row, string variable) =>
            row.TryGetValue(variable, out var cell)
                ? SerializeTerm(cell, $"for variable '{variable}' in argument set {(argSetIndex + 1).ToString(CultureInfo.InvariantCulture)}", prefixes)
                : "UNDEF";

        if (vars.Count == 1)
        {
            var only = vars[0];
            var header = SerializeVariable(only);
            if (rows.Count == 0) return $"VALUES {header} {{ }}";
            var cells = new List<string>(rows.Count);
            foreach (var row in rows) cells.Add(CellOf(row, only));
            return $"VALUES {header} {{ {string.Join(" ", cells)} }}";
        }

        var names = new List<string>(vars.Count);
        foreach (var v in vars) names.Add(SerializeVariable(v));
        var head = string.Join(" ", names);
        if (rows.Count == 0) return $"VALUES( {head} ){{ }}";
        var body = new List<string>(rows.Count);
        foreach (var row in rows)
        {
            var cells = new List<string>(vars.Count);
            foreach (var v in vars) cells.Add(CellOf(row, v));
            body.Add($"( {string.Join(" ", cells)} )");
        }
        return $"VALUES( {head} ){{ {string.Join(" ", body)} }}";
    }
}
