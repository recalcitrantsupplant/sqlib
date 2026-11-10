# Inline inputs and the rail

This page describes where each kind of saved input is stored, and the reasons.

## Inline input and storage

A graph pasted into a call and a graph stored in the library are the same
bytes, in the same serialisation, under the same size limit, read by the same
loader. Earlier, the only difference was the screen where you typed them.

A graph therefore has one storage form: a `DataGraphVersion`. An argument set
holds no graphs (see
[argument sets without graphs](../proposals/argument-sets-without-graphs.md)).
A rule set or a query group names its graphs next to its arguments. To keep
pasted RDF, save it as a data graph: on the Graphs screen, or with
**Save to Data** on the rule set screen.

One rule sets the boundary:

> **Running is not saving.** Inline content in an execute request creates no
> entity. `/execute` and `/sparql` accept inline graphs, tables and numbers as
> transport, and an ad-hoc run leaves nothing in any rail.

## One storage form for each kind of input

| Kind | Where the content is stored when saved | Rail entry | Reason |
| --- | --- | --- | --- |
| **Graph** | `DataGraphVersion`, named next to the argument set by the run or the test case | Graphs | A `DataGraph` holds RDF content. When an argument set held RDF, it repeated an existing entity, and a group had two ways to receive the same graph. |
| **Table** | `ArgumentTupleBinding.contentString` (SRJ) on the argument set version | Argument sets | The argument set is an entity, in the rail, versioned and pinnable. No second place is needed. |
| **Number** | `ArgumentScalarBinding` on the argument set version | Argument sets | Same as a table. |

The middle column tells you where a saved input goes. The rule is: **each saved
input is stored once, in the entity that holds that kind of content, and that
entity is in a rail.**

To decide where content goes, ask whether an entity already holds that kind of
content:

- For RDF, the `DataGraph` does. The run or test case names the graph next to
  the argument set.
- For rows supplied to a `VALUES` clause, the argument set does. The rows stay
  in it.

If sqlib made a tuple set from a saved `VALUES` table, it would make a second
entity with the same rows. That entity would be in a section with different
matching rules, and nobody asked to reuse it.

## Deleting a graph

sqlib refuses to delete a `DataGraph` while a saved test version pins one of
its versions, as for any pinned entity (`lib/versionPins.ts`). Argument sets do
not pin graphs, because they hold none. A browser default that names the graph
or one of its versions is cleared. A default only sets the first selection, so
when it is cleared, a person picks again and no run breaks.

## Tuple set column names are labels

A tuple set fills the `TUPLE(…)` declarations of a rule set. Matching is
**by position**: the arity, and any ground terms in the declaration. Column
names have no effect. Tuples that flow from one rule to another match in the
same way.

A `TupleSetVersion` has `columns`. Names help you read a table, compare two
versions, keep the headers of a CSV import, and pre-fill a conversion. They are
**labels** only, and the screen where you edit them says so.

- **No code reads `columns`** for matching, for a verdict, or for execution. If
  a label had an effect in some cases only, users would learn a rule that is
  not always true.
- **The bind-time notice is the only place where names have an effect**, and
  the effect is a message:
  - An arity mismatch is an error.
  - An info line says that matching is by position and that labels have no
    effect.
  - The info line becomes a warning only when labels exist and are in a
    different order from the declaration. For example, the columns of the set
    are `y | x` and the declaration is `?x ?y`. A person who sees this probably
    expects matching by name.

## Conversions between the two table forms

Both forms are SPARQL Results JSON, so each conversion is a projection and one
question. A person starts each conversion. When a conversion creates a new
entity, it records `copiedFrom`, so "used by" can be answered without pins.

**Tuple set to argument table.** The dialog asks which variable each column
fills. It pre-fills the names from the labels of the tuple set, and marks them
as unverified, because a label is a guess. The person confirms each one. The
`fits / partial / mismatch` verdict then checks the result. A second option: a
rule-set table can start with a ground term (`TUPLE(:seed, ?x, ?y)`), so the
dialog offers **strip the leading fixed column**.

**Argument table to tuple set.** The names are kept, as labels. The dialog says
that rule sets match by arity and position, that the names are kept so you can
read the table, and that a `TUPLE(…)` never uses them. The second option is the
reverse of the one above: **prepend a fixed IRI**, for a declaration that starts
with a ground term.

A conversion makes a copy, once. After it, the two entities change separately,
and neither has a link to the other. For this reason a conversion is safe. An
automatic copy at save time was not.

## Origin in the rail

The grouping control of the section sidebar has a mode that shows where each
entry came from, **Origin**:

- *Composed here*: made with `+ New` on the rail.
- *From queries* / *From groups*: an argument set made on the screen of a
  callable, read from its `targetEntity`.

A graph is always *Composed here*, because no callable makes one.

The groups are by kind of origin. One group for each callable would split a real
library into dozens of groups with one row each. The subtitle of each row names
the callable.

Origin is separate from tags. A person writes tags, and tags apply across the
library. If sqlib added tags for provenance, a tag could mean a decision by a
person or a fact from the system, and a reader could not tell which. Use Origin
to **find** an entry, and tags to **classify** it.

Origin does not limit use. A set made on one query can be correct for another
query. For this reason the argument set switcher calculates a
fits/partial/mismatch verdict.

## One draft store in the browser, keyed by section

Unsaved argument sets were once in a separate store, so that argument sets did
not show in the nav rail. When an argument set became a rail entity, that reason
ended, but the separate store stayed. The query screen wrote to one key and the
rail read another. A set made on a query therefore did not reach the rail in the
same session. It appeared after a reload, so a missing write looked like a cache
problem. The next set could also overwrite its edits.

The browser now has one draft store, keyed by section (`useCallableDrafts`).
`useArgumentSetDrafts` is a view of its `argumentSet` section.

## Open items

- **Ad-hoc runs and the size limit.** Running is not saving, so you can run a
  large pasted graph many times and it never becomes an entity. This is correct.
  It means that a prompt such as "this call carries 40 MB of RDF, save it as a
  graph" must be on the run path as well as on save.
- **`immutable` is no longer needed.** Versions are created frozen, so the flag
  carries no information.
