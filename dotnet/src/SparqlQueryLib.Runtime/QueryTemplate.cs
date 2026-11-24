using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;

namespace SparqlQueryLib.Runtime;

/// <summary>One parameter slot: the half-open span <c>[Start, End)</c> of the template text, in UTF-16 code units.</summary>
public sealed class TemplateSlot
{
    internal TemplateSlot(int start, int end, IReadOnlyList<string> vars)
    {
        Start = start;
        End = end;
        Vars = vars;
    }

    public int Start { get; }
    public int End { get; }

    /// <summary>The declared variables, in the order the rendered block lists them.</summary>
    public IReadOnlyList<string> Vars { get; }
}

/// <summary>A compiled query: the canonical text, its parameter slots, and its prefix table.</summary>
public sealed class QueryTemplate
{
    internal QueryTemplate(string text, IReadOnlyList<TemplateSlot> slots, IReadOnlyList<KeyValuePair<string, string>> prefixes)
    {
        Text = text;
        Slots = slots;
        Prefixes = prefixes;
    }

    public string Text { get; }
    public IReadOnlyList<TemplateSlot> Slots { get; }

    /// <summary>Prefix label and namespace pairs, in bundle order.</summary>
    public IReadOnlyList<KeyValuePair<string, string>> Prefixes { get; }
}

/// <summary>The query author's rule for one slot: what no rows mean, and a pattern that every bound value must match.</summary>
public sealed class SlotPolicy
{
    internal SlotPolicy(IReadOnlyList<string> vars, string? whenEmpty, string? valuePattern)
    {
        Vars = vars;
        WhenEmpty = whenEmpty;
        ValuePattern = valuePattern;
    }

    public IReadOnlyList<string> Vars { get; }

    /// <summary><c>unconstrained</c>, <c>propagateEmpty</c>, <c>require</c>, or null for the built-in reading.</summary>
    public string? WhenEmpty { get; }

    /// <summary>A JavaScript regular expression in Unicode mode, or null.</summary>
    public string? ValuePattern { get; }
}

/// <summary>Slot matching and substitution. Port of <c>query-template.ts</c>.</summary>
internal static class Substitution
{
    public const string AuthUser = "authUser";
    public const string AuthGroup = "authGroup";

    public static bool IsReserved(string name) => name == AuthUser || name == AuthGroup;

    public static string DescribeSlot(IEnumerable<string> vars) => string.Join(", ", vars.Select(v => "?" + v));

    private static string Signature(IEnumerable<string> vars)
    {
        var sorted = vars.ToList();
        sorted.Sort(string.CompareOrdinal);
        return string.Join(" ", sorted);
    }

    private static string Index(int value) => value.ToString(CultureInfo.InvariantCulture);

    /// <summary>
    /// Fill the identity slots. An exported bundle runs with no signed-in caller,
    /// so each identity slot gets zero rows.
    /// </summary>
    private static List<ArgSet> WithCallerArguments(IReadOnlyList<IReadOnlyList<string>> slotVars, IReadOnlyList<ArgSet> argumentSets)
    {
        foreach (var set in argumentSets)
        {
            var named = set.Vars.Where(IsReserved).ToList();
            if (named.Count > 0)
            {
                throw new ReservedSlotException($"{DescribeSlot(named)} is filled from the caller's sign-in. An argument cannot set it.");
            }
        }
        var filled = argumentSets.ToList();
        foreach (var vars in slotVars)
        {
            var reserved = vars.Where(IsReserved).ToList();
            if (reserved.Count == 0) continue;
            if (vars.Count > 1)
            {
                throw new ReservedSlotException(
                    $"{DescribeSlot(reserved)} must be declared on its own, as VALUES ?{reserved[0]} {{ UNDEF }}, not inside VALUES ({DescribeSlot(vars)}).");
            }
            filled.Add(new ArgSet(new[] { reserved[0] }, Array.Empty<IReadOnlyDictionary<string, TermValue>>(), "propagateEmpty"));
        }
        return filled;
    }

    /// <summary>Pair argument sets with slots by sorted variable names, in slot order. The first unclaimed match wins.</summary>
    private static (ArgSet?[] Slots, List<ArgSet> Unmatched) Assign(IReadOnlyList<IReadOnlyList<string>> slotVars, IReadOnlyList<ArgSet> sets)
    {
        var taken = new bool[sets.Count];
        var signatures = sets.Select(s => Signature(s.Vars)).ToArray();
        var slots = new ArgSet?[slotVars.Count];
        for (var i = 0; i < slotVars.Count; i++)
        {
            var wanted = Signature(slotVars[i]);
            for (var j = 0; j < sets.Count; j++)
            {
                if (taken[j] || signatures[j] != wanted) continue;
                taken[j] = true;
                slots[i] = sets[j];
                break;
            }
        }
        var unmatched = new List<ArgSet>();
        for (var j = 0; j < sets.Count; j++)
        {
            if (!taken[j]) unmatched.Add(sets[j]);
        }
        return (slots, unmatched);
    }

    private static void CheckValuePatterns(IReadOnlyList<string> slotVars, ArgSet set, string pattern, TimeSpan timeout)
    {
        var regex = ValuePattern.Compile(pattern, timeout);
        foreach (var row in set.Rows)
        {
            foreach (var name in slotVars)
            {
                if (!row.TryGetValue(name, out var cell)) continue;
                if (!regex.IsMatch(cell.Value))
                {
                    throw new SlotMismatchException(
                        $"Value {Json.Js.Quote(cell.Value)} for ?{name} does not match the pattern {pattern} that the query sets for it.");
                }
            }
        }
    }

    /// <summary>One argument set per slot, in slot order, with the author's policies applied.</summary>
    private static List<ArgSet> Complete(
        IReadOnlyList<IReadOnlyList<string>> slotVars,
        IReadOnlyList<ArgSet> suppliedSets,
        IReadOnlyList<SlotPolicy> slotPolicies,
        TimeSpan patternTimeout)
    {
        var argumentSets = WithCallerArguments(slotVars, suppliedSets);
        var (slots, unmatched) = Assign(slotVars, argumentSets);
        if (unmatched.Count > 0)
        {
            static string Describe(IEnumerable<string> vars) => "[" + string.Join(", ", vars) + "]";
            var declared = slotVars.Count > 0 ? string.Join(", ", slotVars.Select(Describe)) : "no VALUES parameters";
            throw new SlotMismatchException(
                $"Argument {string.Join(", ", unmatched.Select(set => Describe(set.Vars)))} matches no VALUES parameter left to fill. The query declares {declared}.");
        }

        var policies = new Dictionary<string, string?>(StringComparer.Ordinal);
        var patterns = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var policy in slotPolicies)
        {
            var key = Signature(policy.Vars);
            policies[key] = policy.WhenEmpty;
        }
        foreach (var policy in slotPolicies)
        {
            if (!string.IsNullOrEmpty(policy.ValuePattern)) patterns[Signature(policy.Vars)] = policy.ValuePattern!;
        }

        for (var index = 0; index < slots.Length; index++)
        {
            var set = slots[index];
            if (set != null && patterns.TryGetValue(Signature(slotVars[index]), out var pattern))
            {
                CheckValuePatterns(slotVars[index], set, pattern, patternTimeout);
            }
        }

        var ordered = new List<ArgSet>(slots.Length);
        for (var index = 0; index < slots.Length; index++)
        {
            var set = slots[index];
            policies.TryGetValue(Signature(slotVars[index]), out var policy);
            if (set == null)
            {
                ordered.Add(new ArgSet(slotVars[index].ToList(), Array.Empty<IReadOnlyDictionary<string, TermValue>>(), policy ?? "unconstrained"));
                continue;
            }
            if (policy == null)
            {
                ordered.Add(set);
                continue;
            }
            if (set.WhenEmpty == null)
            {
                ordered.Add(set.WithWhenEmpty(policy));
                continue;
            }
            if (set.WhenEmpty == "unconstrained" && policy != "unconstrained")
            {
                throw new SlotMismatchException(
                    $"VALUES clause {Index(index + 1)} ({DescribeSlot(slotVars[index])}) is marked '{policy}' by its query and cannot be run unconstrained.");
            }
            ordered.Add(set);
        }
        return ordered;
    }

    /// <summary>Apply argument sets to a template and return the query text. Port of <c>applyTemplateArguments</c>.</summary>
    public static string Apply(QueryTemplate template, IReadOnlyList<ArgSet> argumentSets, IReadOnlyList<SlotPolicy> slotPolicies, TimeSpan patternTimeout)
    {
        var slotVars = template.Slots.Select(slot => slot.Vars).ToList();
        var ordered = Complete(slotVars, argumentSets, slotPolicies, patternTimeout);

        var output = new StringBuilder(template.Text.Length + 64);
        var cursor = 0;
        for (var index = 0; index < template.Slots.Count; index++)
        {
            var slot = template.Slots[index];
            var argSet = ordered[index];

            var patternVars = slot.Vars.ToList();
            patternVars.Sort(string.CompareOrdinal);
            var argVars = argSet.Vars.ToList();
            argVars.Sort(string.CompareOrdinal);
            if (!patternVars.SequenceEqual(argVars, StringComparer.Ordinal))
            {
                throw new SlotMismatchException(
                    $"Variable mismatch for VALUES clause {Index(index + 1)}. Query expects [{string.Join(", ", patternVars)}], arguments provide [{string.Join(", ", argVars)}].");
            }

            var rows = argSet.Rows;
            var wildcardRows = rows.Count(row => row.Count == 0);
            if (rows.Count > 1 && wildcardRows > 0)
            {
                throw new SlotMismatchException(
                    $"Invalid bindings for VALUES clause {Index(index + 1)}: an all-UNDEF row cannot be mixed with bound rows.");
            }
            var isWildcard = rows.Count == 1 && wildcardRows == 1;

            string replacement;
            if (rows.Count == 0 || isWildcard)
            {
                var mode = argSet.WhenEmpty ?? (isWildcard ? "unconstrained" : "propagateEmpty");
                if (mode == "require")
                {
                    throw new SlotMismatchException(
                        $"Required input for VALUES clause {Index(index + 1)} ({DescribeSlot(slot.Vars)}) received no bindings.");
                }
                replacement = mode == "unconstrained"
                    ? string.Empty
                    : SparqlTerms.RenderValuesBlock(slot.Vars, Array.Empty<IReadOnlyDictionary<string, TermValue>>(), index, template.Prefixes);
            }
            else
            {
                replacement = SparqlTerms.RenderValuesBlock(slot.Vars, rows, index, template.Prefixes);
            }

            output.Append(template.Text, cursor, slot.Start - cursor).Append(replacement);
            cursor = slot.End;
        }
        output.Append(template.Text, cursor, template.Text.Length - cursor);
        return output.ToString();
    }
}
