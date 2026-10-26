# SRL analysis reports positions and severities, and warns about shadowed variables

This proposes three changes to sqlib's SRL analysis:

- Each well-formedness issue carries a character range in the document and a
  severity.
- The analysis adds warnings for two rules that are legal but probably not what
  their author meant. In both, a variable has the same name as one bound
  elsewhere in the rule body but is a separate variable.
- sqlib provides a CodeMirror extension that shows these issues in an editor
  using `@kurrawongai/codemirror-lang-srl`. The language package itself stays
  independent of sqlib.

Nothing here is implemented. Statements about current behaviour were checked on
2026-10-26 against `main` at `6f65c10` and against `9edc325`, the head of
recalcitrantsupplant/sqlib#92.

## Summary of proposed changes

1. Add `severity`, `from` and `to` to `WellFormednessIssue`
   (`packages/srl/src/wellformed.ts`), and return them from
   `POST /srl/analyze` (`analyzeSrlDocument` in
   `packages/api/src/routes/rule-sets.ts`).
2. Count only issues with the severity `error` when deciding whether a document
   is well-formed. The callers that decide this are `runSrlCheck`
   (`packages/api/src/lib/srlChecks.ts`) and the CLI's rules command
   (`packages/cli/src/commands/rules.ts`).
3. Keep the source positions of variables when parsing a rule body, so an
   issue can mark the variable it is about.
4. Add the warning `group-shadowing`, and add `not-before-binding` either as a
   warning or with the severity `info`.
5. Export a CodeMirror lint extension from sqlib that calls the analysis and
   returns its issues as CodeMirror diagnostics. The web app and the MCP app
   add it next to `srl()`.

## What the analysis returns today

`checkWellFormed` returns issues of this shape:

```ts
interface WellFormednessIssue {
  category: WellFormednessCategory; // 'unbound-head' | 'set-rebinds' | 'use-before-bind' | 'aggregate-scope'
  ruleIndex: number;
  ruleName?: string;
  message: string;
}
```

Every issue is an error. An issue identifies a rule but not a place in the
text. `POST /srl/analyze` passes the issues through as `wellFormedness`. The
web app's API client declares that field as `RuleSetSrlAnalysis.wellFormedness`
in `packages/web/src/composables/useApiClient.ts`, but no other code in
`packages/web/src` reads it.

Rules and `DATA` blocks have source spans (`span` in `packages/srl/src/ast.ts`).
Variables do not. On the parser at `9edc325`, every variable node in a parsed
rule body has `loc: { sourceLocationType: "autoGenerate" }`, so its offset in
the document is lost. Without change 3, an issue can only mark a whole rule.

## The issue shape

| Field | Type | Meaning |
| --- | --- | --- |
| `from`, `to` | number | Range in the document text that was analysed, in UTF-16 code units |
| `severity` | `'error' \| 'warning' \| 'info'` | `error` makes the document ill-formed; the others do not |
| `category` | string | A stable code such as `set-rebinds` or `group-shadowing`, so a client can filter issues without matching message text |
| `message` | string | One sentence for the reader |
| `ruleIndex`, `ruleName` | number, string | As now |

UTF-16 code units are CodeMirror's positions and JavaScript's string indices.
Code-point offsets would differ from them after any character outside the
Basic Multilingual Plane, such as an emoji in a literal or IRI. The unit needs
stating in the API documentation, because a client of the HTTP API need not be
written in JavaScript.

The offsets refer to the whole document, not to positions within a rule body.
The parser at `9edc325` parses each rule body from a slice of the document, so
it has to add the body's start offset to any location it keeps.

## The warnings

### `group-shadowing`: a GROUP pattern variable with an outer variable's name

A `GROUP` pattern sees only its keys from the rule body around it
(w3c/data-shapes#1377, open on 2026-10-26, implemented by sqlib#92). Suppose a
variable in the pattern has the name of a variable bound before the `GROUP`
but is not listed after `BY`. If it is used in a `FILTER`, a `SET` expression or
an aggregate argument, the rule is ill-formed, and sqlib#92 reports that. If it
is used in a triple pattern or as a `SET` target, the rule is well-formed, and
the pattern's variable is a separate variable.

Data:

```
PREFIX : <http://example/>
:a :p 1 . :a :p 2 . :b :p 3 .
:a :knows :b . :c :knows :b . :b :knows :a .
```

Two rules that differ only in their keys:

```
RULE { ?s :n ?n } WHERE { ?s :knows ?o GROUP BY ?s    { ?o :p ?v } [ ?n := COUNT(*) ] }
RULE { ?s :n ?n } WHERE { ?s :knows ?o GROUP BY ?s ?o { ?o :p ?v } [ ?n := COUNT(*) ] }
```

| Rule | Inferred at `9edc325` |
| --- | --- |
| `BY ?s` | `:a :n 3 . :b :n 3 . :c :n 3 .` |
| `BY ?s ?o` | `:a :n 1 . :b :n 2 . :c :n 1 .` |

In the first rule, the inner `?o` matches every subject with `:p`. The proposed
W3C test `eval-group-09` (`packages/srl/test/w3c-proposed/group/eval/` on
sqlib#92) depends on that rule being accepted, so this must be a warning, not an
error.

The check walks a rule body in order and keeps the set of variables bound so
far:

| Element | Adds to the bound set |
| --- | --- |
| Triple pattern or `TUPLE` pattern | its variables |
| `SET` | its target |
| `GROUP` | its keys and its aggregation variables, not its pattern's variables |
| `FILTER`, `NOT` | nothing |

At each `GROUP`, the check warns on each occurrence of a variable in the
pattern's triple patterns, and on each `SET` target in the pattern, whose name is
in the bound set and is not a key. `?o` and `$o` are the same name. Suggested
message:

```
?o here is a separate variable from the ?o bound before this GROUP. List it after BY to use the same value.
```

These are not flagged:

- A key that the pattern does not mention, which is carried through unchanged.
- The same name in two `GROUP` patterns when no element before either binds it,
  such as counting all children with `?y` and then adult children with `?y`.
- A name bound only after the `GROUP`.
- A `SET` in the pattern that computes a key the body has not bound.

A blank node in a body is a variable, so a blank node label used both before a
`GROUP` and in its pattern has the same problem. It cannot be listed after `BY`,
which takes variables only. The warning should cover blank nodes too, with a
message that suggests replacing the label by a variable.

### `not-before-binding`: a NOT that runs before its variable is bound

A `NOT` body is checked against the variables bound before the `NOT`. A
variable in the `NOT` body that the rule body binds only later is a separate
variable inside the `NOT`. SPARQL's `FILTER NOT EXISTS` applies to its whole
group wherever it is written, so an author used to SPARQL can expect the later
binding to apply.

Over `:a :knows :b . :a :likes :b . :a :likes :c .`, run on the hosted sqlib
MCP server on 2026-10-26:

| Rule body | Inferred |
| --- | --- |
| `?x :likes ?y NOT { ?x :knows ?y }` | `:a :before :c` |
| `?x :likes ?any NOT { ?x :knows ?y } ?x :likes ?y` | nothing |

In the second body, the `NOT` asks whether `?x` knows anyone at all. The check
marks each variable in a `NOT` body that is not bound when the `NOT` runs but is
bound by a later element. A `FILTER` or `SET` inside the `NOT` that uses such a
variable is already ill-formed (`use-before-bind`).

### Not proposed as warnings

- A blank node label used in both the head and the body. The body's blank node
  is a variable, and the head's mints a fresh blank node each time the rule
  fires. This matches SPARQL `CONSTRUCT`, so a warning would mostly mark
  intended rules. It could be an `info` issue.
- A `SET` or aggregate that assigns a bound variable, and a head variable that
  only a `NOT` or a `GROUP` pattern binds. These are ill-formed and are already
  errors.
- The same variable name in two rules. Each rule is its own scope.

## Showing issues in a CodeMirror editor

`@kurrawongai/codemirror-lang-srl` reports parse errors and SRL conformance
errors, which it finds from its own syntax tree. It does not depend on sqlib,
and applications that use it without sqlib should not need to. So the
extension that shows sqlib's analysis lives in sqlib:

```ts
import { srl } from '@kurrawongai/codemirror-lang-srl';
import { sqlibSrlLinter } from '…'; // a sqlib package, name to be decided

const extensions = [srl(), sqlibSrlLinter({ analyze })];
```

`sqlibSrlLinter` wraps CodeMirror's `linter()`. `@codemirror/lint` 6.9 combines
the results of several linters in one editor and discards results computed for
an older version of the document. With the issue shape above, the extension
only renames fields: `from`, `to`, `severity` and `message` map directly to a
CodeMirror `Diagnostic`, and `category` can go in its `source`.

The analysis runs only on a document that parses. While any rule has a syntax
error, sqlib reports nothing, and the editor shows only the language package's
parse errors. The two sources therefore do not mark the same text.

## Test cases

A prototype of `group-shadowing` was written against the CodeMirror syntax tree
in Kurrawong/codemirror-lang-rdf and then removed, because the scoping rules
belong in sqlib. Its tests are the starting set for this one. Each expects a
warning on the marked variable or on nothing:

| Rule body | Warned |
| --- | --- |
| `?s :knows ?o GROUP BY ?s { ?o :p ?v } [ ?n := COUNT(*) ]` | inner `?o` |
| `?s :knows ?o GROUP BY ?s ?o { ?o :p ?v } [ ?n := COUNT(*) ]` | nothing |
| `?x :p ?o GROUP BY ?x { ?x :q ?o } [ ?n := COUNT(*) ]` (`eval-group-09`) | inner `?o` |
| `?s :p ?o GROUP BY ?s { ?o :q ?v . ?v :r ?o } [ ?n := COUNT(*) ]` | both inner `?o` |
| `?s :p ?o GROUP BY ?s { $o :q ?v } [ ?n := COUNT(*) ]` | `$o` |
| `?s :p ?o GROUP BY ?s { ?s :q ?v SET(?o := ?v) } [ ?n := COUNT(*) ]` | the `SET` target `?o` |
| `?s :p ?x SET(?o := ?x) GROUP BY ?s { ?o :q ?s } [ ?n := COUNT(*) ]` | inner `?o` |
| `?s a :T GROUP BY ?s { ?s :p ?y } [ ?n := COUNT(*) ] GROUP BY ?s { ?s :q ?n } [ ?m := COUNT(*) ]` | `?n` in the second pattern |
| `TUPLE(?s, ?o) GROUP BY ?s { ?o :q ?v } [ ?n := COUNT(*) ]` | inner `?o` |
| `?s a :T GROUP BY ?s { ?s :q ?o } [ ?n := COUNT(*) ] ?s :p ?o` | nothing |
| `?p a :T GROUP BY ?p { ?p :child ?y } [ ?a := COUNT(*) ] GROUP BY ?p { ?p :child ?y . ?y a :Adult } [ ?b := COUNT(*) ]` | nothing |
| `?s a :T NOT { ?s :p ?o } FILTER(?s != :x) GROUP BY ?s { ?s :q ?o } [ ?n := COUNT(*) ]` | nothing |
| `GROUP { ?s :p ?o } [ ?n := COUNT(*) ]` | nothing |
| `?s a :T GROUP { ?s :p ?o } [ ?n := COUNT(*) ]` | inner `?s` |

## Open questions

- Whether `not-before-binding` is a warning or `info`. A `NOT` placed first to
  test that something has no `:knows` at all is a legitimate rule.
- Which package exports `sqlibSrlLinter`, and whether it calls
  `@sparql-query-lib/srl` in the browser or `POST /srl/analyze`.
- Whether the web app's rules work area should show the issues in its gutter
  and inspector as well as in the editor.
- If w3c/data-shapes#1377 changes how a `GROUP` pattern is scoped before it
  merges, `group-shadowing` changes with it.
