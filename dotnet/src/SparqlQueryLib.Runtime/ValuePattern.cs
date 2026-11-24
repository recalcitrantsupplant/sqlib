using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace SparqlQueryLib.Runtime;

/// <summary>
/// Translates a slot's value pattern, a JavaScript regular expression in
/// Unicode mode (<c>new RegExp(pattern, 'u')</c>), into a .NET regular
/// expression with the same matches.
/// </summary>
/// <remarks>
/// <para>
/// .NET reads several constructs differently from JavaScript: <c>$</c> also
/// matches before a final newline, <c>\d</c>, <c>\w</c>, <c>\s</c> and
/// <c>\b</c> are Unicode-aware, and <c>.</c> and negated classes consume one
/// UTF-16 code unit where JavaScript consumes one code point. The translation
/// writes each construct out explicitly.
/// </para>
/// <para>
/// A pattern that JavaScript refuses is refused with
/// "is not a valid regular expression". A pattern that JavaScript accepts but
/// that uses a construct outside the translated subset (back-references,
/// <c>\p{...}</c>, astral or surrogate class members, lone surrogates) is
/// refused with "uses ... which this runtime does not translate". See
/// <c>docs/guides/dotnet-runtime.md</c>, "Value patterns".
/// </para>
/// </remarks>
public static class ValuePattern
{
    /// <summary>The longest value pattern a slot may carry, in UTF-16 code units.</summary>
    public const int MaxLength = 200;

    private const string WordClass = "[A-Za-z0-9_]";
    private const string Pair = "[\\uD800-\\uDBFF][\\uDC00-\\uDFFF]";
    private const string LoneHigh = "[\\uD800-\\uDBFF](?![\\uDC00-\\uDFFF])";
    private const string LoneLow = "(?<![\\uD800-\\uDBFF])[\\uDC00-\\uDFFF]";

    private static readonly (int Lo, int Hi)[] Digit = { ('0', '9') };
    private static readonly (int Lo, int Hi)[] Word = { ('0', '9'), ('A', 'Z'), ('_', '_'), ('a', 'z') };

    private static readonly (int Lo, int Hi)[] Space =
    {
        (0x09, 0x0D), (0x20, 0x20), (0xA0, 0xA0), (0x1680, 0x1680), (0x2000, 0x200A),
        (0x2028, 0x2029), (0x202F, 0x202F), (0x205F, 0x205F), (0x3000, 0x3000), (0xFEFF, 0xFEFF),
    };

    private static readonly (int Lo, int Hi)[] LineTerminators = { ('\n', '\n'), ('\r', '\r'), (0x2028, 0x2029) };

    private static readonly ConcurrentDictionary<(string, TimeSpan), Regex> Cache = new();

    /// <summary>
    /// Compile a value pattern. Throws <see cref="InvalidValuePatternException"/>
    /// with the TypeScript runtime's message for an empty or long pattern.
    /// </summary>
    /// <param name="pattern">The pattern as the bundle carries it.</param>
    /// <param name="matchTimeout">The longest one match may take. <see cref="Regex.InfiniteMatchTimeout"/> waits for ever, as JavaScript does.</param>
    public static Regex Compile(string pattern, TimeSpan matchTimeout)
    {
        if (pattern == null || pattern.Length == 0)
        {
            throw new InvalidValuePatternException("A value pattern must be a non-empty regular expression.");
        }
        if (pattern.Length > MaxLength)
        {
            throw new InvalidValuePatternException(
                $"A value pattern can be at most {MaxLength.ToString(CultureInfo.InvariantCulture)} characters.");
        }
        return Cache.GetOrAdd((pattern, matchTimeout), key =>
            new Regex(Translate(key.Item1), RegexOptions.CultureInvariant, key.Item2));
    }

    /// <summary>Compile with no match timeout.</summary>
    public static Regex Compile(string pattern) => Compile(pattern, Regex.InfiniteMatchTimeout);

    /// <summary>The .NET pattern for a JavaScript Unicode-mode pattern.</summary>
    public static string Translate(string pattern) => new Translator(pattern).Run();

    /// <summary>The code point at <paramref name="index"/>: a surrogate pair as one code point, a lone surrogate as itself.</summary>
    private static int CodePointAt(string text, int index)
    {
        var c = text[index];
        if (char.IsHighSurrogate(c) && index + 1 < text.Length && char.IsLowSurrogate(text[index + 1]))
        {
            return char.ConvertToUtf32(c, text[index + 1]);
        }
        return c;
    }

    private static string Escape(int codeUnit) => "\\u" + codeUnit.ToString("X4", CultureInfo.InvariantCulture);

    private static string RangesBody(IEnumerable<(int Lo, int Hi)> ranges)
    {
        var builder = new StringBuilder();
        foreach (var (lo, hi) in ranges)
        {
            builder.Append(Escape(lo));
            if (hi != lo) builder.Append('-').Append(Escape(hi));
        }
        return builder.ToString();
    }

    private static string Positive(IReadOnlyCollection<(int Lo, int Hi)> ranges) =>
        ranges.Count == 0 ? "(?!)" : "[" + RangesBody(ranges) + "]";

    /// <summary>One code point outside <paramref name="ranges"/>. A surrogate pair is one code point.</summary>
    private static string Negated(IEnumerable<(int Lo, int Hi)> ranges) =>
        "(?:" + Pair + "|" + LoneHigh + "|" + LoneLow + "|[^" + RangesBody(ranges) + "\\uD800-\\uDFFF])";

    private sealed class Translator
    {
        private readonly string source;
        private readonly StringBuilder output = new();
        private readonly HashSet<string> groupNames = new(StringComparer.Ordinal);
        private readonly HashSet<string> declaredNames = new(StringComparer.Ordinal);
        private int capturingGroups;
        private int position;

        public Translator(string source) => this.source = source;

        private Exception Invalid(string reason) =>
            new InvalidValuePatternException($"Value pattern {Json.Js.Quote(source)} is not a valid regular expression: {reason}");

        private Exception Unsupported(string construct) =>
            new InvalidValuePatternException(
                $"Value pattern {Json.Js.Quote(source)} uses {construct}, which this runtime does not translate to a .NET regular expression.");

        private bool AtEnd => position >= source.Length;

        private int Peek(int ahead = 0)
        {
            var at = position;
            for (var i = 0; i < ahead && at < source.Length; i++) at += CodePointLength(at);
            return at < source.Length ? CodePointAt(source, at) : -1;
        }

        private int CodePointLength(int at) =>
            at + 1 < source.Length && char.IsHighSurrogate(source[at]) && char.IsLowSurrogate(source[at + 1]) ? 2 : 1;

        private int Next()
        {
            var cp = CodePointAt(source, position);
            position += CodePointLength(position);
            return cp;
        }

        public string Run()
        {
            Prescan();
            ParseDisjunction(topLevel: true);
            if (!AtEnd) throw Invalid(Peek() == ')' ? "Unmatched ')'" : "Unexpected character");
            return output.ToString();
        }

        /// <summary>Count capturing groups and collect group names, for back-reference checks.</summary>
        private void Prescan()
        {
            var inClass = false;
            for (var i = 0; i < source.Length; i++)
            {
                var c = source[i];
                if (c == '\\')
                {
                    i++;
                    continue;
                }
                if (inClass)
                {
                    if (c == ']') inClass = false;
                    continue;
                }
                if (c == '[')
                {
                    inClass = true;
                    continue;
                }
                if (c != '(') continue;
                if (i + 1 < source.Length && source[i + 1] == '?')
                {
                    if (i + 2 < source.Length && source[i + 2] == '<' && i + 3 < source.Length && source[i + 3] != '=' && source[i + 3] != '!')
                    {
                        capturingGroups++;
                        var close = source.IndexOf('>', i + 3);
                        if (close > 0) groupNames.Add(source.Substring(i + 3, close - i - 3));
                    }
                    continue;
                }
                capturingGroups++;
            }
        }

        private void ParseDisjunction(bool topLevel)
        {
            ParseAlternative();
            while (!AtEnd && Peek() == '|')
            {
                Next();
                output.Append('|');
                ParseAlternative();
            }
            if (!topLevel && AtEnd) throw Invalid("Unterminated group");
        }

        private void ParseAlternative()
        {
            while (!AtEnd && Peek() != '|' && Peek() != ')') ParseTerm();
        }

        private void ParseTerm()
        {
            var c = Peek();
            switch (c)
            {
                case '^':
                    Next();
                    output.Append('^');
                    RefuseQuantifier();
                    return;
                case '$':
                    Next();
                    output.Append("\\z");
                    RefuseQuantifier();
                    return;
                case '(':
                    ParseGroup();
                    return;
                case '\\' when Peek(1) == 'b':
                    Next();
                    Next();
                    output.Append($"(?:(?<={WordClass})(?!{WordClass})|(?<!{WordClass})(?={WordClass}))");
                    RefuseQuantifier();
                    return;
                case '\\' when Peek(1) == 'B':
                    Next();
                    Next();
                    output.Append($"(?:(?<={WordClass})(?={WordClass})|(?<!{WordClass})(?!{WordClass}))");
                    RefuseQuantifier();
                    return;
            }
            ParseAtom();
            ParseQuantifier();
        }

        private void RefuseQuantifier()
        {
            if (AtEnd) return;
            var c = Peek();
            if (c is '*' or '+' or '?' || (c == '{' && LooksLikeQuantifier())) throw Invalid("Nothing to repeat");
        }

        private void ParseGroup()
        {
            Next();
            if (Peek() == '?')
            {
                Next();
                var kind = Peek();
                if (kind == ':')
                {
                    Next();
                    output.Append("(?:");
                    ParseDisjunction(topLevel: false);
                    CloseGroup();
                    ParseQuantifier();
                    return;
                }
                if (kind is '=' or '!')
                {
                    Next();
                    output.Append("(?").Append((char)kind);
                    ParseDisjunction(topLevel: false);
                    CloseGroup();
                    RefuseQuantifier();
                    return;
                }
                if (kind == '<' && (Peek(1) == '=' || Peek(1) == '!'))
                {
                    Next();
                    var look = Next();
                    output.Append("(?<").Append((char)look);
                    ParseDisjunction(topLevel: false);
                    CloseGroup();
                    RefuseQuantifier();
                    return;
                }
                if (kind == '<')
                {
                    Next();
                    var name = ParseGroupName();
                    if (!declaredNames.Add(name)) throw Invalid("Duplicate capture group name");
                    output.Append("(?:");
                    ParseDisjunction(topLevel: false);
                    CloseGroup();
                    ParseQuantifier();
                    return;
                }
                if (kind is 'i' or 'm' or 's' or '-') throw Unsupported("a modifier group");
                throw Invalid("Invalid group");
            }
            output.Append("(?:");
            ParseDisjunction(topLevel: false);
            CloseGroup();
            ParseQuantifier();
        }

        private string ParseGroupName()
        {
            var start = position;
            while (!AtEnd && Peek() != '>')
            {
                var c = Next();
                var first = position - start <= 1;
                var ok = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c == '_' || c == '$' || (!first && c >= '0' && c <= '9');
                if (!ok)
                {
                    if (c == '\\' || c > 0x7F) throw Unsupported("a group name outside [A-Za-z_$][A-Za-z0-9_$]*");
                    throw Invalid("Invalid capture group name");
                }
            }
            if (AtEnd || position == start) throw Invalid("Invalid capture group name");
            var name = source.Substring(start, position - start);
            Next();
            return name;
        }

        private void CloseGroup()
        {
            if (AtEnd || Peek() != ')') throw Invalid("Unterminated group");
            Next();
            output.Append(')');
        }

        private bool LooksLikeQuantifier()
        {
            var at = position + 1;
            var digits = 0;
            while (at < source.Length && source[at] >= '0' && source[at] <= '9') { at++; digits++; }
            if (digits == 0) return false;
            if (at < source.Length && source[at] == '}') return true;
            if (at >= source.Length || source[at] != ',') return false;
            at++;
            while (at < source.Length && source[at] >= '0' && source[at] <= '9') at++;
            return at < source.Length && source[at] == '}';
        }

        private void ParseQuantifier()
        {
            if (AtEnd) return;
            var c = Peek();
            if (c is '*' or '+' or '?')
            {
                Next();
                output.Append((char)c);
            }
            else if (c == '{')
            {
                if (!LooksLikeQuantifier()) throw Invalid("Incomplete quantifier");
                Next();
                var min = ReadBound();
                long? max = min;
                var open = false;
                if (Peek() == ',')
                {
                    Next();
                    if (Peek() == '}') open = true;
                    else max = ReadBound();
                }
                Next();
                if (!open && max < min) throw Invalid("numbers out of order in {} quantifier");
                if (min > int.MaxValue || (max.HasValue && max > int.MaxValue)) throw Unsupported("a quantifier bound above 2147483647");
                output.Append('{').Append(min.ToString(CultureInfo.InvariantCulture));
                if (open) output.Append(',');
                else if (max != min) output.Append(',').Append(max!.Value.ToString(CultureInfo.InvariantCulture));
                output.Append('}');
            }
            else
            {
                return;
            }
            if (!AtEnd && Peek() == '?')
            {
                Next();
                output.Append('?');
            }
            if (!AtEnd && (Peek() is '*' or '+' or '?' || (Peek() == '{' && LooksLikeQuantifier()))) throw Invalid("Nothing to repeat");
        }

        private long ReadBound()
        {
            long value = 0;
            while (!AtEnd && Peek() >= '0' && Peek() <= '9')
            {
                value = Math.Min((value * 10) + (Next() - '0'), long.MaxValue / 20);
            }
            return value;
        }

        private void ParseAtom()
        {
            var c = Peek();
            switch (c)
            {
                case '.':
                    Next();
                    output.Append(Negated(LineTerminators));
                    return;
                case '[':
                    ParseClass();
                    return;
                case '\\':
                    ParseAtomEscape();
                    return;
                case '*':
                case '+':
                case '?':
                    throw Invalid("Nothing to repeat");
                case '{':
                    throw Invalid(LooksLikeQuantifier() ? "Nothing to repeat" : "Lone quantifier brackets");
                case '}':
                case ']':
                    throw Invalid("Lone quantifier brackets");
                case ')':
                    throw Invalid("Unmatched ')'");
            }
            EmitCodePoint(Next());
        }

        private void EmitCodePoint(int cp)
        {
            if (cp >= 0xD800 && cp <= 0xDFFF) throw Unsupported("a lone surrogate");
            if (cp > 0xFFFF)
            {
                var text = char.ConvertFromUtf32(cp);
                output.Append("(?:").Append(Escape(text[0])).Append(Escape(text[1])).Append(')');
                return;
            }
            output.Append(Escape(cp));
        }

        private void ParseAtomEscape()
        {
            Next();
            if (AtEnd) throw Invalid("\\ at end of pattern");
            var c = Peek();
            switch (c)
            {
                case 'd': Next(); output.Append(Positive(Digit)); return;
                case 'D': Next(); output.Append(Negated(Digit)); return;
                case 'w': Next(); output.Append(Positive(Word)); return;
                case 'W': Next(); output.Append(Negated(Word)); return;
                case 's': Next(); output.Append(Positive(Space)); return;
                case 'S': Next(); output.Append(Negated(Space)); return;
                case 'p':
                case 'P':
                    throw Unsupported("a Unicode property escape (\\p or \\P)");
                case 'k':
                    Next();
                    if (Peek() != '<') throw Invalid("Invalid named reference");
                    Next();
                    var close = source.IndexOf('>', position);
                    if (close < 0) throw Invalid("Invalid named reference");
                    var name = source.Substring(position, close - position);
                    if (!groupNames.Contains(name)) throw Invalid("Invalid named capture referenced");
                    throw Unsupported("a back-reference");
            }
            if (c >= '1' && c <= '9')
            {
                var start = position;
                long number = 0;
                while (!AtEnd && Peek() >= '0' && Peek() <= '9') number = Math.Min((number * 10) + (Next() - '0'), int.MaxValue);
                position = start;
                if (number > capturingGroups) throw Invalid("Invalid escape");
                throw Unsupported("a back-reference");
            }
            EmitCodePoint(ParseCharacterEscape(inClass: false));
        }

        /// <summary>A <c>CharacterEscape</c> after the backslash, as a code point.</summary>
        private int ParseCharacterEscape(bool inClass)
        {
            var c = Next();
            switch (c)
            {
                case 't': return '\t';
                case 'n': return '\n';
                case 'v': return '\v';
                case 'f': return '\f';
                case 'r': return '\r';
                case 'c':
                    var letter = AtEnd ? -1 : Peek();
                    if ((letter >= 'A' && letter <= 'Z') || (letter >= 'a' && letter <= 'z'))
                    {
                        Next();
                        return letter % 32;
                    }
                    throw Invalid("Invalid unicode escape");
                case '0':
                    if (!AtEnd && Peek() >= '0' && Peek() <= '9') throw Invalid("Invalid decimal escape");
                    return 0;
                case 'x':
                    return ReadHex(2) ?? throw Invalid("Invalid escape");
                case 'u':
                    return ParseUnicodeEscape();
                case '-' when inClass:
                    return '-';
            }
            if (c is '^' or '$' or '\\' or '.' or '*' or '+' or '?' or '(' or ')' or '[' or ']' or '{' or '}' or '|' or '/') return c;
            throw Invalid("Invalid escape");
        }

        private int ParseUnicodeEscape()
        {
            if (Peek() == '{')
            {
                Next();
                long value = 0;
                var digits = 0;
                while (!AtEnd && IsHex(Peek()))
                {
                    value = Math.Min((value * 16) + HexValue(Next()), 0x7FFFFFFF);
                    digits++;
                }
                if (digits == 0 || AtEnd || Peek() != '}' || value > 0x10FFFF) throw Invalid("Invalid Unicode escape");
                Next();
                return (int)value;
            }
            var unit = ReadHex(4) ?? throw Invalid("Invalid Unicode escape");
            if (unit >= 0xD800 && unit <= 0xDBFF && Peek() == '\\' && Peek(1) == 'u')
            {
                var save = position;
                Next();
                Next();
                var low = ReadHex(4);
                if (low is >= 0xDC00 and <= 0xDFFF) return char.ConvertToUtf32((char)unit, (char)low.Value);
                position = save;
            }
            return unit;
        }

        private int? ReadHex(int count)
        {
            if (position + count > source.Length) return null;
            var value = 0;
            for (var i = 0; i < count; i++)
            {
                var h = source[position + i];
                if (!IsHex(h)) return null;
                value = (value * 16) + HexValue(h);
            }
            position += count;
            return value;
        }

        private static bool IsHex(int c) => (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
        private static int HexValue(int c) => c <= '9' ? c - '0' : (c | 0x20) - 'a' + 10;

        private void ParseClass()
        {
            Next();
            var negated = false;
            if (Peek() == '^')
            {
                Next();
                negated = true;
            }
            var ranges = new List<(int Lo, int Hi)>();
            while (true)
            {
                if (AtEnd) throw Invalid("Unterminated character class");
                if (Peek() == ']')
                {
                    Next();
                    break;
                }
                var (lo, loIsClass) = ParseClassAtom(ranges);
                if (!AtEnd && Peek() == '-' && Peek(1) != ']' && Peek(1) != -1)
                {
                    Next();
                    var (hi, hiIsClass) = ParseClassAtom(ranges);
                    if (loIsClass || hiIsClass) throw Invalid("Invalid character class");
                    if (lo > hi) throw Invalid("Range out of order in character class");
                    AddRange(ranges, lo, hi);
                    continue;
                }
                if (!loIsClass) AddRange(ranges, lo, lo);
            }
            ranges.Sort((a, b) => a.Lo.CompareTo(b.Lo));
            if (negated) output.Append(Negated(ranges));
            else output.Append(Positive(ranges));
        }

        private void AddRange(List<(int Lo, int Hi)> ranges, int lo, int hi)
        {
            if (hi > 0xFFFF) throw Unsupported("a character class member outside the Basic Multilingual Plane");
            if (lo <= 0xDFFF && hi >= 0xD800) throw Unsupported("a surrogate code point in a character class");
            ranges.Add((lo, hi));
        }

        /// <summary>One class atom. A class escape (<c>\d</c> and the like) adds its ranges and reports <c>IsClass</c>.</summary>
        private (int CodePoint, bool IsClass) ParseClassAtom(List<(int Lo, int Hi)> ranges)
        {
            var c = Next();
            if (c != '\\') return (c, false);
            if (AtEnd) throw Invalid("\\ at end of pattern");
            var e = Peek();
            switch (e)
            {
                case 'd': Next(); ranges.AddRange(Digit); return (-1, true);
                case 'w': Next(); ranges.AddRange(Word); return (-1, true);
                case 's': Next(); ranges.AddRange(Space); return (-1, true);
                case 'D':
                case 'W':
                case 'S':
                    throw Unsupported("a negated class escape (\\D, \\W or \\S) inside a character class");
                case 'p':
                case 'P':
                    throw Unsupported("a Unicode property escape (\\p or \\P)");
                case 'b':
                    Next();
                    return ('\b', false);
            }
            if (e >= '1' && e <= '9') throw Invalid("Invalid class escape");
            return (ParseCharacterEscape(inClass: true), false);
        }
    }
}
