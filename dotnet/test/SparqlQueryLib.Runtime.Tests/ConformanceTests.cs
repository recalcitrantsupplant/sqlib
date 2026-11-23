using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Xunit;

namespace SparqlQueryLib.Runtime.Tests;

public class ConformanceTests
{
    public static IEnumerable<object[]> LoadCases => Goldens.Names("load");
    public static IEnumerable<object[]> CallCases => Goldens.Names("calls");
    public static IEnumerable<object[]> PatternCases => Goldens.Names("valuePatterns");

    [Theory]
    [MemberData(nameof(LoadCases))]
    public void Load(string name) => Assert.Null(Goldens.RunLoad(name));

    [Theory]
    [MemberData(nameof(CallCases))]
    public void Call(string name) => Assert.Null(Goldens.RunCall(name));

    [Theory]
    [MemberData(nameof(PatternCases))]
    public void Pattern(string name) => Assert.Null(Goldens.RunPattern(name));

    [Fact]
    public void GoldensCoverEverySection()
    {
        Assert.True(LoadCases.Count() >= 50);
        Assert.True(CallCases.Count() >= 120);
        Assert.True(PatternCases.Count() >= 90);
    }

    [Theory]
    [InlineData("tr-TR")]
    [InlineData("ar-SA")]
    [InlineData("de-DE")]
    public void EveryCaseUnderCulture(string culture)
    {
        var previous = CultureInfo.CurrentCulture;
        var previousUi = CultureInfo.CurrentUICulture;
        try
        {
            CultureInfo.CurrentCulture = new CultureInfo(culture);
            CultureInfo.CurrentUICulture = new CultureInfo(culture);
            var failures = new List<string>();
            foreach (var name in LoadCases.Select(c => (string)c[0]))
            {
                if (Goldens.RunLoad(name) is { } failure) failures.Add($"{name}: {failure}");
            }
            foreach (var name in CallCases.Select(c => (string)c[0]))
            {
                if (Goldens.RunCall(name) is { } failure) failures.Add($"{name}: {failure}");
            }
            foreach (var name in PatternCases.Select(c => (string)c[0]))
            {
                if (Goldens.RunPattern(name) is { } failure) failures.Add($"{name}: {failure}");
            }
            Assert.Empty(failures);
        }
        finally
        {
            CultureInfo.CurrentCulture = previous;
            CultureInfo.CurrentUICulture = previousUi;
        }
    }
}
