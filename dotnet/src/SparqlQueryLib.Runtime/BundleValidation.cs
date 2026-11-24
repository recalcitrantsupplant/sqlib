using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using SparqlQueryLib.Runtime.Json;

namespace SparqlQueryLib.Runtime;

/// <summary>
/// The structural checks of <c>assertValidBundle</c> and the hash checks of
/// <c>verifyBundleIntegrity</c>, in <c>bundle.ts</c>. The checks run in the
/// same order and give the same messages.
/// </summary>
internal static class BundleValidation
{
    private static readonly HashSet<string> QueryTypes = new(StringComparer.Ordinal) { "SELECT", "ASK", "CONSTRUCT", "DESCRIBE" };

    private static Exception Fail(string message) => new InvalidBundleException(message);

    private static string S(JsValue value) => Js.ToJsString(value);

    private static bool IsEmptyArgumentMode(JsValue value) =>
        value.StrictEquals("unconstrained") || value.StrictEquals("propagateEmpty") || value.StrictEquals("require");

    /// <summary><c>/^KEYWORD\b/i</c> on the text of a span, without a regular expression engine.</summary>
    private static bool StartsWithKeyword(string text, int start, int end, string keyword)
    {
        if (end - start < keyword.Length) return false;
        for (var i = 0; i < keyword.Length; i++)
        {
            var c = text[start + i];
            if (c >= 'a' && c <= 'z') c = (char)(c - 32);
            if (c != keyword[i]) return false;
        }
        var after = start + keyword.Length;
        if (after == end) return true;
        var next = text[after];
        return !((next >= 'A' && next <= 'Z') || (next >= 'a' && next <= 'z') || (next >= '0' && next <= '9') || next == '_');
    }

    private static string Signature(JsValue vars)
    {
        var names = vars.Items!.ConvertAll(S);
        names.Sort(string.CompareOrdinal);
        return string.Join(" ", names);
    }

    private static bool HasDuplicate(List<JsValue> items)
    {
        for (var i = 0; i < items.Count; i++)
        {
            for (var j = 0; j < i; j++)
            {
                if (items[i].SameValueZero(items[j])) return true;
            }
        }
        return false;
    }

    public static void AssertValidBundle(JsValue bundle)
    {
        if (!bundle.Truthy || !bundle.IsObjectLike) throw Fail("Bundle must be an object.");
        var version = bundle["version"];
        if (!(version.IsNumber && (version.Number == 1 || version.Number == 2)))
        {
            throw Fail($"Unsupported bundle version {S(version)}; this runtime reads versions 1 and 2.");
        }
        var library = bundle["library"];
        if (!library.Truthy || !library["id"].IsString) throw Fail("Bundle is missing library.id.");
        var queries = bundle["queries"];
        if (!queries.Truthy || !queries.IsObjectLike) throw Fail("Bundle is missing its queries map.");

        foreach (var entry in queries.Entries())
        {
            var where = $"Query '{entry.Key}'";
            var query = entry.Value;
            if (!query.Truthy || !query.IsObjectLike) throw Fail($"{where} is not an object.");
            var queryType = query["queryType"];
            if (!(queryType.IsString && QueryTypes.Contains(queryType.Str!)))
            {
                throw Fail($"{where} has unsupported queryType '{S(queryType)}'.");
            }
            AssertValidCompiledEntry(query, where);
            AssertValidExamples(query, where);
        }

        var groups = bundle["groups"];
        if (!groups.IsUndefined)
        {
            if (!groups.Truthy || !groups.IsObjectLike) throw Fail("Bundle groups must be an object.");
            foreach (var entry in groups.Entries()) AssertValidGroup(entry.Value, queries, $"Group '{entry.Key}'");
        }
        AssertValidMap(bundle["etlJobs"], "etlJobs", "ETL job", AssertValidEtlJob);
        AssertValidMap(bundle["ruleSets"], "ruleSets", "Rule set", AssertValidRuleSet);
        AssertValidMap(bundle["updates"], "updates", "Update", (update, where) =>
        {
            if (!update.Truthy || !update.IsObjectLike) throw Fail($"{where} is not an object.");
            AssertValidCompiledEntry(update, where);
        });
    }

    private static void AssertValidMap(JsValue map, string member, string label, Action<JsValue, string> check)
    {
        if (map.IsUndefined) return;
        if (!map.Truthy || !map.IsObjectLike) throw Fail($"Bundle {member} must be an object.");
        foreach (var entry in map.Entries()) check(entry.Value, $"{label} '{entry.Key}'");
    }

    private static void AssertValidCompiledEntry(JsValue entry, string where)
    {
        AssertValidTemplate(entry["template"], where);
        AssertValidPageParameters(entry, where);
        var inferred = entry["inferredInputs"];
        if (!inferred.IsArray) throw Fail($"{where}: inferredInputs must be an array.");
        var slots = entry["template"]["slots"].Items!;
        if (inferred.Items!.Count != slots.Count)
        {
            throw Fail($"{where}: inferredInputs describes {inferred.Items.Count} slots but the template has {slots.Count}.");
        }
        AssertTextHash(entry["textHash"], where);
        AssertValidInputPolicies(entry, where);
    }

    private static void AssertTextHash(JsValue hash, string where)
    {
        if (!hash.IsString || !hash.Str!.StartsWith("sha256-", StringComparison.Ordinal))
        {
            throw Fail($"{where}: textHash must be a 'sha256-<hex>' string.");
        }
    }

    private static void AssertValidTemplate(JsValue template, string where)
    {
        if (!template.Truthy || !template.IsObjectLike) throw Fail($"{where}: template is missing.");
        var textValue = template["text"];
        if (!textValue.IsString || textValue.Str!.Length == 0) throw Fail($"{where}: template.text must be a non-empty string.");
        var text = textValue.Str;
        var slots = template["slots"];
        if (!slots.IsArray) throw Fail($"{where}: template.slots must be an array.");
        if (!template["prefixes"].IsArray) throw Fail($"{where}: template.prefixes must be an array.");

        double previousEnd = 0;
        for (var index = 0; index < slots.Items!.Count; index++)
        {
            var slot = slots.Items[index];
            var at = $"{where}: slot {index}";
            var start = slot["start"];
            var end = slot["end"];
            if (!start.IsInteger || !end.IsInteger) throw Fail($"{at} has non-integer bounds.");
            if (start.Number < 0 || end.Number > text.Length || start.Number >= end.Number)
            {
                throw Fail($"{at} spans [{S(start)}, {S(end)}) which is outside the template text.");
            }
            if (start.Number < previousEnd) throw Fail($"{at} overlaps the previous slot; slots must be ordered and disjoint.");
            previousEnd = end.Number;
            var vars = slot["vars"];
            if (!vars.IsArray || vars.Items!.Count == 0) throw Fail($"{at} declares no variables.");
            if (!vars.Items.TrueForAll(v => SparqlTerms.IsSafeVariableName(S(v))))
            {
                throw Fail($"{at} declares a variable name the runtime cannot emit.");
            }
            if (HasDuplicate(vars.Items)) throw Fail($"{at} declares a duplicate variable.");
            if (!StartsWithKeyword(text, (int)start.Number, (int)end.Number, "VALUES"))
            {
                throw Fail($"{at} does not start at a VALUES keyword; the bundle has been edited.");
            }
        }
    }

    private static void AssertValidPageParameters(JsValue query, string where)
    {
        var spans = query["pageParameters"];
        if (spans.IsUndefined) return;
        if (!spans.IsArray) throw Fail($"{where}: pageParameters must be an array.");

        var text = query["template"]["text"].Str!;
        var slots = query["template"]["slots"].Items!;
        foreach (var span in spans.Items!)
        {
            var at = $"{where}: page parameter '{S(span["name"])}'";
            var kind = span["kind"];
            if (!kind.StrictEquals("limit") && !kind.StrictEquals("offset")) throw Fail($"{at} has an unknown kind.");
            var start = span["start"];
            var end = span["end"];
            if (!start.IsInteger || !end.IsInteger || start.Number >= end.Number) throw Fail($"{at} has invalid bounds.");
            if (start.Number < 0 || end.Number > text.Length) throw Fail($"{at} lies outside the template text.");
            var keyword = kind.Str == "limit" ? "LIMIT" : "OFFSET";
            if (!StartsWithKeyword(text, (int)start.Number, (int)end.Number, keyword))
            {
                throw Fail($"{at} does not start at a {keyword} keyword; the bundle has been edited.");
            }
            foreach (var slot in slots)
            {
                if (start.Number < slot["end"].Number && slot["start"].Number < end.Number) throw Fail($"{at} overlaps a parameter slot.");
            }
        }

        var sorted = spans.Items.OrderBy(span => span["start"].Number).ToList();
        for (var i = 1; i < sorted.Count; i++)
        {
            if (sorted[i]["start"].Number < sorted[i - 1]["end"].Number) throw Fail($"{where}: page parameter spans overlap each other.");
        }
    }

    private static void AssertValidInputPolicies(JsValue query, string where)
    {
        var policies = query["inputPolicies"];
        if (policies.IsUndefined) return;
        if (!policies.IsArray) throw Fail($"{where}: inputPolicies must be an array.");
        var declared = new HashSet<string>(StringComparer.Ordinal);
        foreach (var slot in query["template"]["slots"].Items!) declared.Add(Signature(slot["vars"]));
        for (var index = 0; index < policies.Items!.Count; index++)
        {
            var policy = policies.Items[index];
            var at = $"{where} inputPolicies[{index}]";
            var vars = policy["vars"];
            if (!policy.Truthy || !vars.IsArray || !vars.Items!.TrueForAll(v => v.IsString)) throw Fail($"{at} must name its slot's variables.");
            if (!declared.Contains(Signature(vars))) throw Fail($"{at} names a slot the template does not declare.");
            var whenEmpty = policy["whenEmpty"];
            var valuePattern = policy["valuePattern"];
            if (whenEmpty.IsUndefined && valuePattern.IsUndefined) throw Fail($"{at} sets neither whenEmpty nor valuePattern.");
            if (!whenEmpty.IsUndefined && !IsEmptyArgumentMode(whenEmpty)) throw Fail($"{at} has an unknown whenEmpty mode '{S(whenEmpty)}'.");
            if (!valuePattern.IsUndefined)
            {
                try
                {
                    ValuePattern.Compile(valuePattern.IsString ? valuePattern.Str! : string.Empty);
                }
                catch (InvalidValuePatternException error)
                {
                    throw new InvalidBundleException($"{at}: {error.Message}", error);
                }
            }
        }
    }

    private static void AssertValidExamples(JsValue query, string where)
    {
        var examples = query["examples"];
        if (examples.IsUndefined) return;
        if (!examples.IsArray) throw Fail($"{where}: examples must be an array.");
        var slotCount = query["template"]["slots"].Items!.Count;
        for (var index = 0; index < examples.Items!.Count; index++)
        {
            var example = examples.Items[index];
            var at = $"{where}: example {index}";
            if (!example.Truthy || !example.IsObjectLike) throw Fail($"{at} is not an object.");
            var name = example["name"];
            if (!name.IsString || name.Str!.Length == 0) throw Fail($"{at} has no name.");
            var arguments = example["arguments"];
            if (!arguments.IsArray) throw Fail($"{at} has no arguments array.");
            if (arguments.Items!.Count > slotCount)
            {
                throw Fail(
                    $"{at} ('{name.Str}') supplies {arguments.Items.Count} argument sets but the query has only {slotCount} parameter slots.");
            }
        }
    }

    private static bool SameOrder(JsValue a, JsValue b)
    {
        if (!a.IsArray || !b.IsArray || a.Items!.Count != b.Items!.Count) return false;
        for (var i = 0; i < a.Items.Count; i++)
        {
            if (!a.Items[i].StrictEquals(b.Items[i])) return false;
        }
        return true;
    }

    private static void AssertValidGroup(JsValue group, JsValue queries, string where)
    {
        if (!group.Truthy || !group.IsObjectLike) throw Fail($"{where} is not an object.");
        var nodes = group["nodes"];
        if (!nodes.Truthy || !nodes.IsObjectLike) throw Fail($"{where} is missing its nodes map.");
        var edges = group["edges"];
        if (!edges.IsArray) throw Fail($"{where}: edges must be an array.");

        var nodeKeys = nodes.Entries().Select(e => e.Key).ToList();
        if (nodeKeys.Count == 0) throw Fail($"{where} has no nodes.");

        foreach (var entry in nodes.Entries())
        {
            var at = $"{where}: node '{entry.Key}'";
            var node = entry.Value;
            if (!node.Truthy || !node.IsObjectLike) throw Fail($"{at} is not an object.");
            var query = node["query"];
            if (!query.IsString || !queries[query.Str!].Truthy)
            {
                throw Fail($"{at} names query '{S(node["query"])}', which the bundle does not carry.");
            }
        }

        var resultNode = group["resultNode"];
        if (!resultNode.IsString || !nodes[resultNode.Str!].Truthy)
        {
            throw Fail($"{where}: resultNode '{S(resultNode)}' is not one of its nodes.");
        }

        for (var index = 0; index < edges.Items!.Count; index++)
        {
            var edge = edges.Items[index];
            var at = $"{where}: edge {index}";
            if (!edge.Truthy || !edge.IsObjectLike) throw Fail($"{at} is not an object.");
            var source = nodes[S(edge["from"])];
            var target = nodes[S(edge["to"])];
            if (!source.Truthy) throw Fail($"{at} comes from '{S(edge["from"])}', which is not one of its nodes.");
            if (!target.Truthy) throw Fail($"{at} goes to '{S(edge["to"])}', which is not one of its nodes.");
            if (edge["from"].StrictEquals(edge["to"])) throw Fail($"{at} is a self-loop.");

            var sourceQuery = queries[source["query"].Str!];
            if (!sourceQuery["queryType"].StrictEquals("SELECT"))
            {
                throw Fail($"{at} chains a {S(sourceQuery["queryType"])}, which produces no rows to splice.");
            }

            var targetVars = edge["targetVars"];
            if (!targetVars.IsArray || targetVars.Items!.Count == 0) throw Fail($"{at} declares no target variables.");
            if (!targetVars.Items.TrueForAll(v => SparqlTerms.IsSafeVariableName(S(v))))
            {
                throw Fail($"{at} declares a variable name the runtime cannot emit.");
            }
            if (HasDuplicate(targetVars.Items)) throw Fail($"{at} declares a duplicate target variable.");
            var targetName = target["query"].Str!;
            var targetQuery = queries[targetName];
            if (!targetQuery["template"]["slots"].Items!.Any(slot => SameOrder(slot["vars"], targetVars)))
            {
                throw Fail(
                    $"{at} fills [{string.Join(", ", targetVars.Items.Select(v => v.IsNullish ? string.Empty : S(v)))}], which query '{targetName}' does not declare as a parameter slot.");
            }

            var mappings = edge["mappings"];
            if (!mappings.IsArray) throw Fail($"{at}: mappings must be an array.");
            var targets = new List<JsValue>();
            foreach (var mapping in mappings.Items!)
            {
                if (!mapping["source"].IsString || !mapping["target"].IsString) throw Fail($"{at} has a mapping that is not a source/target pair.");
                var mapped = mapping["target"];
                if (!targetVars.Items.Any(v => v.SameValueZero(mapped)))
                {
                    throw Fail($"{at} maps to '{mapped.Str}', which is not one of its target variables.");
                }
                if (targets.Any(t => t.SameValueZero(mapped))) throw Fail($"{at} maps to '{mapped.Str}' twice.");
                targets.Add(mapped);
            }

            var whenEmpty = edge["whenEmpty"];
            if (!whenEmpty.IsUndefined && !IsEmptyArgumentMode(whenEmpty)) throw Fail($"{at} has an unknown whenEmpty mode '{S(whenEmpty)}'.");
        }

        var indegree = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var key in nodeKeys) indegree[key] = 0;
        foreach (var edge in edges.Items)
        {
            var to = S(edge["to"]);
            indegree[to] = (indegree.TryGetValue(to, out var count) ? count : 0) + 1;
        }
        var ready = new Queue<string>(nodeKeys.Where(key => indegree[key] == 0));
        var visited = 0;
        while (ready.Count > 0)
        {
            var key = ready.Dequeue();
            visited++;
            foreach (var edge in edges.Items)
            {
                if (S(edge["from"]) != key) continue;
                var to = S(edge["to"]);
                var remaining = (indegree.TryGetValue(to, out var count) ? count : 0) - 1;
                indegree[to] = remaining;
                if (remaining == 0) ready.Enqueue(to);
            }
        }
        if (visited != nodeKeys.Count) throw Fail($"{where} contains a cycle, so it cannot be walked.");
    }

    private static void AssertValidEtlJob(JsValue job, string where)
    {
        if (!job.Truthy || !job.IsObjectLike) throw Fail($"{where} is not an object.");
        AssertValidTemplate(job["template"], where);
        var slots = job["template"]["slots"].Items!;
        if (slots.Count != 1)
        {
            throw Fail($"{where}: the template needs exactly one parameter slot for the rows; it has {slots.Count}.");
        }
        AssertTextHash(job["textHash"], where);
        var sql = job["sql"];
        if (!sql.IsString || Js.Trim(sql.Str!).Length == 0) throw Fail($"{where}: sql must be a non-empty string.");
        var columns = job["columns"];
        if (!columns.IsArray || columns.Items!.Count == 0) throw Fail($"{where}: columns must be a non-empty array.");
        var slotVars = slots[0]["vars"].Items!;
        for (var index = 0; index < columns.Items.Count; index++)
        {
            var column = columns.Items[index];
            var at = $"{where}: column {index}";
            if (!column.Truthy || !column.IsObjectLike) throw Fail($"{at} is not an object.");
            var columnName = column["columnName"];
            if (!columnName.IsString || columnName.Str!.Length == 0) throw Fail($"{at} has no columnName.");
            var termType = column["termType"];
            if (!termType.StrictEquals("uri") && !termType.StrictEquals("literal")) throw Fail($"{at} has an unknown termType.");
            var variable = column["targetVariable"].IsNullish ? columnName : column["targetVariable"];
            if (!slotVars.Any(v => v.SameValueZero(variable)))
            {
                throw Fail($"{at} binds ?{S(variable)}, which the template's slot does not declare.");
            }
        }
        var chunkSize = job["chunkSize"];
        if (!chunkSize.IsUndefined && (!chunkSize.IsInteger || chunkSize.Number < 1)) throw Fail($"{where}: chunkSize must be a positive integer.");
    }

    private static void AssertValidRuleSet(JsValue ruleSet, string where)
    {
        if (!ruleSet.Truthy || !ruleSet.IsObjectLike) throw Fail($"{where} is not an object.");
        var srl = ruleSet["srl"];
        if (!srl.IsString || Js.Trim(srl.Str!).Length == 0) throw Fail($"{where}: srl must be a non-empty string.");
        AssertTextHash(ruleSet["textHash"], where);
    }

    /// <summary><c>sha256-</c> plus the lowercase hex SHA-256 of the UTF-8 bytes. A lone surrogate encodes as U+FFFD, as <c>TextEncoder</c> does.</summary>
    public static string HashText(string text)
    {
        using var sha = SHA256.Create();
        var digest = sha.ComputeHash(Encoding.UTF8.GetBytes(text));
        var builder = new StringBuilder("sha256-", 7 + 64);
        foreach (var b in digest) builder.Append(b.ToString("x2", System.Globalization.CultureInfo.InvariantCulture));
        return builder.ToString();
    }

    public static void VerifyIntegrity(JsValue bundle)
    {
        foreach (var entry in bundle["queries"].Entries())
        {
            if (HashText(entry.Value["template"]["text"].Str!) != entry.Value["textHash"].Str)
            {
                throw Fail(
                    $"Query '{entry.Key}' does not match its recorded hash: the template text has been edited, which invalidates its parameter slot offsets. Re-export the bundle.");
            }
        }
        foreach (var entry in bundle["updates"].Entries())
        {
            if (HashText(entry.Value["template"]["text"].Str!) != entry.Value["textHash"].Str)
            {
                throw Fail(
                    $"Update '{entry.Key}' does not match its recorded hash: the template text has been edited, which invalidates its parameter slot offsets. Re-export the bundle.");
            }
        }
        foreach (var entry in bundle["etlJobs"].Entries())
        {
            if (HashText(entry.Value["template"]["text"].Str!) != entry.Value["textHash"].Str)
            {
                throw Fail(
                    $"ETL job '{entry.Key}' does not match its recorded hash: the template text has been edited, which invalidates its parameter slot offsets. Re-export the bundle.");
            }
        }
        foreach (var entry in bundle["ruleSets"].Entries())
        {
            if (HashText(entry.Value["srl"].Str!) != entry.Value["textHash"].Str)
            {
                throw Fail($"Rule set '{entry.Key}' does not match its recorded hash: the SRL document has been edited. Re-export the bundle.");
            }
        }
    }
}
