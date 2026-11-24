using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace SparqlQueryLib.Runtime.Json;

/// <summary>A JSON text that <c>JSON.parse</c> would refuse.</summary>
public sealed class JsonSyntaxException : FormatException
{
    internal JsonSyntaxException(string message) : base(message) { }
}

/// <summary>
/// A JSON reader with the results of <c>JSON.parse</c>.
/// </summary>
/// <remarks>
/// <c>System.Text.Json</c> differs from <c>JSON.parse</c> on inputs that a
/// bundle or payload can hold: it refuses an escaped lone surrogate, and its
/// object model does not give JavaScript key order. This reader keeps a lone
/// surrogate, keeps the last value of a repeated key, and reads every number
/// as a double.
/// </remarks>
internal static class JsonText
{
    public static JsValue Parse(string text)
    {
        var reader = new Reader(text);
        reader.SkipWhiteSpace();
        var value = reader.ReadValue(0);
        reader.SkipWhiteSpace();
        if (!reader.AtEnd) throw reader.Error("Unexpected text after the JSON value");
        return value;
    }

    private sealed class Reader
    {
        private const int MaxDepth = 512;
        private readonly string text;
        private int position;

        public Reader(string text)
        {
            this.text = text;
            if (text.Length > 0 && text[0] == '\uFEFF') position = 1;
        }

        public bool AtEnd => position >= text.Length;

        public JsonSyntaxException Error(string message) =>
            new($"{message} at position {position.ToString(CultureInfo.InvariantCulture)}.");

        public void SkipWhiteSpace()
        {
            while (position < text.Length && text[position] is ' ' or '\t' or '\n' or '\r') position++;
        }

        public JsValue ReadValue(int depth)
        {
            if (depth > MaxDepth) throw Error("JSON nests too deeply");
            if (AtEnd) throw Error("Unexpected end of JSON input");
            var c = text[position];
            switch (c)
            {
                case '{': return ReadObject(depth);
                case '[': return ReadArray(depth);
                case '"': return JsValue.FromString(ReadString());
                case 't': Expect("true"); return JsValue.True;
                case 'f': Expect("false"); return JsValue.False;
                case 'n': Expect("null"); return JsValue.Null;
                default:
                    if (c == '-' || (c >= '0' && c <= '9')) return ReadNumber();
                    throw Error($"Unexpected character '{c}'");
            }
        }

        private void Expect(string word)
        {
            if (string.CompareOrdinal(text, position, word, 0, word.Length) != 0) throw Error("Unexpected token");
            position += word.Length;
        }

        private JsValue ReadObject(int depth)
        {
            position++;
            var obj = new JsObject();
            SkipWhiteSpace();
            if (!AtEnd && text[position] == '}')
            {
                position++;
                return JsValue.FromObject(obj);
            }
            while (true)
            {
                SkipWhiteSpace();
                if (AtEnd || text[position] != '"') throw Error("Expected a property name");
                var key = ReadString();
                SkipWhiteSpace();
                if (AtEnd || text[position] != ':') throw Error("Expected ':'");
                position++;
                SkipWhiteSpace();
                obj.Set(key, ReadValue(depth + 1));
                SkipWhiteSpace();
                if (AtEnd) throw Error("Unexpected end of JSON input");
                if (text[position] == ',')
                {
                    position++;
                    continue;
                }
                if (text[position] == '}')
                {
                    position++;
                    return JsValue.FromObject(obj);
                }
                throw Error("Expected ',' or '}'");
            }
        }

        private JsValue ReadArray(int depth)
        {
            position++;
            var items = new List<JsValue>();
            SkipWhiteSpace();
            if (!AtEnd && text[position] == ']')
            {
                position++;
                return JsValue.FromArray(items);
            }
            while (true)
            {
                SkipWhiteSpace();
                items.Add(ReadValue(depth + 1));
                SkipWhiteSpace();
                if (AtEnd) throw Error("Unexpected end of JSON input");
                if (text[position] == ',')
                {
                    position++;
                    continue;
                }
                if (text[position] == ']')
                {
                    position++;
                    return JsValue.FromArray(items);
                }
                throw Error("Expected ',' or ']'");
            }
        }

        private string ReadString()
        {
            position++;
            var builder = new StringBuilder();
            while (true)
            {
                if (AtEnd) throw Error("Unterminated string");
                var c = text[position++];
                if (c == '"') return builder.ToString();
                if (c < 0x20) throw Error("Control character in string");
                if (c != '\\')
                {
                    builder.Append(c);
                    continue;
                }
                if (AtEnd) throw Error("Unterminated string");
                var escape = text[position++];
                switch (escape)
                {
                    case '"': builder.Append('"'); break;
                    case '\\': builder.Append('\\'); break;
                    case '/': builder.Append('/'); break;
                    case 'b': builder.Append('\b'); break;
                    case 'f': builder.Append('\f'); break;
                    case 'n': builder.Append('\n'); break;
                    case 'r': builder.Append('\r'); break;
                    case 't': builder.Append('\t'); break;
                    case 'u':
                        if (position + 4 > text.Length) throw Error("Bad Unicode escape");
                        var code = 0;
                        for (var i = 0; i < 4; i++)
                        {
                            var h = text[position + i];
                            var digit = h >= '0' && h <= '9' ? h - '0'
                                : h >= 'a' && h <= 'f' ? h - 'a' + 10
                                : h >= 'A' && h <= 'F' ? h - 'A' + 10
                                : -1;
                            if (digit < 0) throw Error("Bad Unicode escape");
                            code = (code * 16) + digit;
                        }
                        position += 4;
                        builder.Append((char)code);
                        break;
                    default:
                        throw Error("Bad escaped character");
                }
            }
        }

        private JsValue ReadNumber()
        {
            var start = position;
            if (text[position] == '-') position++;
            if (AtEnd) throw Error("No number after minus sign");
            if (text[position] == '0')
            {
                position++;
            }
            else if (text[position] >= '1' && text[position] <= '9')
            {
                while (!AtEnd && text[position] >= '0' && text[position] <= '9') position++;
            }
            else
            {
                throw Error("No number after minus sign");
            }
            if (!AtEnd && text[position] == '.')
            {
                position++;
                var digitsAt = position;
                while (!AtEnd && text[position] >= '0' && text[position] <= '9') position++;
                if (position == digitsAt) throw Error("Unterminated fractional number");
            }
            if (!AtEnd && (text[position] == 'e' || text[position] == 'E'))
            {
                position++;
                if (!AtEnd && (text[position] == '+' || text[position] == '-')) position++;
                var digitsAt = position;
                while (!AtEnd && text[position] >= '0' && text[position] <= '9') position++;
                if (position == digitsAt) throw Error("Exponent part is missing a number");
            }
            var token = text.Substring(start, position - start);
            // .NET Core 3.0 and later round to nearest and give infinity on overflow, as JavaScript does.
            double value;
            try
            {
                value = double.Parse(token, NumberStyles.Float, CultureInfo.InvariantCulture);
            }
            catch (OverflowException)
            {
                // .NET Framework throws where JavaScript gives an infinity.
                value = token[0] == '-' ? double.NegativeInfinity : double.PositiveInfinity;
            }
            return JsValue.FromNumber(value);
        }
    }
}
