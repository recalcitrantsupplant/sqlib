using System;

namespace SparqlQueryLib.Runtime;

/// <summary>
/// The base of every refusal this library raises.
/// </summary>
/// <remarks>
/// Each subclass matches one error class of <c>@sparql-query-lib/runtime</c>,
/// named in <see cref="TypeScriptName"/>. The message is the same text the
/// TypeScript runtime gives for the same bundle and payload.
/// </remarks>
public abstract class SqlibRuntimeException : Exception
{
    private protected SqlibRuntimeException(string message, Exception? inner = null) : base(message, inner) { }

    /// <summary>The <c>name</c> of the matching TypeScript error.</summary>
    public abstract string TypeScriptName { get; }
}

/// <summary>The bundle is malformed, edited, or of an unsupported format version.</summary>
public sealed class InvalidBundleException : SqlibRuntimeException
{
    public InvalidBundleException(string message, Exception? inner = null) : base(message, inner) { }
    public override string TypeScriptName => "InvalidBundleError";
}

/// <summary>An argument is not a usable SPARQL Results JSON document.</summary>
public sealed class InvalidArgumentException : SqlibRuntimeException
{
    public InvalidArgumentException(string message) : base(message) { }
    public override string TypeScriptName => "InvalidArgumentError";
}

/// <summary>An argument value cannot be written as a SPARQL term.</summary>
public sealed class InvalidTermException : SqlibRuntimeException
{
    public InvalidTermException(string message) : base(message) { }
    public override string TypeScriptName => "InvalidTermError";
}

/// <summary>A LIMIT or OFFSET value is not a non-negative integer up to 2^53-1.</summary>
public sealed class InvalidParameterException : SqlibRuntimeException
{
    public InvalidParameterException(string message) : base(message) { }
    public override string TypeScriptName => "InvalidParameterError";
}

/// <summary>An argument names <c>?authUser</c> or <c>?authGroup</c>, or the query declares one in a shared slot.</summary>
public sealed class ReservedSlotException : SqlibRuntimeException
{
    public ReservedSlotException(string message) : base(message) { }
    public override string TypeScriptName => "ReservedSlotError";
}

/// <summary>The call names a query the bundle does not carry, or does not fit the query's slots by position.</summary>
public sealed class QueryCallException : SqlibRuntimeException
{
    public QueryCallException(string message) : base(message) { }
    public override string TypeScriptName => "QueryCallError";
}

/// <summary>
/// The arguments do not fit the query's parameter slots: an argument matches no
/// slot, a required slot has no rows, a blank row is mixed with bound rows, or a
/// value does not match the slot's value pattern.
/// </summary>
/// <remarks>The TypeScript runtime raises a plain <c>Error</c> for these.</remarks>
public sealed class SlotMismatchException : SqlibRuntimeException
{
    public SlotMismatchException(string message) : base(message) { }
    public override string TypeScriptName => "Error";
}

/// <summary>
/// A value pattern is not a valid JavaScript regular expression, or uses a
/// construct this library does not translate.
/// </summary>
/// <remarks>
/// Raised by <see cref="ValuePattern.Compile(string, System.TimeSpan)"/>. A bundle load wraps it in an
/// <see cref="InvalidBundleException"/>.
/// </remarks>
public sealed class InvalidValuePatternException : SqlibRuntimeException
{
    public InvalidValuePatternException(string message) : base(message) { }
    public override string TypeScriptName => "Error";
}

/// <summary>The SPARQL endpoint answered with a status outside 200 to 299.</summary>
public sealed class SparqlEndpointException : SqlibRuntimeException
{
    public SparqlEndpointException(string message, int status, string body) : base(message)
    {
        Status = status;
        Body = body;
    }

    /// <summary>The HTTP status code.</summary>
    public int Status { get; }

    /// <summary>The first 2000 characters of the response body.</summary>
    public string Body { get; }

    public override string TypeScriptName => "SparqlEndpointError";
}
