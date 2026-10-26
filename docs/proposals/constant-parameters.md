# Constant parameters: a value where an engine refuses a variable

Status: proposal, not implemented. Written 2026-10-23 against `main` at
`b419853`.

## Summary

Some engines accept a value in a position only as a constant written in the
query, and refuse a variable there even though the SPARQL is valid. QLever's
text search is the case that prompted this: `ts:word ?w` is valid SPARQL, and
QLever refuses it. A query whose search word comes from the caller therefore
cannot be a sqlib parameterised query today.

This proposes an opt-in **constant parameter**. It is declared like every other
table parameter, `VALUES ?000word { UNDEF }`, and the `000` prefix on the
variable marks it, after the `LIMIT 0001` convention. At run time it takes
exactly one value, and the runtime writes that value, serialised by the same
`serializeTerm` that renders `VALUES` rows, at each place the variable occurs.
Where it may occur is checked when the query is compiled. What values it
accepts is declared as a pattern on the input. `VALUES` remains the default and
the recommended form; a constant parameter is for the positions an engine will
not let a variable fill.

## The problem

Tested 2026-10-23 against QLever, sending the query directly to its HTTP
endpoint:

| Query fragment | QLever's answer |
| --- | --- |
| `SERVICE ts: { ?t ts:contains [ ts:word "copper*" ] . … }` | 200, results |
| `VALUES ?w { "copper*" } SERVICE ts: { ?t ts:contains [ ts:word ?w ] . … }` | 400, `The predicate <word> needs a literal as object. The object given was: ?w` |
| `?t ql:contains-word "copper*" ; ql:contains-entity ?l .` | 200, results |
| `VALUES ?w { "copper*" } ?t ql:contains-word ?w ; ql:contains-entity ?l .` | 400, `ql:contains-word has to be followed by a string in quotes` |

sqlib substitutes a table parameter by filling its `VALUES` block. The variable
stays a variable, so QLever refuses both forms. The compact `ql:contains-word`
form does not return the match scores a ranked search needs either, so it is
not an alternative.

The consequence for an application is that every distinct search term is a
different query text. An application that wants its queries to be stored,
versioned assets falls back to building query text, which is what sqlib exists
to replace.

## What `VALUES` covers, and what it does not

Each row was checked with `POST /validate` on the sqlib API at `b419853`, which
parses with Traqula. "Valid" means the SPARQL parses, not that every engine runs
it.

| Position | Variable allowed by SPARQL | With `VALUES` today |
| --- | --- | --- |
| Subject, predicate, object of a triple pattern | yes | covered |
| `FILTER(?x IN (…))` | — | covered: join with `VALUES ?x { … }` instead |
| `REGEX(?o, ?re, ?flags)` pattern and flags | yes | covered |
| Literal datatype, `"1"^^?dt` | no | covered: `STRDT(?lexical, ?dt)` |
| Language tag, `"x"@?lang` | no | covered for matching: `LANGMATCHES(LANG(?l), ?lang)`; for building: `STRLANG(?s, ?lang)` |
| `GRAPH ?g { … }` | yes | covered |
| `SERVICE ?svc { … }` | yes | covered by SPARQL; engine support not checked |
| `LIMIT` / `OFFSET` | no | covered by `LIMIT 000n` / `OFFSET 000n` |
| `ORDER BY` key chosen at run time | yes, as an expression | covered: two patterns, below |
| `ORDER BY` direction | no: `ASC` / `DESC` are keywords | covered by a workaround, below |
| Element of a property path, `?s ex:a/?p ?o`, `?s ?p+ ?o` | no | not covered |
| `GROUP_CONCAT(…; separator=?sep)` | no | not covered |
| `FROM` / `FROM NAMED` | no | not in the query: see [Dataset inputs](dataset-inputs.md), which supplies them as protocol parameters |
| Function IRI, `?f(?o)` | no | not covered, and out of scope: a caller choosing which function runs is not a value |
| Engine-specific: QLever `ts:word`, `ql:contains-word` | yes | not covered: the engine refuses a variable |

### Order direction without a new mechanism

`ORDER BY ?dir(?x)` parses, but as two sort keys: `?dir`, then the bracketed
expression `(?x)`. It does not set a direction.

A direction parameter can be written with `VALUES` by binding the sort key under
two names, only one of which is bound for a given direction:

```sparql
SELECT ?x WHERE {
  VALUES ?dir { UNDEF }
  …
  BIND(IF(?dir = "asc",  ?x, ?unbound) AS ?ascKey)
  BIND(IF(?dir = "desc", ?x, ?unbound) AS ?descKey)
}
ORDER BY ASC(?ascKey) DESC(?descKey)
```

`?unbound` is never bound, so the `IF` branch that reads it is an error and
`BIND` leaves its variable unbound. With `?dir = "asc"`, `?descKey` is unbound
on every row, so `DESC(?descKey)` ties throughout and `ASC(?ascKey)` decides
the order; `"desc"` is the reverse. On QLever (2026-10-23) and on Oxigraph
0.5.11, the version sqlib ships, both directions sort numbers (`1 2 3 10`,
`10 3 2 1`) and strings (`apple fig pear`, `pear fig apple`) correctly. The
cost of two computed keys against one has not been measured.

### Order key without a new mechanism

Which value the results are sorted by can also be a `VALUES` parameter, in two
ways. Both combine with the direction pattern above by sorting on `?key`
through `?ascKey` and `?descKey`.

**The property to sort by, as an IRI.** The caller passes the property, and the
query joins it as a variable predicate:

```sparql
VALUES ?sortBy { UNDEF }
OPTIONAL { ?doc ?sortBy ?key }
```

This sorts by any property the caller names, with no change to the query.

**One of the query's own variables, by name.** The caller passes a name, and an
`IF` chain picks the variable:

```sparql
VALUES ?sortBy { UNDEF }
BIND(IF(?sortBy = "title", ?title, IF(?sortBy = "year", ?year, ?unbound)) AS ?key)
```

This needs every candidate already bound in the query, and the names are a
closed set the query defines.

Tested 2026-10-23. On Oxigraph 0.5.11, with four resources where one has no
year, both patterns sort titles and years correctly in both directions. On
QLever, the property pattern sorted five documents by `sdo:name` in both
directions in about 1 s each, and the `IF` chain sorted inline rows by title and
by year. The cost of the variable-predicate join over a full result set was not
measured.

Three behaviours follow from SPARQL, not from either engine:

- A row without the sort property has an unbound key, and SPARQL orders unbound
  lowest: it comes first ascending and last descending. Adding
  `ASC(!BOUND(?key))` before the other keys puts such rows last in both
  directions; this was not tested.
- A property with several values on one resource gives that resource one row
  per value. A query whose rows must stay one per resource needs
  `GROUP BY ?doc` with `MIN(?key)` or `SAMPLE(?key)`, as a sort over
  aggregated rows.
- The property pattern lets a caller sort by any property, including ones the
  application never shows. Where that matters, restrict the input with
  `allowedTypes` or a pattern, or use the `IF` chain.

So order key and direction do not need a constant parameter, and neither does
any other keyword this proposal is aware of. Constant parameters stay limited
to terms: IRIs and literals.

## Proposal

### Declaration

A constant parameter is a table parameter whose single variable begins with
`000`:

```sparql
PREFIX ts: <https://qlever.cs.uni-freiburg.de/textSearch/>
SELECT ?entity WHERE {
  VALUES ?000word { UNDEF }
  SERVICE ts: {
    ?t ts:contains [ ts:word ?000word ] .
    ?t ts:contains [ ts:entity ?entity ] .
  }
}
```

The declaration is in the query text, as [concepts](../concepts.md) requires of
every parameter, and it is the same `VALUES … UNDEF` declaration a table
parameter uses. The prefix follows `LIMIT 0001`, where `000` marks a value the
runtime writes into the text. Checked 2026-10-23: sqlib's parser accepts
`?000word`; `POST /detect-inputs` reports it as an ordinary table parameter
(`[["000word"]]`); `POST /substitute` fills it; QLever and Oxigraph 0.5.11 both
run `SELECT ?000x WHERE { VALUES ?000x { 1 2 } }`. SPARQL's `VARNAME` allows a
leading digit; the runtime's `isSafeVariableName` in
`packages/runtime/src/sparql-terms.ts` does not, and would be widened for this
prefix only.

A query that never uses the prefix behaves exactly as it does today.

### Rules checked when the query is compiled

The server compiles a query with the full parser. A constant parameter is
refused there, before it is stored, unless all of these hold:

1. **Its `VALUES` clause declares only that variable.** `VALUES (?000a ?b)` is
   refused: one row of a multi-variable clause has no single place to go.
2. **It is declared once.** A second `VALUES ?000word { UNDEF }` is refused.
3. **Every occurrence is in a term position:** a triple pattern's subject,
   predicate or object, an element of a property path, an argument in an
   expression, or the `separator` of `GROUP_CONCAT`. Occurrences in `SELECT`, in
   `BIND(… AS ?000word)`, in `GROUP BY` or as a subquery's projection are
   refused. Replacing the variable there either produces invalid SPARQL or
   changes which variables the query returns.
4. **Every occurrence is in the scope of its `VALUES` clause:** the same group,
   or a group nested inside it, not across an `OPTIONAL`, `MINUS` or subquery
   boundary from the declaration. Within that scope, joining with a one-row
   `VALUES` block and writing the constant select the same solutions. Across those
   boundaries they can differ.

Rule 4 is the one most likely to be found too strict in practice: a query that
filters the same value inside a subquery and again in an `OPTIONAL` needs two
parameters, as it does with `VALUES` today (see "Related" below).

### Values

- **Exactly one row, with the variable bound.** Zero rows, more than one row, or
  an omitted parameter is refused before the query is sent. Unlike a table
  parameter, an omitted constant parameter has no "unconstrained" meaning: left
  as a variable, it reaches the engine in a position the engine refuses.
- **Term kind.** The existing `allowedTypes` on the input says whether an IRI or
  a literal (and which datatype) is accepted.
- **Pattern.** A constant parameter carries a regular expression its value must
  match, stored on the input beside `allowedTypes`. A value is a single term, so
  it cannot break out of the query syntax (see "Safety"), but some engines read
  the term's contents as a language of their own. Inside `ts:word "…"`, QLever
  reads a trailing `*` as a prefix match; what other characters do there was not
  tested. A pattern such as `^[\p{L}\p{N}]+\*?$` states what a caller may send.

### Substitution

The value is serialised by `serializeTerm` in
`packages/runtime/src/sparql-terms.ts`, the function that serialises every
`VALUES` cell today, so the escaping is identical. The parameter's `VALUES`
clause is removed, and each occurrence of the variable is replaced by the
serialised term.

- **Server, AST path:** the occurrences are replaced in the parsed query, and
  the result is generated and re-parsed, as for any substitution.
- **Template path and export bundle:** the template records, beside each slot's
  span, the spans of the variable's occurrences in the canonical text. The
  runtime splices the term into each. The bundle gains, per slot, a
  `substitution: "constant"` marker, the occurrence spans and the pattern, so a
  browser applies the same rules without a parser.

`QueryTemplate` verification (`packages/runtime/src/query-template.ts`) checks a
new template against the AST path on adversarial probes before trusting it.
Constant slots get the same probes: a value containing `"`, `\`, `>`, newlines,
and text that would close a group if it were not inside a literal.

## Safety

**Syntax.** A constant is written by `serializeTerm`, the function every
`VALUES` cell already goes through on the template path, which splices a
serialised block into the canonical text. Literals escape `"`, `\`, newline and
carriage return, the four characters SPARQL's quoted string does not allow raw.
IRIs containing a character forbidden in an `IRIREF` are refused before
serialisation. Datatype IRIs and language tags are validated. A value therefore
cannot end its term early, at a constant position any more than inside a
`VALUES` block.

**Position and meaning.** Writing a constant is not equivalent to a `VALUES` join
everywhere. Rules 3 and 4 limit it to the positions and scope where it is, and
they are checked when the query is compiled, where a parser exists, so a query
that breaks them is never stored as one with a constant parameter.

**Engine-interpreted contents.** A term can carry input to a language inside the
engine: QLever's word syntax in `ts:word`, or a regular expression passed to
`REGEX`. That applies to a `VALUES` parameter feeding `REGEX` today as much as
to a constant parameter. The pattern on the input is the control, and the
browser runtime has no other.

**The browser has no parser.** On the server the substituted query is re-parsed.
In a browser running an export bundle, the compile-time rules, `serializeTerm`
and the pattern are the only checks. The same holds for `LIMIT 000n` today,
which is why `assertPageParameterValue` exists.

[Concepts](../concepts.md) currently says "Argument values are never
concatenated into query text". The template path already splices serialised
`VALUES` blocks; this proposal splices serialised terms. The sentence would
change to what is guaranteed: a value enters the text only as a term produced
by `serializeTerm`, at a position fixed when the query was compiled.

## Alternatives considered

| Alternative | Why not |
| --- | --- |
| A template token, `$$word$$` or `{{word}}` | The stored text is no longer SPARQL: it cannot be parsed, validated, formatted or have its inputs detected, and it cannot run anywhere unsubstituted. |
| `$word` as the marker | SPARQL defines `$word` and `?word` as the same variable. The canonical rendering is likely to normalise one to the other, losing the marker, and an author who writes `$` out of habit would opt in by accident. |
| A flag on the input's metadata (`substitution: "constant"`) | Puts the declaration outside the text, against the rule in [concepts](../concepts.md); the query no longer says how it is substituted when read on its own. |
| A comment pragma, `# sqlib:constant ?word` | Comments are deliberately inert: `LIMIT 0001` inside a comment declares nothing. A pragma would make one kind of comment meaningful. |
| Doing the constant step only in a client (for example a Python service) | The same stored query would run through that client and fail through the sqlib API, a remote sqlib server and an export bundle. |
| `FILTER(CONTAINS(LCASE(?name), ?term))` in place of the text index | Takes a `VALUES` parameter, and scans every name without the index. |

## Changes needed

- `packages/runtime/src/sparql-terms.ts`: admit the `000` prefix in
  `isSafeVariableName` for constant parameters.
- `packages/runtime/src/query-template.ts`: occurrence spans per constant slot,
  splicing, verification probes.
- `packages/runtime/src/bundle.ts`: per-slot `substitution`, occurrence spans and
  pattern; `verifyBundleIntegrity` checks them.
- API detection (`POST /detect-inputs`): report a constant parameter as such,
  and the compile-time rule failures as errors naming the occurrence.
- `QueryInputVariable`: a `pattern` beside `allowedTypes`.
- Web UI: show a constant parameter on the Arguments tab with its pattern, and
  refuse a second row.
- Docs: [concepts](../concepts.md) (declaration, the sentence above, empty-input
  table), [static export](../guides/static-export.md) (bundle fields), and the
  order-direction and sort-key patterns above as a how-to.

## Related: one name in two `VALUES` clauses

Found while writing queries for this proposal. A query that declares
`VALUES ?yearFrom { UNDEF }` twice, once inside a subquery and once in an
`OPTIONAL` the subquery cannot see, has two slots with the same signature.
`assignArgumentSets` gives an argument to the first unclaimed slot that matches,
so one `yearFrom` argument fills the first slot and leaves the second omitted.
An omitted slot is removed, and the `OPTIONAL`'s `FILTER(?_dyr >= ?yearFrom)`
then compares against an unbound variable and never matches. `POST /substitute`
at `b419853` shows the first clause filled and the second gone. Today the author
has to give the second clause its own variable. Whether one argument should fill
every clause with its signature is a separate decision from this proposal.

## Open questions

1. Is `000` the right prefix, or should a constant parameter have its own marker
   distinct from page parameters?
2. Should a pattern be required for every constant parameter, or optional with a
   warning?
3. Which other engines refuse a variable where SPARQL allows one? Only QLever's
   `ts:word` and `ql:contains-word` have been tested. Candidates to check include
   the full-text extensions of Jena, GraphDB, Virtuoso, Stardog and Blazegraph.
4. Is there a case for more than one value, written as a `UNION` of the pattern
   once per value? Nothing here needs it.

## Tests to add

- Detection: `?000word` reported as a constant parameter; each rule in "Rules
  checked when the query is compiled" refused with a message naming the
  occurrence.
- Substitution, server and template paths, byte-identical: a literal with each
  escaped character; an IRI; an IRI with a forbidden character refused; zero
  rows, two rows and an omitted parameter refused; a value failing the pattern
  refused.
- Bundle: occurrence spans survive export; a bundle whose spans do not match its
  text fails `verifyBundleIntegrity`.
- Equivalence: for queries satisfying the rules, the constant form and a `VALUES`
  form return the same solutions on Oxigraph.
